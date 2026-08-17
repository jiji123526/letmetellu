# Migration Notes

This file records both the original CSS-to-TSX porting constraints and the database/platform changes made during the rebuild.

## Recent implementation updates

### Channel-owner message deletion has a five-second undo window — 2026-08-16

- Message deletion by a channel owner is now delayed for five seconds. The affected message, direct replies and gallery entries disappear locally immediately, while an action toast offers `Undo` / `실행 취소`.
- Undo restores the locally hidden rows without overwriting messages that arrived during the five-second window. If the owner does not undo, the existing permanent admin deletion endpoint runs, so this change does not retain deleted message text or media indefinitely.
- Starting another owner deletion commits the earlier pending deletion first and opens a fresh undo window. This keeps the UI and server from accumulating multiple ambiguous pending operations.
- Non-owner deletion behavior is unchanged. The delay is intentionally limited to the higher-risk owner moderation controls where an accidental tap can remove another user's message and its replies.

Trade-off: for up to five seconds, the owner sees the message as removed while other connected viewers can still see it. Leaving the channel does not cancel the scheduled server deletion. Verify owner deletion for own messages, another user's message with replies, DMs and image messages; test both Undo and timeout paths.

### Senders receive the persisted message before post-commit fan-out finishes — 2026-08-16

- Successful sends previously waited for link-panel synchronization and Durable Object WebSocket fan-out after the authoritative D1 message batch had already committed.
- The Worker now returns the persisted message acknowledgement immediately after constructing the committed message response. The existing client acknowledgement path displays that authoritative row; no optimistic or unpersisted message is introduced.
- New-message link indexing and WebSocket fan-out run concurrently through `ExecutionContext.waitUntil`. Each operation retries once independently, so a transient failure in one does not cancel the other or delay the sender.
- A final background failure records `message_post_commit_failed` with only the failed stage, channel scope and attempt count. It excludes message text, media URLs, actor tokens and message IDs.
- Idempotent duplicate recovery still waits for its repair broadcast before responding. This uncommon path intentionally prioritizes repairing an ambiguous earlier send over retry latency.
- Realtime clients already deduplicate `message-new` events by message ID and perform an authoritative recovery fetch after reconnection, making a harmless duplicate retry preferable to silent loss.

Trade-off: another viewer can receive a message a few milliseconds after the sender sees its HTTP acknowledgement. If both broadcast attempts fail, the message remains durably stored but other connected viewers may not see it until their next reconnect/recovery fetch. Link-index failure can similarly delay appearance in the Links panel. Both partial failures are now operationally visible instead of turning a successfully persisted send into a misleading client-side failure.

Deployment note: deploy the Worker only; no D1 migration or frontend deployment is required. In two browsers, send normal, linked, reply, live and image messages and confirm the sender sees each acknowledgement immediately while the other browser receives one realtime copy. Then review 24-hour operational events for `message_post_commit_failed`; any occurrence should be investigated by its `stage` value.

### Normal text sends avoid one write and parallelize identity verification — 2026-08-16

- Creating a message without a URL previously executed `DELETE FROM message_links WHERE message_id = ?` even though a brand-new message cannot have an existing link-index row. New-message link synchronization now returns without touching D1 when no link is present, while linked messages are still indexed normally.
- Edit-time synchronization remains unchanged: removing a URL from an existing message still deletes its stale `message_links` row.
- Anonymous identity-token and device-token verification are independent cryptographic checks. Non-owner sends now start both together and wait at one `Promise.all` barrier instead of verifying them serially.
- Focused tests preserve new-link insertion, edit-time cleanup and the parallel identity-verification boundary.

Trade-off: none of the authorization, blocking, banned-word, persistence, acknowledgement or WebSocket guarantees change. The improvement is intentionally bounded: ordinary text sends remove one unnecessary D1 write and non-owner sends save the overlap between two token checks, but the client still waits for persistence, link insertion when applicable and realtime broadcast before receiving its acknowledgement.

Deployment note: deploy the Worker only; no D1 migration or frontend deployment is required. Compare `/api/messages` duration for ordinary non-owner text sends before and after deployment, and confirm linked-message creation plus link-removal edits still update the Links panel.

### Three-character message searches use a trigram index — 2026-08-15

- Production search remained fast but literal substring matching read hundreds of message rows per returned result and scaled linearly with channel history.
- Migration `0044_trigram_message_search.sql` replaces the unused default-tokenizer FTS5 table with a trigram external-content index and rebuilds it from all existing messages.
- Queries containing at least three Unicode code points now use `messages_fts MATCH ?`; the input is wrapped as an escaped FTS5 phrase so quotes and operators remain literal rather than becoming search syntax.
- One- and two-code-point queries retain the previous `instr(lower(...))` path. This preserves short Korean substring search, which a trigram index cannot accelerate without a separate bigram index.
- The update trigger now runs only when `messages.text` changes. Reaction, report and other non-text message updates no longer rewrite the FTS index.
- `worker/scripts/audit-trigram-message-search.sql` verifies tokenizer SQL, trigger scope, FTS integrity and the virtual-table query plan. Focused tests cover Unicode thresholds and FTS phrase escaping.

Trade-off: the rebuilt trigram index consumes additional D1 storage and every message insert, text edit and hard delete maintains search data. Search becomes unavailable if migration or index synchronization fails, while short searches still scan a bounded channel range. The FTS candidate set is global before the authoritative channel/deleted filters are applied, so very common phrases can read more candidates than channel-local indexing would; a separate search service or channel-specific n-gram table is not justified at the current scale.

Deployment note: apply migration `0044`, run the audit, then deploy the Worker. No frontend deployment is required. Test Korean, English, quotes, punctuation, one/two-character queries, live-mode search, edits and deletions; then compare D1 Insights for the new `MATCH` fingerprint against the prior substring-search baseline.

### Parent-message deletion no longer scans the reply table — 2026-08-15

- D1 Insights showed `DELETE FROM messages WHERE id = ? AND channel_id = ?` reading `391.53k` rows across only 27 executions, roughly `14.5k` rows per deletion, despite the target message using its primary key.
- The amplification came from SQLite enforcing `FOREIGN KEY (reply_to) REFERENCES messages(id) ON DELETE SET NULL`. Its child lookup is effectively `WHERE reply_to = ?`, while every existing reply index began with `channel_id` and could not serve that foreign-key lookup without a broad scan.
- Migration `0043_message_reply_foreign_key_lookup.sql` adds `messages_reply_to_idx(reply_to)` for the exact generated lookup. It does not change deletion, reply or soft-delete behavior.
- `worker/scripts/audit-message-delete-index.sql` verifies the index columns, query plan and foreign-key integrity. Focused regression coverage preserves the schema relationship and audit fingerprint.

Trade-off: every reply adds one small index entry and reply writes/deletes maintain one additional B-tree. Root messages store `NULL` in this non-partial index, so it also consumes entries for roots; the extra write and storage cost is expected to be much smaller than scanning the growing message table on every hard parent deletion.

Deployment note: apply migration `0043`; no Worker or frontend behavior change is required. Run the audit and confirm the plan reports `messages_reply_to_idx`, then perform representative hard deletions and compare the new D1 Insights fingerprint against the `14.5k` rows-read-per-delete baseline.

### Message sends survive ambiguous connection failures without creating duplicates — 2026-08-15

- Production inspection found two identical messages from the same actor roughly 14 minutes apart with different `client_message_id` values. The first request had been persisted, but the browser missed both its HTTP/WebSocket confirmation; leaving and re-entering the channel then generated a new ID for the retry, so the database correctly treated it as a new message.
- Normal message responses now return the complete persisted message and the client immediately reconciles that acknowledgement into the visible list. The acknowledgement path performs a focused ID-based append-or-replace operation instead of rebuilding thread ownership or sorting the full mounted snapshot. WebSocket delivery remains the realtime path, but it is no longer the only way a successful send becomes visible.
- An unresolved send attempt is stored in tab-scoped `sessionStorage` for up to 30 minutes. Re-entering the same channel and retrying the same payload reuses its original client ID, allowing the existing database uniqueness constraint to return the already-persisted row instead of inserting another copy.
- Stored attempt signatures are deterministic hashes of the channel, mode, reply target, text and attachment metadata. Raw message text is not written to storage. A confirmed response or a matching message observed from the server clears the attempt immediately, so deliberately sending the same text again after success still creates a new message.
- Single and batch idempotency responses now include the existing persisted message. Focused tests cover acknowledgement payloads, signature stability, payload separation and expiry.

Trade-off: a genuinely unresolved identical retry in the same tab and channel within 30 minutes is treated as the original attempt. This is intentional for ambiguous network failures; once the server confirms or displays the send, the retry marker is cleared. Responses are also slightly larger because they include one message record, while `sessionStorage` remains tab-local and contains no plaintext message content.

Deployment note: deploy the Worker before the frontend. No D1 migration is required because the existing `client_message_id` uniqueness indexes remain the source of truth. Verify a normal send appears from the HTTP acknowledgement with WebSocket delivery suppressed, then abort a request after persistence, leave/re-enter, retry, and confirm only one database row exists.

### Dashboard LIVE badges are visible to channel visitors — 2026-08-14

- The red dashboard `LIVE` badge previously used an owner-only `/api/user` field. Anonymous device-local recent channels, logged-in joined channels and direct channel search results always forced the badge off.
- Public batched channel summaries and authenticated recent-channel rows now include an expiry-aware `live_active` flag. Passcode-protected channels expose only that a live session is active; they do not expose the title, messages or access credentials before unlock.
- Anonymous dashboard startup reuses its existing batched channel-validation request to apply authoritative live status. Logged-in recent channels receive it with their normal recent-channel response.
- Visible dashboards refresh displayed channel live flags once per minute and on foreground checks through one batched public request. This covers owner, joined and anonymous recent rows without opening room WebSockets or issuing one request per channel.
- Cached account snapshots force live state off until the authoritative response arrives, preventing a stale LIVE flash after a session ends. SQL also treats `expiresAt` as authoritative, so badges do not wait for hourly cleanup to hide an expired session.

Trade-off: a non-admin dashboard with channel rows performs one additional batched status refresh per visible minute and foreground return after staleness. The endpoint accepts at most 20 IDs per request, so unusually large recent lists use bounded chunks. Updates are eventually consistent by up to one minute because dashboards do not subscribe to every channel's realtime connection.

Deployment note: deploy the Worker before the frontend. No D1 migration is required. Verify an anonymous recent channel, a logged-in joined channel and an owner channel show and clear LIVE after the next foreground/minute refresh.

### Authentication outcomes and legacy upgrades are operationally visible — 2026-08-14

- Verification email delivery/completion, password-reset delivery/completion and one-time legacy SHA-256-to-PBKDF2 login upgrades now record bounded operational outcomes.
- Events retain only the opaque user ID needed for investigation. They exclude email addresses, passwords, tokens, hashes, provider responses and exception text.
- The platform health card shows rolling 24-hour sent, completed and failed counts plus the number of credential users whose hash still uses the legacy format. These counts are informational and do not change calibrated core-health thresholds; actual email-delivery `502`s still flow through existing `5xx` health alerts.
- `worker/scripts/audit-auth-monitoring.sql` reports aggregate outcomes, remaining legacy hashes and recent failure timestamps without selecting account identifiers. `OPERATIONS_RUNBOOK.md` defines a precondition-guarded disposable-account rehearsal.
- Focused regression coverage preserves every event boundary, aggregate normalization and dashboard contract.

Trade-off: each actual email send, token completion or one-time legacy upgrade adds one best-effort D1 operational-event write. Normal PBKDF2 logins add no write, and monitoring failure cannot reject an otherwise valid account action.

Deployment note: deploy the Worker before the frontend. No D1 migration is required. Rehearse one verification, one reset and one disposable legacy login, then run the audit and confirm the health card matches.

### Owner-channel navigation no longer fetches a full list during chat startup — 2026-08-14

- Every mounted chat previously issued a separate `/api/user?channel=...` request and loaded up to 50 public channels from the current owner only to decide whether the header profile button should be enabled.
- The product already enforces at most five normal channels per owner. The 50-row endpoint limit matched the separate beta-wide channel ceiling, not the per-owner invariant.
- D1 Insights recorded 2,218 executions, `59.89k` rows read and `104` rows read per returned row. Individual SQL latency was already low at `0.2 ms` p50 and `0.4 ms` p99; the larger waste was one additional browser request per chat load and a global channel scan caused by the missing owner-leading index.
- Migration `0042_owner_channel_profile_lookup.sql` adds `(owner_uid, show_on_profile, created_at, id)`. The existing init batch now performs a covering probe capped at two IDs and returns `owner_channel_count` as `0`, `1` or `2`; the client only needs to know whether multiple public channels exist.
- `ChatView` derives the header state from init metadata and no longer fetches the owner list during startup. The full list is requested only when the popup opens, uses the same index for deterministic chronological ordering and is capped at the real five-channel maximum.
- `worker/scripts/audit-owner-channel-query.sql` verifies both the two-row init probe and five-row popup plan. Focused source coverage preserves the lazy request boundary, product limit and init contract.

Trade-off: every full init, including reconnect recovery init, now executes one tiny indexed probe, while the previous separate request usually ran once per mounted page. The probe reads at most two index entries and shares the existing D1 batch, so this may increase statement count during reconnect-heavy sessions while removing normal startup HTTP fan-out and reducing total rows read. The popup remains authoritative if ownership or profile visibility changes after init.

Deployment note: apply migration `0042`, deploy the Worker, then deploy the frontend. No data backfill is required. Verify single-channel headers remain disabled, multi-channel headers open the complete list, and D1 Insights shows the old 50-row owner-list fingerprint no longer accumulating from ordinary chat loads.

### Retention and message cursors avoid broad read scans — 2026-08-14

- D1 Insights showed scheduled actor-identity retention reading `206.58k` rows across only 25 executions, with `11.7 ms` p50 and `16.7 ms` p99 latency. Each bounded cleanup selection scanned roughly `8.3k` rows because the existing actor indexes began with `channel_id`, while retention filters globally by `created_at`.
- Migration `0041_retention_lookup_index.sql` adds `message_actor_identities_created_idx(created_at)`. The 90-day cleanup now uses a covering age-range scan and stops after its existing 250-row batch limit.
- Cursor-based root paging separately read `160.03k` rows across 85 executions, with `39` rows read per returned row and `8.9 ms` p99 latency. Parent recovery showed the same amplification: 22 calls read `44.08k` rows at `77` rows per returned row.
- The shared visible-message condition previously built a list of every active reply in a channel on each request so deleted parents with visible replies could remain rendered. It now performs a correlated existence check through `messages_channel_deleted_reply_idx` only when a deleted candidate parent needs that decision.
- Older/newer page and message-context cursors now compare `(created_at, id)` as one tuple. This lets `messages_channel_root_created_id_idx` apply the complete stable cursor as an indexed range instead of applying the timestamp range first and evaluating the ID tie-breaker separately.
- Timestamp-only legacy cursor requests retain their existing fallback. Visibility semantics are unchanged: normal messages remain visible, deleted parents remain visible only while they have an active direct reply, and deleted messages without active replies stay hidden.
- `worker/scripts/audit-query-read-optimizations.sql` verifies the retention range, root cursor range and indexed child-existence plans after deployment. Focused tests preserve tuple bind order, context boundaries and deleted-parent behavior.

Trade-off: each actor-identity record adds one small retention-index entry, increasing message/DM identity write and storage cost slightly. Deleted parent candidates now perform individual indexed child probes instead of sharing a channel-wide reply list; deleted roots are uncommon and page candidates are bounded, making this preferable to rereading every reply on every page.

Deployment note: apply migration `0041` and deploy the Worker. No frontend deployment is required. Run the audit script, exercise older/newer paging and message navigation, then compare the new D1 fingerprints against the `11.7 ms` retention, `39` rows-per-result cursor and `77` rows-per-result parent-recovery baselines.

### Reconnect notice appears only when realtime loss affects the active view — 2026-08-14

- The WebSocket reconnect notice previously appeared after any visible-tab disconnect lasting three seconds, even while the user was reading older mounted messages or a historical context window.
- Chat history navigation now exposes a reactive near-bottom state in addition to its existing ref. The notice renders only at the normal chat live edge, where missing new messages directly affects what the user expects to see.
- Historical context and scrolled-up latest windows suppress the notice while reconnect attempts, authorization and recovery synchronization continue unchanged in the background.
- If the socket is still disconnected when the user returns to the live edge, the already-pending notice appears immediately. If reconnection completes first, no stale notice flashes.
- Active live sessions and DM composition retain the notice regardless of scroll position because their presence and incoming state are realtime-sensitive.
- Focused regression coverage preserves live-edge visibility, history suppression, live/DM exceptions and the integration between socket state and reactive scroll position.

Trade-off: a user reading older messages is not proactively told that live updates are temporarily unavailable until they return to the latest edge or enter a realtime-sensitive mode. No reconnect, recovery fetch, presence or D1 behavior changes.

Deployment note: this is frontend-only. After deployment, disconnect for more than three seconds at the latest edge, while scrolled up, in a historical context window, in live mode and in DM mode; verify the notice appears only in the realtime-sensitive cases and that returning to latest reveals it if the socket is still offline.

### Gallery paging no longer scans all visible channel messages — 2026-08-14

- D1 Insights showed the gallery query executing only 31 times but consuming about one second of database runtime, with `97.53k` rows read, `30.6 ms` p50 and `38.9 ms` p99 latency. That is roughly `3,146` rows read per request and `63` rows read per returned row.
- SQLite was starting from every visible message in the channel through `messages_channel_deleted_created_id_idx`, joining matching gallery rows by primary key, then sorting the result. Cost therefore grew with total channel history rather than with the 50 requested gallery items.
- Gallery paging now starts from gallery rows in display order and performs one indexed visible-message mapping lookup per candidate. Migration `0040_gallery_lookup_indexes.sql` adds the exact gallery ordering index and a partial index containing only non-deleted image-message mappings.
- Pagination now carries both `created_at` and `id`, preventing equal-timestamp gallery rows from being skipped between pages.
- `worker/scripts/audit-gallery-query.sql` verifies both indexes and the production query plan after rollout. Focused regression coverage preserves the gallery-first plan, visibility check and stable cursor.

Trade-off: each gallery row and each active image message adds one small index entry. Ordinary text messages are excluded from the partial message index. The older `gallery_channel_idx` remains during rollout; consider removing it only after production confirms the new ordered index serves all gallery reads.

Deployment note: apply migration `0040`, deploy the Worker, then deploy the frontend. Open a gallery with more than 50 images and load the next page, then confirm D1 Insights shows the new `CROSS JOIN` fingerprint with substantially lower rows read and latency.

### Cold chat startup defers noncritical interface code — 2026-08-13

- Production diagnostics for `/ch/synkongii` showed the channel page waiting on cold client startup while authenticated `/api/init` itself completed in about `267 ms`; later cached bootstrap calls completed in about `202 ms`.
- Search, edit, context-menu, settings, gallery, links, owner-channel, reporting, moderation, admin and other conditional overlay components now load through route-level dynamic chunks only when opened.
- Search highlighting moved into a small eager helper so normal message rendering no longer imports the full search interface.
- Welcome content, channel bootstrap, message rendering, composer and realtime/live banners remain eager because they can affect the initial usable view.
- A bootstrap superseded by auth hydration or effect cleanup now completes its local performance cycle as `superseded` instead of remaining falsely `pending`.
- Focused source coverage protects the lazy boundaries and the superseded-cycle contract.
- An apples-to-apples webpack production build reduced initial channel scripts from `920,889` to `838,210` uncompressed bytes (`9.0%`). The route-specific chat chunk fell from `267,964` to `184,866` bytes (`31.0%`).

Trade-off: the first use of a deferred panel may wait briefly for its chunk on a cold connection. Normal chat entry downloads and evaluates less optional interface code, while subsequent panel opens use the browser cache. No API, D1 or WebSocket behavior changes.

Deployment note: this is frontend-only. After deployment, test one cold channel load plus the search, edit, context menu, settings, gallery, links, report and owner-admin overlays.

### Calibrated health states deliver deduplicated external alerts — 2026-08-13

- A five-minute scheduled evaluator uses the same shared 15-minute health thresholds as the super-admin dashboard.
- Critical state sends immediately on detection, degraded state requires two consecutive non-healthy windows, and recovery requires two consecutive healthy windows.
- Migration `0039_operational_health_alert_state.sql` stores the last externally notified state so repeated cron runs do not resend the same incident. A degraded incident escalates once if it becomes critical.
- Resend idempotency is stable while a state transition is pending. Failed delivery leaves durable state unchanged for retry and records `operational_alert_delivery_failed`.
- Alert email contains bounded signal counts and dominant routes, but no raw errors, users or recipient configuration. The health API exposes only enabled/disabled state and delivery metadata.
- The existing hourly maintenance cron remains at minute 17; alert evaluation runs independently every five minutes.

Trade-off: enabling alerting adds two bounded health-window reads, one alert-state read and one bounded route-summary read every five minutes. Email is sent only on a qualified state transition. Critical detection may be delayed by up to five minutes, while degraded and recovery notifications intentionally wait for persistence to avoid transient alert noise.

Deployment note: apply migration `0039`, set the `OPERATIONAL_ALERT_EMAIL` Worker secret, deploy the Worker, then deploy the frontend. No existing threshold changes are included.

### Operational health has a repeatable baseline and response procedure — 2026-08-13

- Health thresholds now have one shared Worker definition used by both status derivation and the platform-admin API response, preventing displayed thresholds from drifting from runtime behavior.
- `worker/scripts/audit-operational-health-baseline.sql` provides a read-only seven-day baseline with zero-filled 15-minute windows, percentile/max signal counts, daily event totals, route concentration and pending cleanup jobs.
- `OPERATIONS_RUNBOOK.md` documents critical/degraded triage, route-stage investigation, realtime fallback, cleanup retries, preview failures, abuse signals, media misses, rollback decisions and recovery confirmation.
- The runbook explicitly separates failure-count baselines from true error-rate and latency SLOs because `operational_events` does not record successful requests or request durations.
- The first production run reviewed 672 fifteen-minute windows. Core 5xx and exception p50/p95/p99 values were zero, only five windows were nonzero, the maximum burst was four, and no cleanup jobs were pending. Existing thresholds were retained: isolated core failures remain degraded, exception bursts of three remain critical, and preview/forbidden signals remain contextual.

Trade-off: the baseline audit reads up to seven days of retained operational events and cleanup state when run manually. Runtime request behavior and polling are unchanged. External alert delivery remains separate work and should use the calibrated thresholds rather than introducing a second severity model.

Deployment note: the threshold refactor requires a Worker deployment but does not change current threshold values. No frontend deployment or D1 migration is required.

### Fresh media requests fail closed after access revocation — 2026-08-13

- Protected media already revalidated the current channel passcode on every network request, but an attached upload ticket could still identify media after its channel row was deleted.
- If retryable R2 cleanup had not removed the object yet, the media route treated the missing channel as an unprotected channel and could serve that object during the cleanup gap.
- The route now returns `404` as soon as the current parent channel lookup is missing, before reading R2. This keeps D1 deletion authoritative even while cross-store cleanup is pending.
- Public background edge-cache reuse now occurs only after current channel existence and passcode policy are checked. Inferred channel-key objects that are not yet linked from a row inherit the current channel policy instead of falling through to the unknown-media public cache policy.
- Public backgrounds now use a five-minute browser cache with revalidation instead of a one-week immutable browser cache, and protected backgrounds use the same five-minute browser bound instead of fifteen minutes. The one-hour shared edge cache for public backgrounds remains available, but it is reached only after current channel policy validation.
- Direct Worker media capabilities now carry a verified room-token passcode binding or authenticated owner identity. The Worker compares that capability with current channel state, so direct delivery remains on Cloudflare without allowing a URL issued before passcode rotation to bypass revocation.
- Functional regression coverage verifies that stale room headers and direct capabilities fail after passcode rotation, the current token and channel owner still succeed, deleted-channel media fails before an R2 read, and successful protected message media retains its five-minute private revalidation policy.

Trade-off: normal proxied protected-media requests already read current channel state. Direct signed media requests now add that indexed channel lookup instead of trusting only the capability expiry, increasing D1 reads in exchange for immediate passcode/deletion revocation while still avoiding Vercel media transfer. Public backgrounds revalidate more often in the browser, but R2 transfer remains reduced by the shared edge cache. A previously cached browser copy may remain visible for up to five minutes; fresh requests and revalidation are denied immediately.

Deployment note: deploy the frontend first, then the Worker. New capabilities are accepted by the old Worker, while the new Worker intentionally rejects legacy capabilities that lack a current room binding or owner identity on protected channels. No D1 migration is required.

### Open chat tabs drop stale socket privileges after logout — 2026-08-13

- Auth.js already shares session changes across tabs, and every same-origin HTTP proxy rechecks the current session before forwarding a trusted user ID.
- Chat WebSockets previously stayed mounted when that authenticated user ID changed because their connection lifecycle was keyed only to the channel and anonymous chat UID. A tab could therefore stop showing owner controls after logout while its existing Durable Object connection remained authenticated as an admin.
- The realtime hook now includes the authenticated account ID in its authorization lifecycle. Login, logout and successful account deletion followed by logout close the old socket and open a replacement that requests authorization from the current session. The token request also rejects a client/server authenticated-state mismatch during the transition instead of issuing a token from stale client state.
- On a public channel the replacement continues as a normal viewer; on a locked channel it retains only separately valid room-token access; on the reports channel it remains unauthorized without the platform-admin session.
- Focused source coverage preserves the identity-bound socket lifecycle and the cross-tab-aware session-provider boundary.

Trade-off: logging in, logging out or switching accounts while a channel is open causes one deliberate WebSocket reconnect and presence update. Ordinary renders and unchanged sessions do not reconnect, and no new D1 polling or session-validation read was added.

Deployment verification: the frontend was deployed and the two-tab logout/account-deletion flow was verified. The other tab loses owner controls and reconnects without admin authorization. No Worker deployment or D1 migration was required.

### Report moderation state synchronizes across privileged views — 2026-08-13

- Channel-level moderation actions previously rewrote every related report message on the server, but the acting reports inbox patched only the selected message and depended on receiving its own WebSocket broadcasts for the rest.
- Moderation and petition mutation responses now include the complete set of affected report inbox updates. The acting browser applies them together, so report filters and restricted-channel summaries immediately reflect warn, suspend, freeze, unfreeze and petition changes.
- Channel owners now refresh authoritative moderation details after every non-live moderation-state event, including warning and suspension transitions rather than only freeze changes.
- Report resolve/dismiss and petition accept/reject updates now verify that their conditional `open`-state write changed a row. Concurrent or repeated terminal actions return a conflict instead of producing duplicate audit or notification side effects.
- Focused regression coverage preserves the mutation response, client reconciliation, owner refresh and compare-and-set transition contracts.

Trade-off: successful channel-level moderation responses are larger because they carry metadata and formatted text for every report associated with that channel. Report counts are normally small, and this bounded mutation-time cost avoids polling and stale privileged UI state.

Deployment note: deploy the Worker and frontend together. No D1 migration is required. Verify warn, freeze, petition resolution and unfreeze from the reports inbox while the owner channel is open in another browser or tab.

### Support ticket closures authoritatively refresh the admin dashboard — 2026-08-13

- The platform dashboard already polled a lightweight support/report version, but a detected change reloaded tickets without statistics and merged the response into the existing paginated list.
- That merge could retain stale open rows or an obsolete open-page cursor after a user closed a ticket, while support counters remained stale for up to five minutes.
- Version changes and same-tab `support-ticket-changed` events now request fresh tickets and statistics and replace the dashboard snapshot and pagination cursor. An authoritative refresh arriving during another dashboard request queues behind it instead of being silently coalesced into the older request.
- Closing a ticket from the platform thread panel now emits the same refresh event after the authoritative thread reload.
- Focused source regression coverage verifies authoritative replacement, queued refresh behavior, version-triggered statistics and the close-event bridge.

Trade-off: when support or report state changes, the admin ticket list returns to its authoritative first page, so any extra open-ticket pages previously loaded must be requested again. The changed-state refresh also reads support statistics immediately instead of waiting for the five-minute stats interval. Normal unchanged version polls remain lightweight.

Deployment note: this is frontend-only. Deploy the frontend, then verify a user-side ticket closure changes the admin row and counters after the next foreground version check, and an admin-side closure refreshes the current browser immediately.

### Guided support enforces one active lifecycle per user — 2026-08-13

- Guided support already checked for an existing open session or ticket before creating another, but simultaneous requests from duplicate clicks or separate tabs could both pass the lookup before either insert completed.
- Migration `0038_support_open_lifecycle_invariants.sql` adds partial unique indexes that allow at most one `open` guided session and one `open` support thread per user while preserving unlimited resolved, abandoned, escalated and closed history.
- Session start and ticket escalation now recover a uniqueness race by loading and returning the winning open record. Concurrent callers converge on the same session or ticket instead of creating duplicates or surfacing a database `500`.
- Escalation updates now claim only sessions that are still open. Existing-ticket reuse, owned close/reset behavior and cross-user hiding have focused Worker regression coverage.
- `worker/scripts/audit-support-lifecycle.sql` reports legacy users with duplicate open sessions or tickets. The production audit returned zero duplicate users and zero excess records for both invariants before migration `0038`.
- The locked-room and live-session multi-tab checks from the preceding authorization tranche passed in production and are recorded in the launch checklist and authorization matrix.

Trade-off: support creation performs the same preflight reads as before, plus a uniqueness check maintained by SQLite on writes. Race losers perform one recovery read. This adds negligible write overhead in exchange for a durable invariant across tabs and Worker isolates.

Deployment note: the production audit passed, migration `0038_support_open_lifecycle_invariants.sql` was applied and the Worker was deployed. No frontend deployment was required. Deployed guided-support close/reset/escalate and dashboard synchronization still need browser verification.

### Room and live-session lifecycle authorization is regression-tested — 2026-08-13

- Room tokens are now covered as credentials bound to both the channel ID and current passcode hash. A token issued before a passcode change cannot authorize later message mutations, and deleted channels reject old tokens instead of being interpreted as unlocked rooms.
- Passcode authorization reads no longer use a 30-second isolate-local cache. Every affected request reads the current indexed channel row, so a change made through one Worker isolate cannot leave another isolate accepting stale room credentials.
- Data, DM and non-asset upload routes now distinguish a missing channel from an existing channel with no passcode and return `404` for the missing channel.
- Expired live-session enforcement now applies to edit, delete and reaction mutations as well as new messages, uploads and DMs. All live message mutations use one shared guard that expires stale state before rejecting the action.
- WebSocket live-presence joins use a tested decision boundary: only the current unexpired session ID joins; an old session is redirected to current session metadata, and a missing or expired session is rejected.
- The focused authorization suite covers passcode-hash rotation, deletion, every message mutation method, live content route invariants, presence decisions and unchanged normal-room access.

Trade-off: affected room requests now perform one indexed channel lookup instead of reusing a value for up to 30 seconds, increasing D1 reads in exchange for immediate global revocation. Live edit, delete and reaction requests also perform the same indexed live-state lookup as live sends. Normal-room mutations do not pay the live-state cost.

Deployment note: deploy the Worker. No D1 migration or frontend deployment is required. Multi-tab browser transition checks remain in the authorization matrix because automated Worker tests cannot verify client routing and stale UI cleanup.

### Message history windows now follow parent-message order — 2026-08-13

- Pagination previously counted roots and replies as equal chronological rows, then moved replies beneath their parents only during rendering. A late reply to `parent 1` could therefore consume a page slot and leave the adjacent `parent 2` outside the mounted window.
- Initial history, older/newer paging and message-context navigation now select root messages only. Each selected root expands into its complete visible reply group, so a thread permanently occupies its parent’s position regardless of when its replies were created.
- Context navigation resolves legacy nested reply chains to their true root before selecting the surrounding root window.
- Realtime replies are inserted only when their parent thread is already mounted. A new reply to an old unmounted parent no longer pulls that historical thread into the latest window or creates a misleading newer-page badge.
- The bounded client history cache now trims contiguous root groups instead of cutting by individual reply timestamps. Snapshot recovery similarly replaces only threads represented in the incoming root window and preserves other mounted threads.
- Migration `0037_message_root_pagination.sql` adds the chronological root index needed to avoid scanning reply activity during root-page reads.

Trade-off: a 50-root page can contain substantially more than 50 rendered rows when threads have many replies, so response size and layout time are variable. The client still keeps whole threads when enforcing its approximate 300-message mounted limit, which means one unusually large thread can exceed that limit by itself. Replies to unmounted historical parents are intentionally not surfaced in the latest view.

Deployment note: apply D1 migration `0037_message_root_pagination.sql`, deploy the Worker, then deploy the frontend.

### Expanded replies no longer create missing message windows — 2026-08-13

- Before root-owned pagination, message pages selected 50 chronological rows and then included related reply roots and children outside that raw page. The client previously used the first and last expanded messages as its next pagination cursors.
- An older expanded parent could therefore move the backward cursor past a contiguous interval of normal messages; a newer expanded reply could produce the equivalent gap while paging forward.
- The Worker now returns explicit start and end cursors from the unexpanded SQL page. Initial loading, older/newer paging, message navigation and refresh restoration retain those raw boundaries independently from the rendered message array.
- When the bounded 300-message client window trims one side, the opposite cursor uses the newly loaded raw-page boundary. This can deliberately refetch overlapping rows, which the existing ID merge removes, but it cannot skip the interval between pages.
- Regression coverage verifies that expanded thread rows outside a page do not alter its cursor contract.

Trade-off: responses carry two small cursor objects and the client maintains them separately from rendered messages. Older frontend or mock responses remain compatible through a rendered-edge fallback, which retains their prior behavior until both frontend and Worker are updated.

Deployment note: this requires both a frontend and Worker deploy. No D1 migration is required.

### Date separators follow the background-aware reply-arrow tone — 2026-08-13

- Chat date separators previously always used the muted metadata color, which could become difficult to read over dark channel colors or darkened background images.
- Date separators now reuse the same luminance and image-overlay decision already used by reply arrows. Dark backgrounds receive the bright white tone, while default and light backgrounds retain the muted metadata color.

Trade-off: image readability is still inferred from the configured overlay strength rather than the pixels directly beneath each date. This keeps rendering inexpensive and consistent with reply arrows.

Deployment note: this is frontend-only and requires no Worker deploy or D1 migration.

### Realtime gaps recover without resetting chat position — 2026-08-13

- A `message-new` event received while browsing contextual history previously incremented the newer-message badge but did not reopen the newer-page cursor. If that cursor had already reached its former end, scrolling down could not request the newly persisted message, so it appeared only after refresh or an explicit return to latest.
- Context-mode realtime events now mark newer history as available and deduplicate pending event IDs before incrementing the badge. Downward scrolling can therefore load the page containing the new message.
- Reconnect snapshots also mark contextual history as having newer content when the tab may have missed events while hidden.
- Owner reconnect handling no longer applies the bootstrap reset path. It refreshes owner-only state and merges the latest message snapshot while preserving the current history mode, mounted window and scroll anchor, matching the existing lightweight viewer recovery behavior.
- Message delivery also now recovers when D1 persistence succeeds but the Durable Object broadcast fails. A retry with the same client message ID rebroadcasts the stored row instead of returning duplicate success silently, and frontend `5xx` sends retain that ID for the next retry.

Trade-off: owner recovery retains more mounted history than a full reset and relies on the existing bounded history-window trimming during subsequent navigation. Context-mode reconnects cannot know the exact number of missed messages from the snapshot alone, so they reopen pagination without inflating the unread badge. Duplicate retries use at-least-once broadcast delivery, so clients must continue deduplicating by message ID.

Deployment note: this requires both a frontend and Worker deploy. No D1 migration is required.

### Message editing uses the centered dialog overlay again — 2026-08-13

- Message editing previously rendered as an inline panel beneath the chat header and search bar. Its height became part of the chat flex layout, which could push or compress the message viewport and make the editor appear to break the top of the page.
- The inline variant has been removed. Message editing now uses the same fixed, centered backdrop and bounded-width panel pattern as notice-banner editing.
- Opening or closing the editor no longer changes header or message-pane dimensions.

Trade-off: editing temporarily covers the conversation with a modal backdrop instead of keeping the timeline fully visible. This matches the existing notice editor and provides more predictable behavior across narrow and desktop layouts.

Deployment note: this is frontend-only and requires no Worker deploy or D1 migration.

### Owner DMs now follow the loaded chat history window — 2026-08-13

- Owners receive a fixed recent-DM snapshot during channel initialization while normal chat messages load in cursor-based pages.
- The renderer previously merged every cached DM into every normal-message window. An older DM could therefore appear at the top before the corresponding normal history page arrived, then move again when that page was inserted and scroll anchoring settled.
- Owner DMs are now interleaved only when they fall inside the loaded normal-message time window. Older DMs enter with the corresponding older page; while browsing contextual history, newer DMs remain hidden until newer message pages reach their timestamp.
- Channels with no normal messages still show their available DMs, preserving owner access to DM-only activity.

Trade-off: a cached DM outside the current contextual window remains hidden until normal history reaches the same period. Latest mode keeps its upper boundary open so realtime DMs can still appear immediately. This produces a coherent paginated timeline but does not turn DMs into an independently pageable inbox; the existing initialization snapshot still limits available DMs to the latest 50.

Deployment note: this is frontend-only and requires no Worker deploy or D1 migration.

### Touchscreen laptops can use Enter to send messages — 2026-08-13

- The chat composer previously treated any browser with touch-event support or a positive `maxTouchPoints` value as mobile and disabled Enter-to-send.
- Touchscreen Windows laptops therefore inserted a newline when users pressed Enter on their physical keyboard, even though the same behavior worked on non-touch laptops.
- The composer now uses a narrow viewport plus a coarse primary pointer as the mobile-layout signal instead of touchscreen capability alone. On typical phones, Enter inserts a newline and the visible send button submits; on desktop layouts, including touchscreen laptops with a mouse or trackpad, Enter submits.
- `Shift+Enter` still inserts a newline, and Enter events emitted while an IME is composing text remain ignored so composition can finish safely.

Trade-off: browser media capabilities describe the current layout and primary pointer, not the actual source of each key event. A narrow tablet with an attached keyboard can still use mobile newline behavior, while a phone using a fine primary pointer can use desktop send behavior. This is more reliable for touchscreen laptops than treating all touch-capable devices as mobile.

Deployment note: this is frontend-only and requires no Worker deploy or D1 migration.

### Duplicate in-flight history pages now coalesce — 2026-08-13

- A request-path audit confirmed that channel initialization already coalesces concurrent same-channel `/api/init` calls and the history scroll handler prevents overlapping loads with a synchronous ref.
- The API client now adds a second guard for message paging: concurrent requests with the same channel, direction, timestamp and message-ID cursor share one network promise.
- The entry is removed immediately after success or failure. Completed pages are not cached, so returning to the same boundary later still reads current server data.
- Latest-message refreshes are intentionally not coalesced with this mechanism because a websocket synchronization event may require a snapshot newer than an already-running request.

Trade-off: concurrent callers for an identical history boundary receive the same response, which is appropriate for one in-flight pagination operation. The request-key map is process-local, short-lived and bounded by active requests rather than retained history.

Deployment note: this is frontend-only and requires no Worker deploy or D1 migration.

### Thread lookups now use bounded D1 query shapes — 2026-08-13

- Root and child thread lookups previously generated a distinct SQL string for every `IN`-list length from one to 50, fragmenting equivalent work across many D1 Insights fingerprints.
- Lookup sizes now use seven buckets: `1`, `2`, `4`, `8`, `16`, `32` and `50`. Lists between bucket sizes repeat their final ID until the next bucket is reached; duplicate values in an `IN` predicate do not alter the matched rows.
- The 50-root maximum remains unchanged and each statement still stays below D1's variable limit.
- Regression coverage verifies padding behavior, stable result semantics and the existing full-page parameter bound.

Trade-off: padded statements bind up to the next bucket's number of values, adding a small amount of query text and parameter processing. This is primarily an observability improvement for D1 Insights, not a direct read-cost reduction.

Deployment note: this requires a Worker deploy only. No D1 migration or frontend deploy is required.

### Message paging reuses roots already loaded in the page — 2026-08-13

- Visible-message paging already has the selected page rows before expanding their complete reply groups. It now passes those loaded message IDs into thread expansion instead of querying every root by primary key again.
- The root statement is omitted when every requested root is already present, or restricted to only missing roots when a page starts on a reply whose parent is outside the page.
- The indexed child lookup still covers every requested root, preserving complete visible reply groups. Standalone `message-context` reads do not supply loaded IDs and continue fetching both roots and children.
- Regression coverage verifies all-loaded, mixed loaded/missing and standalone lookup behavior, along with parameter bounds and chronological merging.

Trade-off: the saving is bounded to roughly 50 inexpensive primary-key reads per full page and is much smaller than replacing the high-read `requested_roots` CTE. The conditional batch shape also creates separate one-statement and two-statement execution patterns, but does not change the response contract.

Deployment note: this requires a Worker deploy only. No D1 migration or frontend deploy is required.

### Durable Object presence resets no longer fail channel initialization — 2026-08-13

- Production correlation found three `/api/init` `500`s and one `/ws/:channel` `500` for `zziks` within 21 milliseconds. All four carried the same Cloudflare Durable Object storage-reset reference, identifying one realtime infrastructure incident rather than four independent application failures.
- `/api/init` previously awaited message reads, configuration reads and the nonessential Durable Object presence count in one `Promise.all`. A rejected presence request therefore discarded otherwise valid bootstrap data and failed room entry.
- Presence loading now fails open: a failed, non-successful or malformed Durable Object response returns a temporary count of `0`, while channel data and messages continue loading normally.
- Each fallback records a `realtime_unavailable` operational event with the channel, stage and provider error. The super-admin health view exposes these events separately and marks recent realtime fallback as degraded, so graceful recovery does not hide recurring platform resets.
- Regression coverage verifies normal presence, storage-reset fallback, malformed response handling, event recording and health aggregation.

Trade-off: during a Durable Object reset, users can briefly see a presence count of `0` until the socket reconnects or a later init succeeds. WebSocket establishment can still fail during the reset itself, but existing reconnect behavior can recover without channel bootstrap also failing.

Deployment note: this requires both a Worker deploy and frontend deploy for the updated health card. No D1 migration is required.

### Flat thread expansion now uses direct batched index lookups — 2026-08-13

- Production D1 Insights showed the `WITH requested_roots(id) AS (VALUES ...)` query family consuming most database runtime. Its largest fingerprint read `212.62M` rows and represented `12.03%` of runtime, while the family read roughly `2.7k-3.6k` rows for each row returned.
- Root-thread expansion now sends two statements in one D1 batch: roots are selected through the message primary key and direct children through the existing `(channel_id, reply_to, deleted)` index.
- Each statement uses at most 51 bound values for a full 50-root page, remaining below D1's variable limit without the materialized values CTE or union-level sort.
- The Worker merges and chronologically sorts both result sets after the batch, preserving the existing root-plus-visible-direct-replies response contract for init, normal paging and message-context navigation.
- Regression coverage verifies the two indexed query shapes, parameter bounds and merged result order.

Trade-off: one logical expansion now executes two D1 statements instead of one, although both travel in the same batch. This slightly increases statement count in exchange for avoiding the measured high rows-read query shape.

Deployment note: this requires a Worker deploy only. No D1 migration or frontend deploy is required. After representative traffic, compare the new `id IN (...)` and `reply_to IN (...)` fingerprints against the recorded CTE baseline.

### Channel deletion now survives partial Durable Object and R2 failures — 2026-08-12

- Channel deletion now inserts a durable cleanup job containing the exact media-key snapshot in the same D1 batch that removes the channel and related application rows.
- Durable Object invalidation and R2 deletion are tracked as independent idempotent stages. The request still attempts both immediately, but a failure no longer disappears after the channel row is gone.
- Hourly maintenance retries up to 20 due jobs with exponential backoff from one minute to 24 hours. A short lease limits overlapping scheduled attempts, and completed jobs are retained for 30 days before bounded removal.
- Account deletion uses the same workflow for every owned channel and reports whether external cleanup remains pending.
- Cleanup failures and later recoveries are recorded as operational events. The super-admin health view exposes recent cleanup retry failures as a degraded signal without classifying them as request `5xx`.
- Regression coverage verifies retry policy, media-key validation, atomic job/deletion ordering, scheduled retry wiring and health aggregation.

Trade-off: deletion now adds one D1 job row and several small progress updates, and failed external cleanup can retain a bounded media-key manifest for up to 30 days after recovery. In exchange, transient Durable Object or R2 failures are recoverable and visible instead of silently leaking stale state or media.

Deployment note: apply D1 migration `0036_retryable_channel_cleanup.sql` before deploying the Worker, then deploy the frontend for the updated health card.

### YouTube cards no longer depend on external metadata — 2026-08-12

- Production inspection showed standard YouTube preview requests returning `502` because the Worker treated its noembed title lookup as mandatory, even though YouTube thumbnails are available from a deterministic video-ID URL.
- YouTube cards now return immediately from the parsed video ID with the deterministic thumbnail, site name and original link. The noembed request was removed from the critical path rather than retained as a possible five-second delay.
- URL parsing now supports short links, Shorts, live links, embed links and watch URLs where `v` is not the first query parameter.
- The Worker preview cache version was advanced so previously cached YouTube failures and empty generic results do not delay recovery after deployment.

Trade-off: the lightweight YouTube card contains the thumbnail and YouTube label but not the video title or author. This removes an external request and its failure/latency entirely from the user-visible success path.

Deployment note: this requires both a Worker and frontend deploy. No D1 migration is required.

### YouTube and Instagram now use lightweight preview cards — 2026-08-12

- YouTube and Instagram links now use the same deferred `/api/preview` metadata cards and persistent browser preview cache as other external links.
- Their third-party iframe/widget paths, Instagram script loader, responsive widget observers and media loading dots were removed.
- These platform cards remain static even when metadata includes a video URL. Selecting the card opens the original YouTube or Instagram URL instead of playing content inside chat.
- Preview metadata failure leaves the original clickable link visible, avoiding messages that could remain as loading dots when a third-party script, iframe or post was blocked or unavailable.
- Obsolete YouTube, Twitter and Instagram script, connection and frame origins were removed from the frontend Content Security Policy because no client widget path requires them anymore.

Trade-off: YouTube videos and Instagram posts no longer play inline, and private or metadata-restricted posts may show only their original link. In exchange, chat rendering uses fewer third-party requests, has less layout movement, and no longer depends on platform widget scripts or iframe readiness.

Deployment note: this is frontend-only and requires no Worker deploy or D1 migration.

### Live-session ending now reconciles stale and background tabs — 2026-08-12

- Live end requests now include the session ID the owner tab believes it is ending. The Worker conditionally claims only that exact session, so an old owner tab cannot terminate or delete a newer live session.
- Reconnecting viewers and tabs returning from the background now refresh authoritative live state before sending `join-live`. Ended sessions return to normal chat, changed sessions show the current join prompt, and unchanged sessions restore live presence.
- The Durable Object validates every live-presence join against D1, clears persisted live-presence flags when a session ends, and returns the current session snapshot when a client presents a stale ID.
- Owner tabs retain their current live UI until the end request succeeds. Failed requests remain retryable, while a session-conflict response exits the stale session and loads the current state.
- Tabs in the same browser also react to the persisted live-active flag changing to false, reducing the delay between an end action in one tab and cleanup in another.
- Regression coverage verifies matching, stale and already-ended session behavior plus the reconnect and websocket session guards.

Trade-off: reconnecting or foregrounded tabs that still hold local live state perform an additional `/api/init` reconciliation before restoring presence. Live ending also waits for Worker confirmation instead of appearing instantaneous, which prevents destructive stale-tab actions and false local success.

Deployment note: this requires both a frontend and Worker deploy. No D1 migration is required.

### Media `404` misses are now visible without affecting core health severity — 2026-08-12

- Production error analytics showed enough `/api/media/...` `404` traffic that operators needed it visible, but those misses should not carry the same weight as core backend `5xx`, exceptions or maintenance failures.
- The Worker now records grouped `media_not_found` operational events for `GET /api/media/:key` responses, with the support health payload exposing a dedicated media-`404` counter in both the 15-minute summary and 24-hour route breakdown.
- Media paths are normalized the same way websocket paths are, so missing media no longer fragments the health view by individual object key.
- Health severity calculation is unchanged: media `404` stays visible as a secondary signal and does not degrade the overall service status.
- Client-cancelled `499` traffic is still edge-analytics-only. The Worker cannot reliably persist those cancels after the client disconnects upstream, so that portion remains outside the in-Worker health model for now.

Trade-off: the health card now carries one more low-priority metric, which slightly increases operator detail in exchange for making media churn visible without conflating it with backend failures.

Deployment note: this requires a Worker deploy for event recording and aggregation, plus a frontend deploy for the updated super-admin health card. No D1 migration is required.

### Websocket health routes now roll up by category instead of channel ID — 2026-08-12

- Production error analytics included channel-specific websocket paths like `/ws/synkongii`, which fragmented the same class of connection failures across per-channel route labels and made the health view harder to interpret.
- Operational-event route normalization now records websocket requests under `GET /ws/:channel` instead of the raw per-channel path, while retaining the concrete channel ID in structured event detail.
- The Worker websocket branch now records forbidden, `5xx` and unhandled upgrade failures through the same operational-event path as the HTTP API branch instead of bypassing the health model on early websocket errors.
- The super-admin operational-health query also normalizes historical `GET /ws/<channel>` rows inside the 24-hour route aggregation, so the grouped websocket category appears immediately after deploy without waiting for the old rows to age out.

Trade-off: the route label is now intentionally less specific in the summary card. Operators trade direct per-channel route names in the first-line health view for a more accurate grouped websocket signal, while the stored detail still preserves the channel ID for deeper inspection.

Deployment note: this requires a Worker deploy only. No D1 migration or frontend deployment is required.

### `/api/init` and `/api/messages` failures now record route stage detail — 2026-08-12

- Production error analytics showed `/api/init` and `/api/messages` behind preview failures as the next most actionable backend `5xx` buckets, but the existing `unhandled_exception` events only recorded route, method and message text.
- The Worker now attaches operational error context to unexpected throws inside both handlers, including the route action for message mutations and the active route stage such as channel load, passcode verification, rate limiting, reply resolution, persistence or broadcast.
- The top-level Worker exception recorder now merges that route context into the stored `detail_json` for `unhandled_exception`, so D1 operational-event inspection can identify where a bootstrap or mutation fault happened without first reproducing it locally.
- Coverage now verifies the helper merges detail onto thrown errors and that both route files keep the instrumentation in place.

Trade-off: this does not change client responses or the super-admin health card yet. The gain is better backend observability, while deeper UI drill-down would still require a separate admin-facing log view.

Deployment note: this requires a Worker deploy only. No D1 migration or frontend deployment is required.

### Preview upstream failures no longer inflate core service 5xx health — 2026-08-12

- Production error analytics showed `/api/preview` as the largest 24-hour `5xx` bucket, ahead of `/api/init` and `/api/messages`, even when the failures were caused by third-party sites timing out or returning bad upstream responses.
- The Worker now tags preview `502/503/504` responses as `preview_upstream_failed` instead of the generic `request_failed` event type used for core backend `5xx` health.
- The super-admin health summary and route breakdown now expose preview upstream failures as their own counter, so core service health is no longer degraded by external preview targets while those failures remain visible for operators.
- The follow-up monitoring plan now explicitly tracks `/api/init`, `/api/messages`, websocket grouping, and media `404` or client-cancelled traffic separately instead of treating all error buckets as equally actionable.

Trade-off: raw HTTP analytics and CDN edge error charts will still show preview `502/504` responses because the HTTP semantics remain unchanged. Only the internal operational-health model is reclassified to better reflect platform health.

Deployment note: this requires a Worker deploy for the event classification and health aggregation change, plus a frontend deploy for the updated super-admin health card. No D1 migration is required.

### Search boundary loads now hold the viewport until the target window settles — 2026-08-10

- When search navigation stepped into older matches that were not mounted, the chat kept the previous fast-path improvement of deferring the final scroll but still visibly bounced while `message-context` replaced the window underneath the reader.
- Search-triggered message jumps now pin the current scroll position during that context swap and hold it until the replacement window finishes its history-layout settling pass.
- The jump to the next match now happens only after the target window is ready, so boundary loads no longer show the interim upward/downward bounce before landing on the new result.

Trade-off: during a boundary load, the viewport intentionally stays fixed instead of reflecting intermediate layout changes. If the user interrupts that load, the hold is released and the jump is cancelled.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Search result stepping now skips context reloads for mounted messages — 2026-08-10

- Chat search next/previous navigation previously called `scrollToMessage` in the same full-context mode used for explicit deep links and gallery jumps.
- Even when the target result was already mounted, each step fetched `message-context`, replaced the message window, waited for history stabilization and only then scrolled, which made in-channel result stepping feel laggy.
- Search navigation now prefers the mounted DOM message when it already exists and scrolls directly without refetching context or rehydrating the history window.
- Search state updates also now reuse the same `resultIds` array across ordinary next/previous steps, so active-match changes no longer rebuild the result-id list on every click. Admin search input also reuses a memoized combined message array instead of recreating it on every active-match update.
- Explicit non-search jumps, including media/gallery jumps and targets that are not mounted, still use full `message-context` hydration.

Trade-off: if a mounted search result belongs to a partially loaded thread window, stepping to it no longer forces sibling-thread rehydration. This is intentional because search stepping now prioritizes responsiveness over completeness refresh for already visible targets.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Blocking no longer retroactively marks older messages — 2026-08-10

- Chat rendering previously derived a blocked-user uid set from the owner moderation list and applied a dimmed blocked-sender style to every mounted message from that uid.
- Blocking now affects send permission and moderation state only. Older messages remain visually unchanged after a user is blocked.
- The blocked-sender render plumbing was removed from the chat message selector and message-list prop chain, so this no longer recomputes or propagates a historical blocked marker through the message pane.

Trade-off: owners no longer get an inline visual cue on previously posted messages from currently blocked users. The blocked-user list, send prevention, petitions and realtime self-block handling remain unchanged.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.


### D1 variable-bound thread expansion and accurate 5xx counting — 2026-08-10

- Five real `/api/data` failures were recorded twice as ten route errors because each thrown request emitted both `unhandled_exception` and `request_failed`. Unhandled requests now emit only the more specific event.
- The failures occurred when a 50-message page contained 50 unique thread roots. The flat-thread query repeated all root placeholders for roots and children, producing 102 bound variables and exceeding D1's statement limit.
- Root IDs now enter the query once through a `requested_roots` values CTE and are joined for both root and child lookups. A full 50-root page uses 52 variables while retaining non-recursive indexed lookups.
- Regression coverage verifies the maximum page case remains below 100 bound variables and that unhandled failures are not counted twice.

Trade-off: the values CTE adds a small amount of SQL planning structure, but removes duplicated bindings and preserves the same returned thread rows and ordering.

### Live-session search uses the active message channel — 2026-08-15

- The in-chat search bar now targets the active live message channel (`<channel>_live`) while the viewer is in live mode instead of querying the normal channel's history.
- Switching between normal and live chat remounts the search bar so query results, pagination cursors and the active result cannot leak across the two message stores.
- The Worker search and authorization paths already support live channel IDs, so this is a frontend routing correction with no schema or API response change.

Trade-off: an open search is cleared when the viewer enters or leaves live mode. This avoids showing stale results that belong to the other message store.

### Explicit media-size upload feedback — 2026-08-15

- Chat and DM sends now validate every selected media Blob against the existing 10MB-per-file limit before starting any upload, so a mixed selection cannot be partially sent before an oversized item is discovered.
- The upload client preserves HTTP 413 responses as a distinct `MediaUploadTooLargeError` instead of collapsing them into the generic null upload result.
- Korean and English chat banners now state that the media is too large and identify the 10MB per-file maximum. Other upload, network and message failures retain the existing generic send-failure handling.

Trade-off: if any selected file exceeds 10MB, the entire send attempt remains in the composer until the oversized item is removed or replaced. This favors predictable all-or-nothing feedback over partial multi-image delivery.

### Bounded Worker cache for failed link previews — 2026-08-09

- The Worker preview route now caches unsupported or stable client failures for 15 minutes, transient upstream gateway and timeout failures for 60 seconds, and successful responses without usable title/image metadata for five minutes.
- Successful metadata keeps the existing one-hour cache. Rate-limit responses, internal failures and URL-policy rejection before a cache key is accepted are not cached.
- This prevents repeatedly rendered unsupported, empty or temporarily unavailable links from triggering another outbound metadata fetch on every visit while retaining prompt recovery from temporary upstream failures.

Trade-off: a link that begins returning valid metadata immediately after a cached failure can keep its fallback card for at most the applicable one- or fifteen-minute window. The bounded TTLs intentionally favor lower outbound traffic without turning failures into long-lived browser-session state.

### In-flight channel-init request deduplication — 2026-08-09

- Client calls for the same normal or live channel now share one in-flight `/api/init` request instead of issuing parallel copies when bootstrap, reconnect and state-refresh triggers overlap.
- The broker retains no completed response, so a later refresh still reaches the server and receives current notice, passcode, moderation, live and channel-setting state.
- Successful passcode verification explicitly drops any matching normal/live in-flight entry before the authenticated refresh begins.

Trade-off: simultaneous consumers now receive the same success or failure. This only coalesces an already-running request and does not introduce a freshness window, so it reduces burst duplication without delaying later state changes.

### Distinct Worker path for profile-channel reads — 2026-08-09

- The same-origin `/api/user?channel=...` proxy now forwards public owner-profile channel reads to `/api/user/profile-channels` while authenticated dashboard bootstrap remains on `/api/user`.
- The Worker already routes the namespaced path through the same validated handler, so response shape, authorization behavior and UI remain unchanged.
- Cloudflare path analytics can now separate profile-popup traffic from authenticated dashboard state reads before any caching or broader user-state optimization is considered.

Trade-off: historical `/api/user` analytics and new measurements are not directly comparable until the profile-channel share is accounted for. This is intentionally a measurement-only split and does not reduce requests by itself.

### Five-minute private browser cache for chat media — 2026-08-09

- Authorized message, legacy-gallery and DM media responses now use `private, max-age=300, must-revalidate` instead of `private, no-store`.
- Only the browser that successfully fetched the protected media may reuse it for five minutes; Cloudflare and other shared caches remain prohibited from storing the response.
- Channel configuration assets retain `private, no-store`, while the existing profile and background cache policies remain unchanged.

Trade-off: after a photo is deleted or the viewer loses access, a copy already fetched by that browser can remain reusable from its private cache for up to five minutes. New requests after expiration must revalidate, and users who never passed channel authorization cannot populate this cache.

### Lower super-admin dashboard and support-thread polling cost — 2026-08-09

- The visible super-admin dashboard now refreshes its full reports, ticket lists and support-stat aggregation every 60 seconds instead of every 30 seconds. Operational health retains its independent five-minute freshness window.
- An open platform-support thread still checks for new messages every 30 seconds, but its linked guided-session transcript is fetched only once per `source_session_id` instead of on every poll.
- Focus and visibility events within ten seconds of a successful thread read no longer issue another identical request. Sending a reply or closing a thread forces a fresh read and waits behind any request already in flight.

Trade-offs: a new report or ticket can take up to 60 seconds to appear in the super-admin list rather than 30 seconds. Linked guided-session data is treated as immutable after ticket escalation; message-thread state remains independently refreshed every 30 seconds.

### Event-sensitive super-admin reads and incremental support polling — 2026-08-09

- The super-admin dashboard now polls a lightweight `dashboard-version` response once per minute. Full reports and ticket lists reload only when support-thread or channel-report activity changes, or after an explicit local action/manual refresh.
- Support statistics were split into a dedicated endpoint and refresh independently every five minutes instead of running their message rollup on every list refresh.
- Operational health performs no startup read. Its card is collapsed initially, loads on first expansion, and only then participates in the existing five-minute visible-tab refresh cycle.
- Closed platform-support threads stop polling. Open threads send their last `(created_at, id)` cursor and receive only newer immutable messages, while thread status continues to refresh every 30 seconds.
- Linked guided-session transcripts remain one read per source session, and bounded cursor validation prevents oversized or malformed incremental-read parameters.

Trade-offs: the full admin list can be up to 60 seconds behind a remote change, statistics can be up to five minutes behind, and operational health is unavailable until the administrator expands its card. The lightweight version query still performs two small indexed/aggregate reads per minute, but avoids repeated ticket serialization and message-rollup work when nothing changed.

### Worker security checks run continuously in GitHub Actions — 2026-08-09

- Added a least-privilege GitHub Actions workflow for Worker changes on `main`, pull requests targeting `main`, and manual dispatch.
- The workflow installs from the Worker lockfile, runs the complete authorization/hardening suite, performs the Worker TypeScript check and verifies the Wrangler bundle with `--dry-run`.
- Path filtering avoids consuming CI time for frontend-only or documentation-only changes, while edits to the workflow itself always exercise the check.
- Concurrency cancellation prevents stale runs for the same branch from consuming unnecessary Actions time.

Trade-off: until GitHub branch protection requires the `Worker security and type checks` status, this is an automatic detector rather than a deployment gate. It intentionally does not hold Cloudflare credentials, deploy the Worker or apply D1 migrations.

Deployment note: this is repository automation only. It requires no frontend deployment, Worker deployment or D1 migration.

### Privileged authorization boundaries share one tested identity primitive — 2026-08-09

- Added a server-side role and route matrix documenting guest, room-viewer, logged-in, channel-owner and platform-admin evidence. The matrix explicitly treats UI visibility as non-authoritative.
- Added a shared trusted-identity primitive that accepts `X-User-Id` only when the matching internal proxy secret is present. Channel admin, private data, socket authorization, report moderation and platform-support boundaries now reuse it.
- Added focused Worker tests for forged identity, missing identity and valid proxy assertions, plus route invariants proving owner and platform-role comparisons remain server-side and owner-only collections are denied before data dispatch.
- Channel background updates now reject non-string image values before URL normalization, closing the existing typecheck gap and keeping malformed payloads out of the media validator.
- Remaining browser-visible support, report and dashboard transitions are listed as unchecked work instead of being implied complete by lower-level tests.

Trade-off: the shared primitive removes copy-pasted trust decisions, while source-boundary tests detect accidental bypasses without adding a Worker test runtime dependency. They do not replace end-to-end tests for cookies, Auth.js callbacks, room-token expiry, cross-object mutations or multi-tab state synchronization.

Deployment note: this phase adds tests and documentation only. It requires no frontend or Worker deployment and no D1 migration.

### Message context reuses flat direct thread reads — 2026-08-09

- Gallery navigation, search navigation, direct message links and refresh-position recovery now derive the target thread root directly as `target.reply_to || target.id`.
- The endpoint reuses the same indexed flat-thread reader as normal message paging: one root lookup plus direct children by `(channel_id, reply_to)`.
- This removes the separate ancestor lookup request and the descendant recursive CTE from `message-context`.
- The surrounding context contract is unchanged: up to 25 older messages, the target, up to 25 newer messages, and the target's complete visible flat reply group are merged and returned chronologically.

Trade-off: `message-context` now relies on the same depth-one reply invariant as normal paging. The production audit found no nested legacy rows and the write path normalizes every new reply to its root, but the reusable audit remains the safeguard against manual or out-of-band invalid writes.

Deployment note: this is Worker-only and requires a Worker deploy, but no D1 migration.

### Normal message pages expand flat threads without recursion — 2026-08-09

- `readVisibleMessagePage` now derives each page row's root directly as `reply_to || id`, relying on the audited depth-one invariant and the Worker write normalization.
- Root messages are fetched by id and their visible replies by the existing `(channel_id, reply_to, deleted)` index in one `UNION ALL` query.
- The per-page ancestor traversal and descendant recursive CTE are removed from channel entry, refresh, older paging, newer paging, reconnect refresh and latest-message reload paths.
- Deleted roots referenced by a visible page reply remain present, while deleted child replies remain excluded; chronological ordering and whole-root-thread page expansion are unchanged.
- The focused query test now verifies one direct D1 call, deduplicated root ids, placeholder order, indexed child filtering and the absence of recursive SQL.

Trade-off: this hot path now depends on the enforced flat-reply invariant. The production audit script and root-normalizing write path are required safeguards; `message-context` now shares the same direct flat-thread reader.

Deployment note: this is Worker-only and requires a Worker deploy, but no D1 migration.

### Production reply audit confirms no legacy backfill is needed — 2026-08-09

- Added `worker/scripts/audit-flat-replies.sql` as a reusable read-only audit for total replies, nested relationships, broken or cross-channel parents, cycles, maximum depth and per-channel nested counts.
- The production audit found 4,682 messages and 747 replies, with zero nested replies, zero missing parents, zero cross-channel parents, zero cyclic chains and a maximum reply depth of one.
- Because every existing reply already points directly to a top-level message, the planned data backfill was intentionally skipped; no production rows were rewritten.
- The audit checkpoint bookmark is `000008f4-0000000c-000050c3-850e65485580e6fa14ccd81a5b287456`.

Trade-off: the audit is a point-in-time guarantee. The phase-1 Worker write normalization now prevents new nested replies, while the reusable audit should be rerun before removing recursive compatibility reads.

Deployment note: this phase adds documentation and a read-only audit script only. It requires no D1 migration, Worker deploy or frontend deploy.

### New replies are flattened onto their visible root message — 2026-08-09

- The Worker now resolves every submitted `reply_to` chain to its top-level message before inserting and broadcasting a new chat message.
- Reply targets must be bounded strings, belong to the same normal or live channel, exist as a visible message at send time, and lead to a real top-level root; missing, cross-channel, deleted-target, broken and cyclic chains are rejected.
- A reply written from another reply therefore stores the root id directly (`A <- B`, `A <- C`) instead of creating a deeper chain (`A <- B <- C`).
- Normal top-level messages add no D1 lookup. Only reply sends perform the temporary recursive root resolution required while legacy nested data still exists.
- Focused Worker tests cover input normalization, channel binding, visible-target enforcement, root selection and invalid-chain rejection.

Trade-off: the service intentionally discards which child reply the sender clicked and preserves only the flat root-thread relationship. Reply sends add one indexed recursive read until legacy rows are backfilled; this is the accepted first rollout phase before simplifying page reads.

Deployment note: this is Worker-only and requires a Worker deploy, but no D1 migration in this phase. Existing nested replies remain readable through the current recursive compatibility queries.

### Recursive thread reads reuse one visible-parent set — 2026-08-09

- Root-thread expansion now computes the channel's visible `reply_to` parent ids once in a shared recursive-query CTE.
- Both the seed and descendant visibility checks reuse that set instead of embedding the same channel-wide deleted-parent subquery twice.
- The returned thread rows, deleted-parent placeholders, chronological ordering and 50-message paging contract remain unchanged.
- A focused Worker test verifies that the generated query contains one parent-set scan and that its dynamic root/channel bindings stay in SQL placeholder order.

Trade-off: the shared CTE can materialize a temporary distinct parent-id set for the channel. This adds a small fixed setup cost, but avoids repeating the same scan inside both recursive visibility branches; production D1 Insights must determine the actual rows-read improvement.

Deployment note: this is Worker-only and requires a Worker deploy, but no D1 migration.

### Chat header icons use full-height touch targets — 2026-08-09

- Back, channel-rules, share, search and menu buttons now use the full header height as their vertical click area.
- Their visible icons remain in the same positions and sizes, while each invisible horizontal hit target is widened to 36px without overlapping adjacent controls.

Trade-off: clicking the otherwise empty vertical space directly above or below an icon now activates that icon instead of the header's scroll-to-top action. This is intentional for easier mobile use.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Selected reaction badges retain their filled background — 2026-08-09

- Reactions selected by the current user now keep the same gray filled background as the other reaction badges.
- The selected state remains identifiable through the channel-colored border and count, without becoming visually transparent against the chat background.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Live viewer count follows the notice banner height — 2026-08-09

- The channel notice and live viewer-count badge now share one top overlay stack instead of using independent absolute positions.
- When a notice is visible, the viewer count sits below its actual rendered height and continues to follow it when the notice is expanded or collapsed.
- Without a notice, the viewer count retains its previous top-right placement.

Trade-off: an expanded notice intentionally pushes the viewer badge farther into the message viewport, but the badge remains visible instead of being covered.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Report view state is scoped to the active channel — 2026-08-09

- The report-channel view and owner filter now retain the channel ID they belong to instead of being reset by an effect after navigation.
- A newly opened channel treats stale state from the previous channel as the default immediately, so report filters cannot briefly leak across channels.
- Report-view actions rebase the state onto the active channel, removing the synchronous state writes and extra render previously triggered by every channel change.

Trade-off: the related values are now grouped in a slightly more complex state object. Any future report-view field must follow the same channel-scoped reset behavior.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Live message reports stay inside the live session — 2026-08-09

- Reporting a message while viewing live mode now creates the admin-only report relay in `${channelId}_live` instead of the parent channel.
- The channel Durable Object already broadcasts live-channel messages to connected clients, and realtime filtering displays the report only to an admin currently viewing that live session.
- Non-live reports continue to use the parent channel, while the existing unreport path already targets the matching live or normal channel.
- Live report relays are intentionally deleted with all other live-session messages when the session ends.

Trade-off: an admin who does not review the report before the live session ends cannot recover it afterward. This matches the accepted ephemeral live-session policy.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Older-message prepends settle before one final anchor correction — 2026-08-09

- The first visible message and its viewport offset remain locked as the anchor while older messages load above it.
- One immediate post-render adjustment accounts for the synchronous height of inserted rows; mutation and media-load observers then remain disabled for the entire `older` phase.
- Deferred embeds are activated and only content at or above the anchor is checked for loading markers, incomplete images, video metadata and offset changes.
- After the anchor offset stays unchanged for 900ms, its saved viewport position is restored exactly once and the lock is released. A second older-page request cannot start while this phase is active.
- Newer-message appends retain their independent observer behavior, and the message container continues to disable native browser `overflow-anchor` so it cannot compete with explicit corrections.

Trade-off: the anchor can drift while slow media above it expands, then snap back once after settlement. A 45-second timeout prevents failed external embeds from blocking history loading forever, while direct user interaction cancels the final correction.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Older and newer history loads use separate anchor correction phases — 2026-08-09

This intermediate approach was superseded by the single-final-correction strategy above after continued upward-scroll jitter was observed.

- Prepending older messages now marks an explicit `older` anchor phase and temporarily suppresses mutation/load observer corrections until the first post-prepend anchor restoration finishes.
- This prevents the observer and the manual prepend correction from moving the same visible anchor during the same render cycle, which caused upward-history scrolling to jump.
- Once the initial prepend offset is restored, observer-based corrections resume for delayed images, widgets and media above the anchor.
- Appending newer messages keeps its separate `newer` phase and existing behavior because content added below the visible anchor does not require the prepend suppression.

Trade-off: layout events that finish during the short initial prepend frame are handled immediately after the first anchor restoration instead of independently during that frame. This intentionally serializes corrections to avoid competing writes to `scrollTop`.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Gallery navigation waits for the complete mounted history window — 2026-08-09

- Context navigation now activates every deferred widget and link preview in the newly mounted message window before positioning the selected message.
- The navigation waits until loading indicators and preview requests are gone, all mounted images are complete, videos have metadata, and the full container height remains unchanged for 900ms.
- Only then does it perform one final center alignment, replacing the previous approach that moved immediately and corrected the position repeatedly while content continued rendering.
- A 45-second upper bound prevents an unresponsive third-party embed from blocking navigation forever, and wheel, touch or pointer input still cancels the wait.

Trade-off: media-heavy windows can take noticeably longer to navigate and can initiate more image, preview and third-party embed requests at once. The change intentionally favors stable positioning over immediate movement.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Close controls share the notice-banner X icon — 2026-08-09

- Close controls across chat panels, guides, search, reply UI, expanded posts, login and admin settings now use the same SVG geometry, size and rounded stroke as the notice banner.
- Small removal controls for pending photos, rules, banned words and emoji presets use the same icon as well while retaining their existing hit areas and destructive colors.
- A shared `CloseIcon` component prevents individual screens from drifting back to differently sized text glyphs.

Trade-off: compact removal controls now have a visually larger X, but their surrounding button dimensions and layout remain unchanged.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Mobile keyboard dismissal uses a blur-only scroll reset — 2026-08-09

- The `visualViewport` height tracker introduced in `493618a` was removed because repeated viewport corrections could make the mobile chat layout jump severely.
- The chat shell uses its original `100dvh` layout again.
- When the message textarea loses focus, one animation-frame callback resets the page scroll offset to zero so the browser can place the composer back at the bottom after dismissing the keyboard.

Trade-off: this intentionally handles only keyboard dismissals that produce a textarea `blur` event. It avoids viewport measurement, resize listeners, delayed timers and competing layout corrections.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Link panel cards open their destinations directly — 2026-08-09

- Selecting a card in the link panel now opens that URL in a new browser tab instead of navigating the chat to the message that contained it.
- New tabs use `noopener` and `noreferrer` so the destination cannot control the yap. tab through `window.opener`.
- Gallery and search-result navigation remain unchanged.

Trade-off: the link panel now prioritizes reaching the shared page. A user who wants the original conversation context must locate the message through chat history or search instead of using the link card.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Long-history panel navigation waits for a real layout quiet period — 2026-08-09

- Gallery, link and search jumps no longer treat three unchanged animation frames as a settled destination.
- Navigation now waits for 600ms with no relevant height change and no pending nearby media, allowing delayed images and third-party widgets above the target to finish their cascading layout work.
- The overall stabilization window increases from 12.5 to 20 seconds for slow networks and large historical windows.
- After the first correction, the destination can run one additional quiet-period check and final correction if newly visible lazy content changes the layout again.
- Corrections remain limited to two, ignore offsets of 6px or less, and stop immediately on wheel, touch or pointer input.

Trade-offs: on a slow connection the selected message may remain temporarily displaced for longer before receiving its final correction. Fast connections add roughly a 600ms quiet-period confirmation, while user interaction always takes priority and cancels pending automatic alignment.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Dashboard and preference sync now share the current-user read — 2026-08-07

- Resource Timing showed two `/api/user` GET requests starting at the same millisecond during authenticated dashboard entry: one loaded channels and platform role while `UserPreferencesSync` independently loaded font size and locale.
- Both consumers now use a client-side request broker keyed by authenticated user id. Concurrent consumers receive the same parsed `/api/user` result, whose existing payload already contains channels, role and preferences.
- The broker retains only an active promise and removes it after the request settles. It does not persist user data or reuse a settled response, so later reads still receive fresh server state.
- Consumer-specific cleanup no longer aborts the shared GET. Preference PATCH requests remain independently abortable when their component unmounts.
- Expected authenticated dashboard entry now produces one `/api/user` network request while preserving one `user-bootstrap` diagnostic request.

Trade-off: request sharing depends on consumers using the common broker; future direct `/api/user` GET call sites can bypass deduplication. Avoiding a settled-response cache also means sequential reads remain separate by design.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Dashboard startup no longer repeats role-dependent requests — 2026-08-07

- Browser diagnostics showed normal authenticated dashboard startup issuing `user-bootstrap`, `recent-channels` and `support-preview` twice instead of once.
- Resolving the platform role changed the support-preview callback identity, which restarted the startup effect after `/api/user` completed. Foreground polling also ran an immediate role-sensitive refresh alongside startup.
- Startup orchestration is now keyed only to authentication status and session user id. It uses the role returned by the initial user bootstrap directly and explicitly owns the initial recent-channel, support-preview, platform-dashboard and operational-health requests.
- Foreground polling no longer performs an immediate duplicate refresh; its interval and focus/visibility refresh behavior remain active after startup.
- Expected normal authenticated startup counts are now `user-bootstrap: 1`, `recent-channels: 1`, `support-preview: 1` and `admin-dashboard: 0`.

Trade-off: startup and recurring freshness now have clearer ownership, but any new initial dashboard resource must be added explicitly to the startup path instead of relying on polling's immediate invocation.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Newer history pages preserve the visible viewport anchor — 2026-08-07

- Scrolling down through a contextual history window previously anchored newer-page loads to the old newest mounted message for only one animation frame.
- Once the mounted history exceeded 300 messages, trimming older rows from the top could therefore move the reader upward while newer rows were appended below.
- Older and newer page loads now share the same locked viewport-anchor lifecycle: capture the first visible message and its exact offset, retain it through message merging and window trimming, then release it after layout above the anchor settles.
- A locked anchor can restore while the reader is near the bottom of a contextual window, while ordinary latest-message behavior still follows the bottom normally.
- Async mutations below the locked anchor remain ignored during stabilization, so newly appended previews or media do not compete with the position correction.

Trade-off: paging briefly prioritizes the current visible message over bottom-follow behavior while the history window settles. The lock is released after stabilization, and ordinary latest-room scrolling is unchanged.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Local chat and dashboard performance diagnostics now include request counts — 2026-08-07

- Dashboard startup tracing now records not only milestone timings but also per-request counts and durations for `/api/user`, recent-channels, support-preview and platform-dashboard reads across the current page session.
- Chat tracing now records bounded per-channel cycles for bootstrap, reconnect and long-hidden visibility resume, including request counts for `init`, `messages` and `/api/ws-token`, reconnect-attempt counts, socket-sync timing and overall settle time.
- The snapshots are exposed in the browser through `window.__letmetelluDashboardPerf` and `window.__letmetelluChatPerf[channelId]`, so the next optimization pass can use local devtools evidence instead of inferring request churn from code structure alone.

Trade-off: these diagnostics add a small amount of client-only bookkeeping and extra Performance API entries in exchange for better local observability. They are intentionally browser-local and do not send analytics or change runtime fetch behavior.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Batched reply-parent recovery avoids per-parent context churn — 2026-08-07

- Reply-parent recovery previously reused `message-context` once for every missing parent id and re-sorted the mounted message window after each individual parent insertion.
- Dense older threads could therefore fan out into multiple overlapping context requests and repeated whole-list client work even though the UI only needed the missing parent rows themselves.
- The Worker now exposes a narrow `reply-parents` data path that accepts a bounded list of parent ids and returns only the visible parent rows plus the ids that are confirmed unavailable in that channel.
- The chat reply-parent hook now resolves missing parents in batches, merges each batch into the mounted message list with one update pass, and marks unresolved ids unavailable without rerunning full message-context reconstruction for each parent.

Trade-off: reply-parent recovery still favors correctness over immediate fallback, so replies with off-window parents can remain briefly delayed while a batch lookup completes. The difference is that the delay no longer multiplies into one heavy request and one full list re-sort per parent.

Deployment note: deploy the Worker and frontend together. No D1 migration is required.

### WebSocket auth no longer depends on full channel init — 2026-08-07

- `/api/ws-token` previously called Worker `/api/init` on every socket open or reconnect just to determine whether the client should authenticate as owner admin, reports-owner viewer or passcode-room viewer.
- That reused the full bootstrap path even though socket authorization only needed channel ownership, reports-owner override and room-token validation, so reconnect churn paid for message/config reads that were unrelated to the auth decision.
- The Worker now exposes a narrow `socket-auth` route that validates exactly those socket auth modes and refreshes anonymous or device identity only when a room viewer actually needs it.
- The Next.js `/api/ws-token` route now uses that lightweight Worker endpoint instead of `init`, reducing reconnect request cost without changing the existing admin, reports-owner or room-viewer WebSocket token model.
- The owner-channel popup now also uses a same-origin `/api/user?channel=...` proxy instead of calling the Worker directly from the browser, so preview and production share one fetch path and avoid cross-origin/CORS-specific behavior for that read.

Trade-off: socket authorization now depends on a dedicated Worker route instead of piggybacking on `init`, so future auth-mode changes must keep both the page bootstrap and socket-auth contracts aligned. The narrower endpoint is intentional because reconnect paths should not pull full channel state.

Deployment note: deploy the Worker and frontend together, or deploy the Worker first. No D1 migration is required.

### Explicit message navigation now rehydrates thread context — 2026-08-07

- Navigating to a message by id now refreshes `message-context` even when the target message is already mounted in the current client window.
- This prevents partially loaded old-history slices from keeping a mounted root message while silently omitting sibling replies that do exist in the authoritative context payload.
- If the context refresh fails, navigation still falls back to the already-mounted target so direct jumps remain usable under transient network failures.

Trade-off: explicit message jumps can now issue an extra context request even when the target is already visible. The additional fetch is intentional because navigation now prioritizes thread completeness over avoiding that round trip.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Initial channel bootstrap now preserves the same visible root threads as history pages — 2026-08-07

- The Worker `init` path previously returned a raw latest-50 visible-message slice, while `/api/data?type=messages` already expanded whole visible root threads after selecting the page window.
- That mismatch meant some older replies, including specific admin replies, could be absent on first channel entry even though the same message appeared later through search, context fetches or paged history loads.
- Visible-message page selection and root-thread expansion are now shared through `worker/src/lib/visible-messages.ts`, and both `init` and `data` use that same helper.
- Initial channel entry therefore mounts the same thread-complete window shape that later history requests use, eliminating bootstrap-only missing replies caused by inconsistent server slicing.

Trade-off: `/api/init` can now return more than the base 50 rows when the newest visible window intersects several active root threads. Payload size grows somewhat, but bootstrap and later history views now agree on which replies belong in the mounted window.

Deployment note: this is Worker-only and requires a Worker deploy, but no D1 migration.

### History page loads now keep visible root threads intact — 2026-08-07

- Chronological `/api/data?type=messages` pages now expand the visible root threads touched by the page instead of returning only the raw 50-row time slice.
- Older history browsing therefore keeps earlier direct replies, including owner/admin replies, visible when later sibling replies from the same root thread were already inside the page window.
- The chat history loader now uses an explicit `has_more` flag from the Worker so thread-expanded pages do not break older/newer pagination heuristics.

Trade-off: history pages can now contain more than the base 50 rows when several loaded messages belong to the same active threads. This increases payload size somewhat in exchange for thread completeness while browsing history.

Deployment note: deploy the Worker and frontend together. No D1 migration is required.

### Old-thread context now includes the full visible root thread — 2026-08-07

- Jumping to an older message no longer relies only on a fixed chronological slice around the target when building the thread view.
- The Worker now resolves the target message's visible root ancestor and includes that root plus all visible descendants in the `message-context` response.
- Older conversations therefore keep direct owner/admin replies and other thread replies visible even when those replies sit outside the previous `before/after` time window.

Trade-off: opening an older message can now return a larger payload for dense threads because the endpoint prioritizes thread completeness over a strict fixed-size context slice.

Deployment note: background-save canonicalization is Worker-side and the re-entry no-flash alignment is frontend-side. No D1 migration is required.

### Single-depth thread rendering now keeps nested replies visible — 2026-08-07

- Chat thread derivation now collapses reply chains onto the nearest visible top-level ancestor instead of only grouping direct children.
- In the one-depth chat UI, replies to replies now render under the same root parent message rather than being assigned to an unrendered intermediate reply bucket.
- Older threaded conversations no longer selectively drop some owner/admin replies just because those replies targeted another reply instead of the root post.

Trade-off: the UI still presents a single reply depth. Nested reply relationships are flattened to the visible root thread for consistency rather than rendered as a multi-level tree.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Search highlighting now respects hidden link previews — 2026-08-07

- Search-hit rendering now highlights the already-processed message content instead of re-rendering from the raw message text.
- Messages with resolved link previews keep suppressing their original URL text during search navigation, so preview cards no longer re-expose the raw link string just because the message is a search match.
- Visible non-embedded links still participate in search highlighting, preserving the previous search affordance for messages that intentionally show their URL text.

Trade-off: search matching still runs against the original stored `message.text`, so hidden preview URLs remain searchable even though the rendered bubble may only show the preview card. This keeps search recall intact while aligning the displayed result with normal message rendering.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Background overlay and blur persistence with reused images — 2026-08-07

- Admin background updates now accept both absolute Worker/app media URLs and the normalized same-origin `/api/media/...` paths already stored in channel state and the local background snapshot.
- Reusing the same uploaded background image while changing only darkening or blur no longer fails Worker validation, so those settings persist correctly without forcing the owner to reupload the image.
- Background saves now canonicalize channel-image URLs back to a stable `/api/media/...` path before storing them, and replacement cleanup compares the extracted media key instead of the raw URL string.
- This prevents the same background asset from being mistaken for a new file just because it arrived as a Worker URL, an app URL or a signed URL variant. Without that normalization, a settings-only save could delete the current R2 object and leave fresh devices with a `404` background fetch.
- Channel bootstrap now normalizes authoritative `background_image` values to the same stable `/api/media/...` path that the loading-state cache already uses. Re-entering a channel no longer swaps from a cached path to a different signed Worker URL for the same image, which avoids the gray flash caused by a second cache miss and decode cycle.

Trade-off: background-image validation still stays scoped to the app's own media paths rather than allowing arbitrary external image URLs. The fix broadens accepted path forms for the same asset, not the product policy for channel backgrounds.

Deployment note: background-save canonicalization is Worker-side and the re-entry no-flash alignment is frontend-side. No D1 migration is required.

### Adaptive reply-arrow tone by background heuristic — 2026-08-07

- Reply arrows now use two contrast variants instead of one fixed stroke across every channel surface.
- Default app backgrounds and bright custom color backgrounds keep the existing muted `var(--meta)` arrow tone.
- Dark custom color backgrounds switch to a brighter arrow tone using a simple luminance check on the configured `background_color`.
- Image backgrounds now choose between the same two arrow tones from the owner-configured darkening overlay level instead of trying to inspect image pixels during render or scroll.

Trade-off: image-background adaptation is intentionally heuristic. A locally bright area inside an otherwise darkened image can still reduce arrow contrast, but the implementation stays deterministic and avoids expensive per-pixel analysis or scroll-time sampling.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Dashboard recent-channel query bounding and startup pruning — 2026-08-07

- `/api/recent-channels` now returns at most the newest 100 rows per user, ordered by pinned state and visit time, matching the bounded dashboard snapshot shape instead of sorting an unbounded per-user history forever.
- Recent-channel writes now prune overflow rows back to that same 100-row limit so long-lived accounts do not keep growing dashboard history indefinitely when the UI only benefits from a recent window.
- Migration `0035_recent_channels_dashboard_limit.sql` replaces the older visit-only user index with an ordering-aware recent-channel index and trims any already-oversized histories during rollout.
- Authenticated dashboard startup no longer starts the recent-channel fetch before `/api/user` determines whether the viewer is a platform admin, avoiding a wasted recent-channel query on the admin dashboard path.
- The recent-channel Worker route now skips the steady-state extra email-based user lookup when the authenticated user id already resolves to the same account.

Trade-off: authenticated users now keep only the top 100 recent-channel rows on the server, matching the existing browser cache limit. Very old joined-channel history falls out of the recent list instead of remaining queryable through the dashboard path indefinitely.

Deployment note: apply D1 migration `0035_recent_channels_dashboard_limit.sql`, then deploy the Worker and frontend together.

### Dashboard reorder hydration stability — 2026-08-07

- Returning to the dashboard now updates the authenticated recent-channel snapshot immediately when a channel is opened, so the cached list order usually already reflects the just-visited channel before the authoritative `/api/recent-channels` response arrives.
- The dashboard's FLIP-style row reordering is suppressed during the initial cached-to-authoritative hydration window for both authenticated and guest startup. This avoids animating server reconciliation that does not represent a direct user action.
- In-flight row animations are cancelled before any new measurement pass runs, preventing a second reorder from starting from a temporarily transformed position and producing the previous move-then-bounce effect.
- Explicit list-state changes such as pinning can still animate after the initial dashboard load has settled.

Trade-off: returning to the dashboard after visiting a channel no longer shows a reorder animation during hydration, even when the authoritative server ordering differs from the first cached render. This is intentional because the movement was not useful feedback and was the source of the visible bounce.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Dashboard startup cache, request shaping and skeleton — 2026-08-07

- The dashboard now starts its user bootstrap and recent-channel reads without serially waiting for unrelated support work. The support preview loads in the background for normal users.
- `/api/user` now returns `is_platform_admin`, removing the extra role-probe request from normal authenticated startup. Platform admins still wait for their administrative dashboard because that data defines their primary view.
- Authenticated recent-channel rows are mirrored in a user-keyed local snapshot capped at 100 entries and 24 hours. A valid snapshot can render immediately while the authoritative account request refreshes it.
- Startup timing is exposed through `performance` entries under `letmetellu:dashboard:*`, including request durations and milestones for session, cached channels, network channels, recent channels, admin data, support preview and usable state.
- The blocking dashboard loader is now a full geometry-matched skeleton for the header, search field and channel rows instead of a blank or minimally informative loading state.

Trade-offs:

- Cached rows can be briefly stale after a channel is renamed, deleted or changed on another device. The network response remains authoritative and replaces the snapshot.
- The local snapshot contains channel-list metadata for the authenticated account on that browser. It is namespaced by user ID and stores no passcodes or message content, but it persists until browser storage is cleared or the entry is overwritten.
- Performance entries are local browser diagnostics rather than centralized telemetry. They make bottlenecks inspectable without adding analytics traffic, but production aggregation still requires a separate monitoring decision.

Deployment note: deploy the Worker and frontend together for the `/api/user` response change. No D1 migration is required.

### Persistent channel backgrounds and cache-safe media delivery — 2026-08-06

- The browser stores versioned channel background metadata in `localStorage`, including type, color, stable image path, overlay, blur and channel instance ID. The loading state can restore that appearance before `/api/init` finishes.
- `/api/init` remains authoritative. Owner setting changes and realtime background updates refresh the local snapshot, while channel deletion, recreation, passcode gating and instance mismatches invalidate it.
- Background image URLs now normalize to stable same-origin `/api/media/...` paths so normal browser HTTP caching can reuse image bytes across channel entries without persisting binary data in synchronous storage.
- Public channel backgrounds use `public, max-age=604800, s-maxage=3600, immutable` and are also stored in Cloudflare's regional cache after the first authorized R2/D1 lookup.
- Passcode-protected and reports-channel backgrounds use private caching and bypass the shared edge cache. Message images, DMs, signed media and other protected uploads retain their private or no-store behavior.

Trade-offs:

- A returning visitor can see the last cached background briefly before current settings arrive. Instance checks and authoritative init reduce stale reuse but cannot make cross-device changes synchronous.
- Public background replacement must use a new media key because immutable browser caching intentionally favors reuse over in-place mutation.
- Cloudflare's Cache API is regional and eviction is provider-controlled. A miss still performs the normal authorization and storage lookup, and public cache population adds bounded edge storage.

Deployment note: deploy the Worker and frontend together. No D1 migration is required.

### Persistent link-preview metadata cache — 2026-08-06

- Successfully loaded generic and X/Twitter preview metadata is stored asynchronously in the browser Cache API under `letmetellu-link-previews-v2`; the earlier `localStorage` preview cache is removed on first use.
- The cache keeps at most 200 responses, treats entries as fresh for 24 hours and serves entries for up to seven days while stale data is refreshed in the background.
- In-memory request deduplication remains active within a page session. Failed and metadata-empty responses are not persisted, so a later channel entry can retry.
- Preview requests use the same-origin Next.js `/api/preview` route, which avoids preview-deployment CORS failures while the Worker continues to enforce URL policy, rate limits, response-size bounds and its own one-hour edge metadata cache.
- X/Twitter links use the lightweight metadata card rather than constructing the full third-party widget. Image-only metadata remains visible without forcing a cropped text-card layout.

Trade-offs:

- Cache API reads are asynchronous, so a restored card may still appear a frame or more after its message. Browser eviction is outside application control.
- Persisted preview metadata reveals which linked pages were rendered in that browser profile until eviction or cache clearing. The cache stores metadata and source URLs, not the rendered React tree.
- Stale-while-refresh behavior favors immediate cards over perfectly current titles and images. Upstream changes may take up to the refresh window to appear.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Reply-parent-first rendering — 2026-08-06

- Replies whose parent is outside the loaded message window are held back while the client fetches the parent's message context.
- Resolved parents are inserted chronologically before thread derivation, so replies no longer appear temporarily as top-level messages and then jump under a parent.
- Parent lookups are deduplicated per channel/live scope and bounded by a four-second timeout. A confirmed unavailable parent releases its replies as top-level fallback content rather than hiding them indefinitely.
- Deleted parent rows remain context-fetchable when they still have visible replies, preserving thread structure without making unrelated deleted messages visible.
- If the viewer is already following the newest messages, inserting a fetched parent keeps the viewport at the bottom; historical readers retain their current position.

Trade-off: a reply can appear a few seconds later than surrounding top-level messages when its parent requires another request. This favors stable thread structure over showing an incorrectly positioned reply immediately.

Deployment note: deploy the Worker and frontend together. No D1 migration is required.

### Chat bubble spacing and asynchronous layout stability — 2026-08-06

- Message-row top spacing increased from `0.18` to `0.32` times the selected bubble font size, improving separation without adding a fixed pixel gap that ignores accessibility sizing.
- When images, previews, widgets or reply parents change layout above a reader who is away from the bottom, the chat preserves the first visible message and its viewport offset.
- Readers already following the newest messages continue following the bottom as content resolves. Manual wheel, touch and pointer input cancels pending programmatic corrections.
- Widget and reply bubbles retain responsive row limits so reply indentation and arrows do not create right-side clipping on narrow screens.

Trade-off: asynchronous content can still change bubble dimensions when it finishes, but the viewport anchor prevents that growth from moving the reader to unrelated messages.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Refresh-only chat scroll restoration — 2026-08-06

- A channel preserves its visible message position only for an actual browser refresh of that same channel.
- Client-side navigation away from the channel removes its saved position, so returning from the dashboard or another channel starts at the latest message.
- Non-reload page entries consume and discard any stale tab-local position before the normal initial bottom scroll runs.
- Browser unload/pagehide continues to capture the final anchor for refresh, while pageshow resets the lifecycle guard for restored back-forward-cache pages.

Trade-off: leaving and re-entering a channel intentionally loses historical browsing position even within the same tab. Refresh remains tab-local and does not sync across devices.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Legacy link cards and gallery media alignment — 2026-08-06

- Link-panel cards now retain a uniform 104px layout for current and migrated messages while preview requests load or fail, preventing recent cards from collapsing into border-only lines.
- Extracted legacy URLs decode `&amp;` and trim common trailing punctuation before preview requests; failed previews still show the hostname and URL fallback.
- Gallery-to-chat navigation now centers the selected media wrapper rather than the full message row, so long captions no longer leave the image just above the visible area.

Trade-offs: link cards reserve their full preview height even when a site provides no preview image. Gallery navigation may position the surrounding caption asymmetrically because visibility of the selected media takes priority.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Default bubble color — 2026-08-06

- The default sent-bubble color is now `#3598fe` across initial CSS, UI fallbacks, channel previews, Open Graph images and both admin/viewer color presets.
- New channel creation explicitly stores `#3598fe` in D1 instead of depending on the legacy production column default.
- The initial schema default is updated for fresh installations.
- Migration `0034_normalize_bubble_color.sql` rewrites the superseded `#3b8df0` value to `#3598fe` in both `channels` and `user_recent_channels`.
- Runtime normalization also maps missing values and legacy `#3b8df0` responses to `#3598fe`. Any other channel or per-user custom color remains unchanged.

Trade-off: users who deliberately selected the exact old default `#3b8df0` are migrated with indistinguishable untouched defaults. Preserving every other color avoids broad appearance overrides.

Deployment note: apply D1 migration `0034_normalize_bubble_color.sql`, then deploy the Worker and frontend.

### Adaptive widget preloading — 2026-08-06

- YouTube and Instagram activation expands to 1,000px around the viewport on normal connections, stays at 600px on 3G and drops to 300px for 2G or data-saver users.
- When mounted chat history contains an Instagram link, its shared third-party SDK begins downloading during browser idle time without eagerly processing every off-screen post.
- Generic and X/Twitter metadata-card requests begin within a fixed 720px preview margin and share per-URL request deduplication.
- X/Twitter no longer loads the native widget SDK or constructs tweet iframes; it uses the same lightweight metadata-card path as other previews.

Trade-offs: normal fast connections perform nearby preview work and Instagram SDK download earlier, increasing background network use slightly. Data-saver and slow-network users retain conservative native-widget limits, while metadata-card timing remains fixed.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Uniform media loading bubble — 2026-08-06

- Image, link-preview and third-party widget loading states now use one compact three-dot bubble regardless of the eventual content width.
- Loading bubbles opt out of the wide reply-widget flex rule, and lazy embed wrappers remain `fit-content` until their real content is ready.
- Message text continues to stay hidden during media loading, so the bubble changes size only once when the finished content replaces the loading indicator.

Trade-off: the final media or widget can be substantially wider than its loading bubble, so completion intentionally produces one size transition rather than reserving the final layout in advance.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Stable panel-to-message navigation with lazy widgets — 2026-08-06

- Gallery, link and search navigation now places the target message in the viewport before waiting for its lazy widget layout, allowing IntersectionObserver-based embeds to activate immediately.
- Nearby images and widgets settle without frame-by-frame forced scrolling; the target receives one final correction after the layout stabilizes.
- Wheel, touch or pointer interaction cancels the pending correction immediately so automatic positioning never fights a user's manual scroll.
- Pending media outside the widget preload area is excluded from stability checks, avoiding the previous full timeout caused by intentionally dormant off-screen embeds.
- Refresh scroll restoration uses the same nearby-content boundary while preserving its saved viewport offset.

Trade-off: programmatic message jumps use immediate positioning rather than a smooth scroll. On a very slow network the message may drift while the widget grows and then receive one final snap to center, but it no longer vibrates from competing per-frame corrections.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Refresh scroll restoration — 2026-08-06

- Chat refreshes now preserve the first visible message and its exact viewport offset per channel and browser tab.
- Restoration waits for fonts, images, videos and widget placeholders above the anchor to settle before applying the saved offset.
- If the anchor is older than the initially loaded message window, the client fetches that message's context and restores the historical window instead of falling back to the latest message.
- Ordinary channel entry and navigation still start at the latest message; saved positions are consumed only after an actual browser refresh and expire after 30 minutes.

Trade-offs: refreshing while far back in history may add one message-context request and can hold the loading state briefly while media layout stabilizes. Scroll state is tab-local and intentionally does not sync across devices.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Default font size — 2026-08-06

- Users without a saved font-size preference now start at 15px instead of 17px.
- The CSS first-render value, local/account preference fallback and settings-panel fallback use the same 15px default.
- Existing font-size choices saved in the browser or user account remain unchanged.

Trade-off: new and previously unset profiles show slightly denser dashboard and chat typography; users can still adjust the size from 12px to 20px in general settings.

Deployment note: this is frontend-only and requires no D1 migration or Worker deployment.

### Reply widget width containment — 2026-08-06

- Wide reply bubbles now stay within the same 85% row limit as ordinary text replies.
- The reply arrow is fixed-width and the widget bubble consumes only the remaining flex space.
- Native 320px widgets continue to use the existing responsive scale calculation, so narrow screens resize the content instead of clipping it.

Trade-off: reply widgets can render smaller than equivalent top-level widgets because the reply indentation and arrow intentionally reserve part of the available row width.

### Lazy third-party widget rendering — 2026-08-06

- YouTube and Instagram embeds mount only when they enter the connection-aware preload margin around the viewport, avoiding immediate iframe and SDK work for off-screen history.
- Instagram uses one shared SDK loader and batches same-tick global `Embeds.process()` calls instead of processing the page once per message.
- YouTube iframes now use native lazy loading.
- X/Twitter uses a first-party metadata card and therefore has no native widget queue, render timeout or third-party iframe lifecycle.
- Generic link-preview requests also begin near the viewport while retaining the existing per-URL request and result cache.

Trade-offs:

- Fast scrolling across a large distance can briefly expose the standard loading bubble while the newly-near widget renders.
- X cards are lighter and more persistent than native widgets but do not reproduce every interactive tweet control.
- Widget completion time still depends on Instagram and YouTube availability; this change removes unnecessary eager work rather than eliminating third-party latency.

### Delayed reconnect notice — 2026-08-06

- Unexpected WebSocket closure still starts recovery immediately, but the visible reconnect notice now waits for three continuous seconds of disconnection.
- Successful room synchronization cancels a pending notice and hides an already-visible notice immediately.
- Initial connection setup, intentional background-tab socket sleep and disconnects recovered within the delay remain invisible to the user.
- Reconnect timers are cancelled during channel changes and component cleanup to prevent a stale notice from appearing in another channel.

Trade-off: users no longer see sub-three-second realtime interruptions, while sustained interruptions remain visible. Message HTTP sending and realtime recovery behavior are unchanged.

### Idempotent chat and DM sending — 2026-08-05

This frontend, Worker and D1 change prevents repeated Send clicks during a slow or reconnecting network from creating duplicate messages.

- The composer takes a synchronous in-flight lock before the first await, closing the React re-render window in which several clicks could start parallel requests.
- The send control is unavailable while that submission is in flight.
- Every text message, DM and photo in a multi-photo submission receives a client-generated message ID.
- Migration `0033_message_send_idempotency.sql` adds nullable client message IDs and unique partial indexes to `messages` and `dm`.
- The Worker returns the existing record for a repeated ID belonging to the same sender and channel, and rejects cross-sender/channel ID conflicts.
- Legacy frontend requests without an ID remain accepted during rollout; the Worker assigns a server-generated ID to those requests.

Trade-offs:

- A user cannot intentionally send a second message until the current submission resolves. On a very slow connection, this favors duplicate prevention over rapid-fire sending.
- Each message and DM gains one short ID plus a unique-index entry, adding small D1 storage and write-index overhead.
- The UI lock prevents ordinary repeat clicks; the database constraint is the final guard for concurrent duplicate requests that reach the Worker.

Deployment notes:

- apply D1 migration `0033_message_send_idempotency.sql` before deploying the updated Worker;
- deploy the Worker, then the Next.js frontend;
- production migration `0033` and Worker version `00b17abb-9226-46a9-8361-d765a98f861c` were deployed successfully on 2026-08-05.

### Tenth-visit improvement survey — 2026-08-05

This frontend, Worker and D1 feature asks for improvement feedback once after a user reaches ten qualified dashboard or channel visits.

- One eligible visit is counted per browser session across `/dashboard` and `/ch/*`; visits one through nine remain local-only and create no survey request.
- At the threshold, the frontend checks durable response state before showing the dialog. Existing responses suppress the prompt across devices for authenticated users and within the signed browser identity for guests.
- Choosing no, closing the dialog or successfully submitting feedback permanently suppresses the prompt locally. Each terminal outcome is also stored so the server does not ask the same actor again.
- Feedback descriptions are required, trimmed and limited to 1,500 characters. Responses are stored in `visit_survey_responses`, separate from support tickets and support messages.
- Actor identifiers are HMAC-pseudonymized before storage, POST requests require an authenticated user or signed guest identity, and response writes are rate-limited and unique per actor.
- Korean and English survey copy and privacy-policy disclosures are included.

Trade-offs:

- Browser visit counting is intentionally local and session-based, so clearing browser storage resets the counter. The durable status check still suppresses a repeat prompt when the signed identity remains available.
- Dismissal is terminal as requested; there is no reminder cadence or second opportunity after an accidental close.
- Responses are stored for direct D1 review in this slice; no platform-admin survey inbox is added.

Deployment notes:

- apply D1 migration `0032_visit_survey_responses.sql`;
- deploy the Worker before the Next.js frontend so the threshold status check is available;
- deploy the Next.js frontend.

### Platform support dashboard query shaping — 2026-08-05

This Phase 4 Worker and D1 optimization keeps the support dashboard response contract unchanged while aligning reads with measured SQLite behavior.

- User and platform-admin read markers are joined directly instead of fetched through separate correlated subqueries for every ticket.
- Migration `0031_support_dashboard_query_indexes.sql` adds composite indexes matching status pagination, latest-message ordering and sender-role timestamp lookups, then removes the narrower indexes they supersede.
- Message fields retain targeted indexed lookups. A page-first CTE with one windowed message rollup produced equivalent rows but ran about 7.3 times slower on a representative local fixture of 1,000 tickets and 20,000 messages, so it was rejected rather than shipping the planned-but-slower shape.
- On the same fixture, direct read-marker joins plus the accepted indexes preserved exact query rows and reduced repeated 101-ticket list-query time by about 54-56% across two 250-read benchmark runs.
- The direct read-marker joins also benefit single-thread and user-facing support queries that share the same select contract.

Trade-offs:

- The two message indexes add storage and minor write amplification, but support-message writes are low-volume and reads are the dashboard hotspot being optimized.
- Targeted message lookups remain correlated, but the new indexes make each lookup bounded and avoid the sorting/grouping cost observed in the rollup benchmark.
- A derived support-thread summary could remove those lookups, but would introduce write-path consistency risk and is not justified without production evidence.
- The migration adds no columns or backfill, but it must be applied before production latency is evaluated against the new query shape.

Deployment notes:

- apply D1 migration `0031_support_dashboard_query_indexes.sql`;
- deploy the Worker;
- no Next.js frontend deployment is required.

### Initial socket and reconnect request shaping — 2026-08-05

This frontend-only Phase 3 slice removes duplicate chat recovery reads without weakening passcode, moderation or live-state transitions.

- The realtime hook now distinguishes the first successful socket authorization from a true reconnect. Initial authorization emits `connected`, while only later recovery emits `reconnected`.
- Initial page bootstrap remains the single owner of the first full channel read. Socket authorization no longer immediately repeats message and init requests after that bootstrap.
- A true reconnect now performs one recovery request: owners refresh full init state, normal viewers merge messages and current viewer-facing state from one init response, and the legacy manual-admin path performs a message-only refresh.
- Contextual history remains stable for normal viewers because reconnect recovery merges messages only while the user is in the latest-message view.
- Passcode access changes, explicit live-mode entry/exit and live termination retain their full-init behavior because those transitions still require broader authorization and channel-state reconciliation.
- Audited the owner-channel-count effect and popup loading path. The count is already limited to channel identity/profile-visibility changes, and the full list is fetched only when the popup opens.

Expected request-shape change:

- supplemental requests after initial socket authorization: from up to two to zero;
- recovery requests after an ordinary reconnect: from two to one;
- production request counts and reconnect settle time still need measurement before Phase 3 is considered complete.

Deployment notes:

- no D1 migration or Worker deployment is required;
- deploy the Next.js frontend.

### Locale semantics and empty support refresh follow-up — 2026-08-05

- Root request locale now sets the document-level `lang`, keeping server-rendered English legal content and accessibility metadata aligned.
- Dashboard support-preview polling now remains active when no ticket is currently visible, allowing tickets opened from another tab or device to appear within the existing 60-second freshness window.
- The production frontend build and Worker hardening tests passed after both corrections.

Deployment notes:

- no D1 migration or Worker deployment is required;
- deploy the Next.js frontend.

### API domain split and lazy mock loading — 2026-08-05

This completes the remaining Phase 1 bundle-reduction work by removing the old all-in-one client API surface from hot interactive routes.

- Split the old `src/lib/api.ts` monolith into focused modules: `src/lib/api-core.ts` for shared client helpers, `src/lib/api-chat.ts` for chat/admin/upload/realtime APIs, and `src/lib/api-support.ts` plus `src/lib/api-support-types.ts` for support and dashboard APIs.
- Moved support mock state into `src/lib/api-support-mock.ts` and changed both chat and support mock paths to dynamic `import(...)` calls. Mock-only helpers are no longer part of the default route graph for production bundles.
- Repointed chat, dashboard, support and admin consumers to the split modules directly, while shrinking `src/lib/api.ts` to a small compatibility barrel instead of a 1.5k-line mixed-domain client module.
- Verification in writable webpack builds against the previous `c2f272b` commit showed the interactive route bundles drop from about `654 KB` to `638 KB` for `/support`, `734 KB` to `718 KB` for `/dashboard`, and `862 KB` to `848 KB` for `/ch/[slug]` of first-load uncompressed JS. `/` stayed about `526 KB`, while the already-optimized server-rendered legal pages stayed about `535 KB`.

Trade-offs:

- This reduces mixed-domain client code in the chat, dashboard and support graphs, but it does not yet simplify the dashboard refresh policy or the chat reconnect/init request pattern. The remaining performance work stays in those later phases.
- `src/lib/api.ts` still exists as a compatibility barrel for low-risk migration, so import hygiene matters if future work wants to preserve the same bundle boundary.

Deployment notes:

- no D1 migration is required;
- no Worker deploy is required for this optimization;
- deploy the Next.js frontend for this line.

### Root provider scoping and server-rendered legal pages — 2026-08-05

This frontend-only optimization removes avoidable global client bootstrapping from routes that do not need authenticated or locale-managed interactivity.

- The root app layout no longer mounts the full `Providers` client shell for every route. Interactive routes that actually need `SessionProvider`, locale state and user-preference synchronization now mount that shell at the page boundary instead.
- `/privacy` and `/terms` no longer wait for a client-only locale hydration gate. They now render on the server from request locale, using a locale cookie first and `Accept-Language` as the fallback.
- Locale changes now persist a lightweight `locale` cookie alongside existing browser storage so server-rendered pages can respect the user's last selected language without pulling the full locale client runtime into static legal pages.
- Verification in a writable webpack build confirmed that `/privacy` and `/terms` now ship only tiny route-specific client chunks for the page wrapper and shared `Link` runtime, while dashboard/chat routes retain their heavier interactive client graph.

Trade-offs:

- Interactive routes still pay for the existing provider shell because they genuinely depend on session, locale and user-preference synchronization. This pass narrows scope; it does not yet reduce the interactive dashboard or chat bundle itself.
- The legal pages now read locale from request context rather than waiting for post-hydration browser state. A user's first visit on a new device can therefore follow browser language until they explicitly change locale.
- This is only the first phase of the planned bundle-reduction work. `src/lib/api.ts` still mixes multiple domains and mock helpers, so dashboard and chat routes continue to carry more client code than necessary.

Deployment notes:

- no D1 migration is required;
- no Worker deploy is required for this optimization;
- deploy the Next.js frontend for this line.

### Supabase `main` history import into `zziks` — 2026-08-04

- Exported the legacy `main` channel from the original Supabase-backed application with its service-role credential kept outside the repository.
- Imported 685 normal messages into the existing D1 `zziks` channel while preserving timestamps, 204 reply relationships, reactions and four edited states.
- Pseudonymized legacy `uid` and `auth_uid` values with deterministic SHA-256-derived migration identifiers. They are retained only to preserve visual message grouping and are not connected to current yap. identities or edit/delete authority.
- Copied 25 referenced images from Supabase Storage into the `letmetellu-media` R2 bucket under the isolated `zziks/legacy-main/` prefix. Added matching attached upload tickets and 25 gallery rows so protected media lookup and channel deletion remain consistent.
- Added 44 existing link messages to `message_links`. Existing `zziks` ownership, profile, passcode, notice, colors and other channel settings were not changed.
- Excluded the three legacy DMs and seven legacy config rows. The source had no report-message rows, deleted-message rows or blocked-user rows in `main`.
- Validated the generated import against a fresh local D1 containing all 28 migrations before production execution. The local and production checks both returned 685 messages, 204 replies, four edited messages, 25 image messages, 25 gallery rows, 25 unique attached media tickets, zero broken replies and zero broken gallery references.
- Recorded the pre-import D1 Time Travel bookmark as `00000428-00000002-000050bd-d66ae8b227b23b5034bba30a25893377`. The successful import completed at bookmark `0000042b-0000007f-000050bd-4480ca41fb5dbec420debb701969e06a`.
- Added `scripts/prepare-legacy-main-migration.mjs` as a credential-free, auditable preparation tool. It fetches paginated Supabase rows, validates reply/gallery references, downloads and hashes media, pseudonymizes legacy actors, and produces D1 SQL plus a media manifest in a caller-selected output directory.
- Corrected the gallery panel lookup to join through `messages.gallery_id` instead of assuming gallery and message primary keys are identical. This keeps ordinary uploads working and makes imported gallery identifiers visible without rewriting production history.
- Gallery API responses now expose the associated message ID as the item `id`, rather than the gallery-row ID, so opening an imported photo and navigating back to its historical message works even when the two IDs differ.
- Changed link-preview caching so transient fetch failures are not cached for the entire browser session; reopening the panel can retry while successful previews remain cached.
- Changed oversized preview handling to read and parse only the first 512 KB of HTML instead of rejecting a page solely because its full `Content-Length` is larger. This preserves the response-size and memory bound while allowing metadata from large article pages such as Posty to render.
- Versioned the Worker preview cache after the parser change and stopped caching responses with neither a title nor an image, so previously cached empty results cannot keep migrated links in the URL-only fallback state.
- Added standard document-title and description fallbacks plus relative image/video URL resolution for older pages that do not expose complete Open Graph metadata.

Trade-offs:

- Imported authors cannot claim, edit or delete their historical messages because the old anonymous identity system is intentionally not linked to current signed identities. The current `zziks` owner retains moderation authority.
- One legacy GIF is about 15.4 MB, above yap.'s current 10 MB upload limit. It was preserved under a migration-only 50 MB ceiling; the normal upload limit remains unchanged.
- Connected chat clients do not receive a realtime event for direct administrative imports. Reloading or reopening `zziks` fetches the imported history normally.
- Supabase remains the unchanged source backup until the imported channel has been visually reviewed. Removing that source later should be handled as a separate destructive operation.

### Jittered WebSocket reconnect backoff — 2026-08-04

- Replaced the fixed two-second chat WebSocket reconnect loop with exponential delays starting near two seconds and capped near thirty seconds.
- Added 25% per-client jitter so browsers disconnected by the same outage do not all request a new socket and `/api/ws-token` at the same instant.
- Reset the retry counter only after room synchronization succeeds. Returning from the intentional hidden-tab sleep also starts a fresh retry sequence.
- Existing hidden-tab suspension, single-pending-timer protection and room authorization behavior remain unchanged.

Trade-offs:

- A prolonged outage no longer produces a synchronized reconnect wave, reducing pressure on Vercel, the Worker and channel Durable Objects during recovery.
- Reconnection after repeated failures can take up to roughly 22.5–37.5 seconds because of the cap and jitter, so a recovered chat may remain disconnected slightly longer than with the previous fixed two-second retry.
- The delay returns to the initial range as soon as a connection completes room synchronization; normal navigation and wake-from-background behavior are not intentionally slowed.

### CSP limited-beta posture documentation — 2026-08-04

- Documented that production CSP currently retains `script-src 'unsafe-inline'` while still restricting other resource classes and supported external origins.
- Classified this as a defense-in-depth limitation rather than a confirmed active XSS vulnerability; normal React escaping, input validation and constrained embed paths remain the primary protections.
- Recorded the safe hardening sequence: request-scoped nonce support for the theme bootstrap, structured dialog content instead of a generic arbitrary-HTML contract, exact widget origin review, then focused preview/report-only and production-header validation.

Trade-offs:

- Keeping `'unsafe-inline'` avoids breaking pre-hydration theme behavior, Auth.js/Next.js startup assumptions, dialogs and external widgets during limited beta, but reduces CSP's ability to contain a future script-injection defect.
- Removing it as a header-only edit can produce a light-theme flash or block required scripts and widgets. The application contracts must change before enforcement.
- Limited beta can proceed with direct monitoring and constrained users; broad public launch should include the nonce migration or an explicit security review of the remaining exception.

### WebSocket origin enforcement — 2026-08-04

- Added exact-match `Origin` validation at the Worker boundary before browser WebSocket upgrades can reach a chat-room Durable Object.
- Reused the same configured-origin policy for CORS and WebSocket checks so the two browser trust boundaries cannot drift independently.
- Added focused tests for configured origins, spoofed subdomains, missing origins, development wildcard behavior and enforcement before Durable Object access.

Trade-offs:

- Supported browser users on configured origins see no UI change.
- Preview deployments, scripts, native clients and tools with an unconfigured or missing `Origin` now receive `403` before opening a realtime connection.
- New production hostnames must be added deliberately to `ALLOWED_ORIGIN`; transition origins should be removed after canonical-domain smoke testing.

Deployment notes:

- no D1 migration or frontend deployment is required;
- deploy the Worker for the WebSocket boundary change.

### Pre-beta domain, email and legacy-data audit — 2026-08-04

- Verified the canonical `yapndot.com` deployment, HTTPS route, Auth.js provider metadata and Worker CORS response.
- Confirmed Auth.js emits separate Google callback paths for `google-login` and `google-signup`; Google Cloud must register both exact paths.
- Confirmed production Resend delivery is no longer sandbox-recipient limited and uses the verified `send.yapndot.com` sender.
- Audited legacy production data and identified seven credential test accounts, four channels owned by those accounts and six additional orphan channels. The exact target set was subsequently deleted while Google accounts, the platform `reports` channel and the new verified credential account were preserved.

Operational notes:

- Cleanup was completed through a temporary exact-ID route in a Wrangler remote-binding session after broad production-secret export was rejected. Seven legacy credential test accounts, four owned channels and six orphan channels were removed through the existing account/channel deletion logic; the temporary route was then removed.
- Post-cleanup D1 verification reported zero remaining target users and channels, while `reports`, `whaaa` and the new verified credential account each remained present.
- DNS changes briefly produced cached negative responses during apex CNAME flattening; authoritative Cloudflare and `1.1.1.1` responses later validated correctly, while local/Google caches required TTL expiry.
- At initial audit time `www.yapndot.com` still served the app directly; Vercel was subsequently configured and verified to return a permanent redirect to the canonical apex hostname.

### Production Resend sender and recipient rollout — 2026-08-04

- Replaced the Resend sandbox sender with `yap. <noreply@send.yapndot.com>` and updated verification and password-reset branding to `yap.`.
- Removed the `EMAIL_TEST_RECIPIENT` gates from signup and password-reset delivery, allowing valid recipients after the sending domain was verified.
- Preserved neutral password-reset responses for unknown accounts so the change does not expose whether an email is registered.

Trade-offs:

- Signup and reset requests now create real outbound email traffic for every eligible request, making the existing per-email and per-IP rate limits operationally important.
- A Resend domain or DNS regression now affects all credential users rather than only the test account; delivery failures return the existing bounded error and must be monitored.
- The sender address is intentionally tied to the verified `send.yapndot.com` subdomain. Changing that Resend domain requires a coordinated code and DNS update.

Deployment notes:

- requires the verified Resend sending domain and existing `RESEND_API_KEY` Worker secret;
- no D1 migration is required;
- deploy the Worker, then smoke-test one new signup and one password-reset delivery to a non-owner address.

### Canonical production domain preparation — 2026-08-04

- Changed the application fallback and documented production origin from the Vercel hostname to `https://yapndot.com`.
- Restricted dashboard channel-address parsing to the canonical domain, its `www` alias, the existing Vercel transition hostname and localhost development instead of accepting an arbitrary full-link hostname.
- Added the apex domain and `www` alias to the Worker CORS allowlist while retaining the Vercel hostname for a safe deployment transition.

Trade-offs:

- The legacy Vercel origin remains temporarily authorized, so it should be removed from Worker CORS only after DNS, OAuth, email verification and password-reset smoke tests pass on the custom domain.
- Links copied from unrelated hostnames are no longer interpreted as yap. channel addresses; users can still enter `/ch/name`, `yapndot.com/ch/name` or the complete canonical URL.
- Using one canonical apex origin avoids split cookies and OAuth state, but `www.yapndot.com` must redirect to it at the hosting layer.

Deployment notes:

- set Vercel `AUTH_URL`, `APP_ORIGIN` and `NEXT_PUBLIC_APP_ORIGIN` to `https://yapndot.com`;
- set the Worker `APP_ORIGIN` secret to `https://yapndot.com`, then deploy the Worker;
- configure Google OAuth origins and callback URLs for the new domain before login smoke testing.

### Next.js 16.3 security update — 2026-08-04

- Updated `next` and `eslint-config-next` from `16.2.11` to `16.3.0` before beta release.
- The resolved dependency tree now uses `postcss 8.5.23` and `sharp 0.35.3`, removing the production advisories previously reported through the Next.js dependency chain.
- Applied the compatible non-force audit fix for the remaining development-only `brace-expansion` advisory.
- Both `npm audit --omit=dev` and the full `npm audit` now report zero known vulnerabilities.

Trade-offs:

- The framework patch/minor update changes the build dependency graph and should receive focused smoke testing for image rendering, authentication callbacks, dashboard routes and server API handlers.
- No application API, schema or user-facing behavior was intentionally changed by this dependency-only update.
- Future advisories can change the audit result even without a code change, so the audit should be repeated before broader releases rather than treated as a permanent guarantee.

Deployment notes:

- no D1 migration or Worker deployment is required;
- deploy the Next.js frontend after the production build passes.

### Super-admin operational health card — 2026-08-04

- Added a localized service-health card to the super-admin dashboard with healthy, degraded and critical states, recent 15-minute `5xx`, exception, `429` and `403` counts, and up to three 24-hour problem routes.
- Health reads run on dashboard entry, every five minutes while visible, and on focus or visibility return only when at least one minute has passed.
- Concurrent health refreshes share one in-flight request, while the operator can request an immediate manual refresh.
- A health-read failure stays isolated from reports and support tickets; the existing platform dashboard remains usable and the card offers a retry.

Trade-offs:

- An open super-admin dashboard now performs one additional bounded health request every five minutes. Focus events inside one minute are coalesced to avoid request bursts.
- The card reports backend events that reached `operational_events`; purely visual frontend defects and successful-but-incorrect data responses still require regression tests or separate client telemetry.
- The initial threshold labels can look sensitive during low-volume testing and should be calibrated from production baselines before enabling external alerts.

Deployment notes:

- no D1 migration or Worker change is required for this UI step;
- deploy the Next.js frontend for the dashboard card.

### Super-admin operational health aggregation — 2026-08-04

- Added a super-admin-only `GET /api/platform-admin/support?type=health` read that summarizes operational events over the last 15 minutes and 24 hours.
- The response separates failed `5xx` requests, unhandled exceptions, scheduled-maintenance failures, rate limits and forbidden requests so internally duplicated exception records are not presented as duplicate failed requests.
- Added a bounded top-12 route breakdown without raw error details, actor identifiers or unrestricted event history.
- The current health state is derived from explicit 15-minute thresholds and returns the thresholds alongside the counts for operator transparency.
- Added tests for D1 count normalization and healthy, degraded and critical threshold transitions.

Trade-offs:

- Each health read performs three indexed, 24-hour-bounded D1 aggregations. The endpoint is restricted to the existing platform-admin identity and should be polled conservatively by the future UI.
- `403` and `429` counts can reflect legitimate rejection or abuse rather than an outage. They are context signals; only a high rate-limit count degrades status, while forbidden counts do not change status by themselves.
- Thresholds are conservative initial defaults and may need adjustment after observing normal production baselines.

Deployment notes:

- no D1 migration is required because existing operational-event indexes cover the time-bounded reads;
- deploy the Worker for this endpoint;
- no Next.js frontend deployment is required until the operator health UI is added.

### Uploaded-image signature validation — 2026-08-04

- The Worker now compares the first bytes of JPEG, PNG, GIF and WebP uploads with the declared `Content-Type` before writing the object to R2.
- Empty, truncated, unsupported or header-mismatched bodies return `400 invalid file type` and do not consume R2 storage.
- GIF87a and GIF89a signatures are both accepted; the file body is not transformed, so animated GIF behavior is unchanged.
- Added focused tests for every supported signature plus mismatched and truncated inputs.

Trade-offs:

- This is a lightweight file-signature check, not a complete image decoder or malware scanner. A file with a valid header but malformed later bytes can still pass.
- Rare nonstandard files that browsers label as one format while their bytes use another are now rejected instead of being stored as broken media.
- Signature collection is capped at 12 bytes and reuses the existing upload stream, so it does not add another full-file read or meaningful memory overhead.

Deployment notes:

- no D1 migration is required;
- deploy the Worker for this validation change;
- no Next.js frontend deployment is required.

### Pre-body upload authorization and quota checks — 2026-08-04

- Message and DM uploads now complete channel passcode authorization, signed actor validation and the existing upload quota checks before the Worker consumes the request body.
- Rejected callers therefore no longer make the Worker buffer as much as the 10 MB upload limit before returning `401`, `403` or `429`.
- Added a Worker regression test that fails if an unauthenticated upload reaches the body reader.
- The existing file-size, upload-count and pending-ticket limits are unchanged; this update only moves rejection earlier in the request lifecycle.

Trade-offs:

- Authorized uploads now perform their access and quota D1 reads before streaming the body instead of after it. The same reads already existed, so successful uploads do not add queries, but body transfer begins slightly later.
- A request that passes the early check can still disconnect or submit an invalid body without creating an upload ticket. A separate low-cost attempt limiter can be considered later if production metrics show repeated failed-body abuse.

Deployment notes:

- no D1 migration is required;
- deploy the Worker for this hardening change;
- no Next.js frontend deployment is required.

### Chat layer-stack extraction from `ChatView` — 2026-08-04

- Extracted the remaining context-menu plus overlay render assembly into `src/components/chat/ChatViewLayerStack.tsx`, and exported the relevant hook result/types so that grouped chat UI state can be passed through without rebuilding the full overlay tree inline.
- `ChatView` now delegates the bottom-of-file layer stack to one wrapper instead of interleaving `ContextMenu` and the large `ChatViewOverlays` prop surface directly inside the main container render.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat state-screen extraction from `ChatView` — 2026-08-04

- Extracted non-main-view chat surfaces into `src/components/chat/ChatViewStateScreens.tsx`, covering the passcode gate wrapper, deleted-channel confirmation state, loading skeleton state, and expanded-post reader overlay.
- `ChatView` now keeps the passcode-unlock recovery callback and route decisions while delegating those conditional screens and overlay surfaces to one focused presentation module instead of rendering them inline beside the main chat layout.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat bottom-shell extraction from `ChatView` — 2026-08-04

- Extracted the post-message shell into `src/components/chat/ChatViewBottomShell.tsx`, covering the scroll-to-latest CTA, toast banner, reply bar, pending-photo tray, moderation banners, and composer footer with live emoji broadcast entry.
- `ChatView` now delegates the lower render block to one focused component instead of mixing message-area exit UI, composer presentation, and moderation/status chrome inline with the remaining page orchestration.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat realtime-sync extraction from `ChatView` — 2026-08-04

- Extracted websocket event application and the background-tab safety refetch into `src/components/chat/useChatRealtimeSync.ts`, covering message/dm updates, reconnect sync, room-access auth events, profile/freeze/live updates, reaction batching, channel deletion handling, and the visibility-triggered latest-message refresh.
- `ChatView` now delegates the realtime synchronization policy to one focused hook instead of carrying the large event switch and related tab-visibility effect inline beside render composition and composer state.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat channel-bootstrap extraction from `ChatView` — 2026-08-04

- Extracted channel bootstrap and recovery logic into `src/components/chat/useChatChannelBootstrap.ts`, covering `applyInitData`, normal/live reload helpers, owner moderation refresh, the initial channel load effect, passcode-gate recovery, and room-access banner clearing.
- Moved the shared `Channel`, `InitData`, and passcode-gate state types into `src/components/chat/chatViewTypes.ts` so `ChatView` no longer owns the bootstrap data contracts inline.
- `ChatView` now delegates this data-entry lifecycle slice to one focused hook instead of mixing channel initialization and passcode recovery with realtime handling, render composition, and composer state.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat message-pane extraction from `ChatView` — 2026-08-04

- Extracted the message viewport shell into `src/components/chat/ChatViewMessagePane.tsx`, covering the message-area background treatment, notice banner, live viewer count badge, restricted-channel summary card, `MessageList` mount point, and bottom anchor element.
- `ChatView` now delegates that middle render block to one focused component instead of mixing the viewport shell with history orchestration, overlay wiring, and composer state in the main container.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat top-chrome extraction from `ChatView` — 2026-08-04

- Extracted the top header/search/live-banner shell into `src/components/chat/ChatViewTopChrome.tsx`, covering the channel header, search bar, inline edit panel, admin return banner, live join/exit banners, countdown banner, and offline banner.
- `ChatView` now delegates that upper presentation block to one focused component instead of mixing top-of-screen chrome with the message-area and overlay render flow.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat overlay callback extraction from `ChatView` — 2026-08-03

- Extracted the remaining overlay event bundle into `src/components/chat/useChatOverlayCallbacks.ts`, covering live start/end prompt behavior, gallery image expansion, links-panel navigation jumps, emoji-picker selection, plus-menu photo/DM toggles, moderation-petition dialog close gating, live popup entry, and gallery-image jump-back behavior.
- `ChatView` now feeds `ChatViewOverlays` through a dedicated callback hook instead of inlining another large cluster of shell and live-session closures in the overlay prop block.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat context-menu action extraction from `ChatView` — 2026-08-03

- Extracted reply targeting, report/unreport wiring, owner edit open, admin delete-with-replies behavior, block/unblock behavior, and report/petition moderation action routing into `src/components/chat/useChatContextMenuActions.ts`.
- `ChatView` now passes a compact derived action set into `ContextMenu` instead of carrying the remaining policy-heavy inline callback block at the menu callsite.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat overlay stack extraction from `ChatView` — 2026-08-03

- Extracted the bottom-of-page shell and dialog stack into `src/components/chat/ChatViewOverlays.tsx`, covering the welcome popup, header menu, channel report dialog, moderation petition dialog, owner-channels popup, settings, gallery, links, admin panel, emoji picker, plus menu, live popups, notice editors, and full-image overlay.
- `ChatView` now keeps the overlay state and business callbacks while delegating the overlay render surface to one focused component instead of mixing that shell with message list and composer rendering.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Inline chat edit panel visibility update — 2026-08-03

- The message edit surface now opens inline directly below the search bar instead of as a centered modal overlay.
- `src/components/chat/EditDialog.tsx` now supports an inline presentation mode, and `ChatView` renders the active edit panel near the top of the page so edit state is immediately visible while reviewing message history.
- This is a frontend-only UX change with no schema or Worker deployment requirement.

### Chat channel-settings callback extraction from `ChatView` — 2026-08-03

- Extracted the remaining settings/admin callback cluster into `src/components/chat/useChatChannelSettings.ts`, covering viewer color preference changes, admin profile/background/name/profile-image updates, petition and DM toggles, profile visibility updates, rules/welcome updates, passcode-hint updates, unblock actions, and notice-edit save behavior.
- `ChatView` now consumes a dedicated settings callback hook instead of carrying the admin panel and notice-edit mutation callbacks inline beside unrelated chat rendering and realtime wiring.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat admin/channel action extraction from `ChatView` — 2026-08-03

- Extracted admin/channel shell state and handlers into `src/components/chat/useChatAdminChannelActions.ts`, covering header-menu state, settings/notice/gallery/links/admin/owner-channel/report-dialog panel state, gallery entry/load-more behavior, channel sharing, channel reporting, admin freeze toggling, and live-start/end prompt entry wiring.
- `ChatView` now consumes a dedicated admin/channel action hook instead of mixing panel visibility state, banner-heavy local admin actions, and gallery-entry fetch logic inline with chat rendering and realtime behavior.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat interaction-state extraction from `ChatView` — 2026-08-03

- Extracted context-menu state, long-press/touch handling, emoji-picker state, full-image viewer state, expanded-post state, and related local open/close handlers into `src/components/chat/useChatInteractions.ts`.
- `ChatView` now consumes a dedicated interaction hook instead of carrying gesture timers, image-overlay state, context-menu state, and callback-ref indirection inline with unrelated chat and admin behavior.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat mutation extraction from `ChatView` — 2026-08-03

- Extracted send flow, blocked-user petition send behavior, DM send branching, upload batching, reaction toggles, delete behavior, edit-save behavior, petition-state reset, and shared mutation error handling into `src/components/chat/useChatMessageMutations.ts`.
- `ChatView` now consumes a dedicated mutation hook instead of carrying the core message action pipeline inline beside unrelated rendering, realtime, and modal state.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat composer-state extraction from `ChatView` — 2026-08-03

- Extracted draft input state, reply target state, edit-dialog draft state, pending-photo lifecycle, textarea auto-resize behavior, and related local composer handlers into `src/components/chat/useChatComposerState.ts`.
- `ChatView` now consumes a focused composer-state hook while still keeping the actual send, edit, delete, and reaction mutation pipeline inline for a later lower-noise extraction.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat reports/search extraction from `ChatView` — 2026-08-03

- Extracted reports-inbox filter state, search-panel state, locally tracked reported-message ids, report/unreport actions, and the selector-backed derived report/search message collections into `src/components/chat/useChatReportsSearch.ts`.
- `ChatView` now consumes one reports/search hook instead of mixing search UI state, reports-owner filter toggles, local report persistence, and message-collection derivation inline with unrelated realtime and composer behavior.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat live-session extraction from `ChatView` — 2026-08-03

- Extracted live-mode session state, countdown banners, expiry retry handling, popup visibility, live local-storage sync, and emoji-preset hydration into `src/components/chat/useChatLiveSession.ts`.
- `ChatView` now keeps the surrounding fetch/apply orchestration while delegating live-mode state transitions and timer policy to a dedicated hook instead of carrying that session logic inline beside unrelated chat behavior.
- The admin live toggle now routes through the existing end-live confirmation flow instead of locally flipping state without confirming the server action.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat moderation domain extraction from `ChatView` — 2026-08-03

- Extracted owner-freeze state, viewer moderation gating, report/petition action handlers, moderation petition submission, and pending moderation-action state into `src/components/chat/useChatModeration.ts`.
- `ChatView` now consumes a dedicated moderation hook instead of carrying the report/petition mutation flow and owner moderation banner logic inline.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat history navigation extraction from `ChatView` — 2026-08-03

- Extracted top/bottom history paging, bounded-window coordination, latest reset, and direct message-jump behavior into `src/components/chat/useChatHistoryNavigation.ts`.
- `ChatView` now consumes a dedicated history controller hook instead of carrying the scroll-triggered pagination state machine inline beside unrelated realtime and admin behaviors.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat message selector extraction from `ChatView` — 2026-08-03

- Extracted message-display derivation into `src/components/chat/chatMessageSelectors.ts`, moving admin/user message selection, reports-inbox filtering, restricted-channel rollups, reported-target collection, and reply threading out of `ChatView`.
- `ChatView` now reads one memoized derived chat-collections object instead of maintaining several adjacent selector-style `useMemo` blocks inline.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat message row/list extraction from `ChatView` — 2026-08-03

- Extracted row-level chat presentation into `src/components/chat/ChatMessageList.tsx`, moving bubble styling, reply layout, reaction badge placement, moderation-inbox row treatment, and per-day separators out of `ChatView`.
- Added `src/components/chat/chatTypes.ts` so the shared message, report, and petition shapes no longer need to be redeclared inside the main chat container as more submodules are extracted.
- Exported the mounted-history limit from `chatMessageUtils` because `ChatView` still owns the scrolling/pagination policy that uses the same bound.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat message content extraction from `ChatView` — 2026-08-03

- Extracted linkification, inline media retry/open behavior, and text-plus-embed bubble rendering into `src/components/chat/ChatMessageContent.tsx`.
- `ChatView` now imports a small message-content surface instead of carrying the URL parsing, long-text expansion, and embed-hiding state inline inside the main container file.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat message utility extraction from `ChatView` — 2026-08-03

- Extracted pure message-history and formatting helpers into `src/components/chat/chatMessageUtils.ts` so `ChatView` no longer owns the mounted-history trimming, live countdown formatting, reaction parsing, inbox-line stripping, or server-snapshot merge logic inline.
- The extracted snapshot merge keeps the existing behavior that preserves already loaded older history while still removing messages that disappear from the server's current snapshot window.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Chat action policy extraction and context-menu cleanup — 2026-08-03

- Extracted shared chat action rules into a dedicated helper so fallback moderation-message detection and admin reply/block eligibility no longer live as repeated inline conditions inside `ChatView`.
- Admin reply suppression for owner DMs and protected moderation notices now flows through those shared rules instead of one-off ternaries at the menu callsite.
- `ContextMenu` now uses a static reusable action-button component rather than creating it during render, reducing one of the local React/compiler maintenance hazards in that file.
- Bubble highlight styling in `ContextMenu` now applies through a local element ref path instead of mutating the incoming prop object directly.
- This is a frontend-only maintainability change with no schema or Worker deployment requirement.

### Stable super-admin support thread scrolling — 2026-08-02

- The super-admin 1:1 support panel no longer replaces its message state when a poll returns an identical ordered message list.
- Polling, read-marker updates and metadata refreshes no longer force the transcript to the bottom.
- Initial entry still opens at the latest message. A genuinely new last message follows automatically only when the operator was already near the bottom; reading older content is no longer interrupted.
- The polling effect no longer treats its Effect Event callback as a changing dependency, which previously recreated timers and produced a rapid thread/session request storm.
- Concurrent focus, visibility and interval refreshes now share one in-flight load, and network failures are handled instead of surfacing as unhandled promise rejections.
- This is a frontend-only change with no schema or Worker deployment requirement.

### Super-admin dashboard recovery and repeat warning controls — 2026-08-02

- Qualified `support_messages.created_at` in the support dashboard rollup query. The previous unqualified column became ambiguous after joining `support_threads`, causing authenticated super-admin dashboard requests to fail with D1 `500` responses.
- Dashboard failures at `5xx` no longer silently downgrade the super admin into the regular account view. The dashboard now shows an explicit retry state while `403/404` still identify ordinary accounts.
- Open reports now offer a repeat-warning action while the channel is `warned` or `suspended`; only frozen channels hide the warning action.
- The Worker rejects direct repeat-warning requests against resolved or dismissed reports, matching the UI's open-report rule.
- No schema migration is required. Deploy both the Worker and Next.js frontend.

### Channel-local passcode verification limits — 2026-08-02

This follow-up moves protected-room passcode attempt enforcement from the global D1 rate-limit table into the target channel's Durable Object.

- The existing policy remains five verification attempts per IP and channel in each aligned one-minute window.
- The request IP and channel are still HMAC-pseudonymized with the internal secret before the value reaches Durable Object storage.
- The route first performs its required channel lookup and creates rate-limit state only for an existing channel. Random nonexistent slugs therefore cannot be used to create unbounded Durable Objects.
- Durable Object storage updates are transactional and survive hibernation. Limiter failures return `503` and never fall through to passcode verification.
- The same Durable Object stub is reused if a successful legacy passcode upgrade needs to notify connected clients.

Cost and performance effect:

- removes one D1 rate-limit upsert, one D1 count read, related index maintenance and later retention deletion from every passcode attempt;
- retains the single channel lookup that is required to obtain the stored passcode hash;
- replaces the removed D1 enforcement work with one channel-local Durable Object request and one small overwritten record.

Trade-offs and UX:

- valid, incorrect and excessive passcode behavior is unchanged; the sixth attempt in a one-minute window still receives `429`;
- nonexistent channels now return `404` before consuming limiter storage. Channel existence is already exposed by the product's exact-address lookup, but this changes the internal operation order;
- a Durable Object outage returns `503`, briefly preventing entry rather than weakening brute-force protection;
- one small record remains per channel and historical IP pseudonym until a future alarm-based cleanup removes stale keys;
- no D1 migration is required. Existing `passcode-verify` D1 rows expire through scheduled retention.

Deployment notes:

- deploy the Worker for this optimization;
- no frontend deployment or D1 migration is required.

### Channel-local DM and edit rate limits — 2026-08-02

This follow-up extends the channel Durable Object rate-limit path from new messages to the two remaining high-frequency channel mutations that previously wrote enforcement state to D1.

- DM sends and message edits now use the same parent-channel Durable Object as normal/live message sends and real-time broadcast delivery.
- Each operation has an independent scope (`message-send`, `dm-send`, or `message-edit`), so activity in one category does not consume another category's allowance.
- New DM/edit keys hash the scope and signed actor/device subject together; raw actor identifiers are not retained as key names. The existing message-send key format is preserved to avoid resetting active buckets or stranding duplicate records during rollout.
- Rate updates remain transactional and durable across hibernation. If the channel limiter is unavailable, the mutation fails closed with `503` instead of silently losing enforcement.
- The existing user-visible limits remain unchanged: DM sends and message edits allow five attempts per aligned ten-second window.

Cost and performance effect:

- removes the D1 upsert, follow-up read, index maintenance and later retention delete previously generated by every DM send and message edit attempt;
- reuses the Durable Object stub that each successful operation already needs for its real-time broadcast;
- keeps one small overwritten record per channel, operation scope and historical sender/device instead of adding one D1 enforcement lifecycle per attempt.

Trade-offs:

- each limited mutation still performs one internal Durable Object request and one small Durable Object storage overwrite;
- a temporary Durable Object storage failure now rejects the mutation with `503`, which is safer for abuse control but can briefly reduce availability;
- per-sender records remain in channel-local storage after their active window expires. Their size is bounded per historical sender and scope, but very large public channels may eventually need alarm-based pruning;
- passcode, preview, support, authentication and daily report limits remain D1-backed because they are cross-channel, low-frequency, or do not naturally belong to one channel Durable Object;
- no D1 migration is required. Existing `dm-send` and `message-edit` rows age out through the current scheduled retention job.

Deployment notes:

- deploy the Worker for this optimization;
- no frontend deployment or D1 migration is required.

### Channel-local durable message rate limits — 2026-08-02

This Worker optimization removes the D1 write/read/delete lifecycle previously performed for every new chat message.

- New-message rate limits now run inside the parent channel's Durable Object, which already serializes that channel's real-time activity.
- Each user/device pair maps to one SHA-256-keyed Durable Object storage record containing only the current aligned 10-second bucket and count.
- The record is overwritten instead of inserting a new D1 row for every time window, and it remains valid across WebSocket hibernation or object eviction.
- The existing `5` messages per `10` seconds rule and aligned-window behavior are unchanged.
- Live and normal messages share the parent channel's limiter, matching the previous parent-channel D1 subject scope.
- The message route fails closed with `503` if the internal limiter request cannot complete; it never writes a message without a successful limit decision.
- Edit, reaction, support, authentication, and upload limits retain their existing D1-backed implementation because their traffic is lower or their scope is not naturally owned by one channel DO.

Cost and storage impact:

- A successful message no longer updates `durable_rate_limits`, reads the row back, maintains its D1 indexes, retains a per-window row for seven days, and later deletes that row.
- The trade is one additional internal Durable Object request and one small DO storage overwrite per message. DO requests are inexpensive on the paid plan, and the fixed per-user record avoids unbounded per-window row growth.
- Subject identifiers are SHA-256 hashed before becoming storage keys; raw UID/device combinations are not stored as Durable Object keys.

Trade-offs and UX changes:

- There is no intended user-visible change at normal send rates. The sixth message in the same aligned 10-second window is still rejected.
- Rate-limit state now depends on the channel Durable Object. A temporary DO storage failure produces a send failure instead of falling back to an unprotected write.
- Old `message-send` rows already present in D1 are not needed by the new path. Existing scheduled retention will remove them naturally, avoiding a destructive one-time cleanup.
- Durable Object storage keeps one tiny record per user/device that has sent in a channel. At the expected 30 users per channel this is negligible, but a later retention alarm can prune very old subjects if channels accumulate extremely large historical audiences.

Deployment notes:

- no D1 schema or Durable Object namespace migration is required;
- deploy the Worker separately from Vercel;
- monitor message `429`/`503`, Durable Object requests, DO storage writes, and D1 `rows_written` after rollout.

### Hibernatable channel WebSockets — 2026-08-02

This Worker optimization removes the largest avoidable Durable Object duration cost in idle chat rooms.

- `ChatRoom` now accepts sockets with the Durable Object Hibernation WebSocket API instead of the standard in-memory `server.accept()` API.
- Each socket serializes its channel, user, authorization, admin/viewer override, authentication-attempt, and live-session participation state into a WebSocket attachment.
- When Cloudflare wakes a hibernated object, the constructor rebuilds the active connection map from `state.getWebSockets()` and those attachments.
- WebSocket message, close, and error handling now use the Durable Object `webSocketMessage`, `webSocketClose`, and `webSocketError` handlers required by hibernation.
- Passcode changes persist revoked/opened access state back to every affected attachment, so hibernation cannot restore stale room access.
- Live presence no longer depends on a process-local `Set`; it is derived from the restored per-connection attachment state.
- Admin-only DM broadcasts, general broadcasts, debounced presence updates, room tokens, reports-owner access, and admin authentication keep their existing behavior.

Trade-offs and UX changes:

- Connected clients should see no intentional UI change. Idle rooms can now sleep while WebSocket connections remain attached at Cloudflare's edge, substantially reducing billable Durable Object duration.
- Hibernation clears process-local passcode cache state. The first authorization handled after a wake may perform one indexed D1 channel lookup and can be slightly slower; subsequent authorizations during that active lifetime reuse the cache.
- Connection metadata must be serialized whenever authorization or live participation changes. These small attachment updates are necessary to prevent privilege or presence state from reverting after a wake.
- Deploying a new Worker version can still cause clients to reconnect. The existing frontend reconnect and message re-sync paths remain the recovery mechanism.
- The 150 ms presence debounce can keep an object active briefly after joins, leaves, or authorization changes, but it no longer remains active for the full idle lifetime of each socket.

Deployment notes:

- no D1 migration or Durable Object namespace migration is required;
- deploy the Worker separately from Vercel;
- monitor Durable Object duration, WebSocket reconnects, and authorization failures after rollout.

### Streaming upload proxy and bounded background assets — 2026-08-02

This frontend optimization removes an avoidable full-file copy in the Vercel upload proxy and reduces oversized static chat-background uploads.

- The Next.js upload Route Handler now forwards the incoming Web `ReadableStream` to the Worker instead of first materializing the complete body with `request.arrayBuffer()`.
- The validated original `Content-Length` is forwarded when present, allowing the Worker to reject known oversized uploads before reading them.
- The Worker still performs its existing byte-by-byte 10 MB enforcement before writing to R2, so missing or forged length headers do not bypass the hard upload limit.
- JPEG, PNG, and WebP chat backgrounds larger than `2 MB` or with a dimension above `1920px` are resized in the browser to fit within `1920 × 1920` and encoded as JPEG at quality `0.84` before upload.
- Smaller background files remain byte-for-byte unchanged. Message images retain their existing `1200px` optimization, and animated GIF handling is unchanged.

Trade-offs and UX changes:

- Large background images upload faster and consume less R2 storage and delivery bandwidth, but JPEG conversion removes transparency and can introduce mild compression artifacts. The channel's configurable overlay and blur remain unchanged.
- Background optimization adds a short client-side processing step before upload. On older phones this can briefly use CPU and memory, but avoids repeatedly transferring and decoding a much larger original on every channel visit.
- Streaming removes the Next.js `arrayBuffer` copy, but the Worker intentionally retains its bounded buffer so it can enforce the actual 10 MB limit before committing an object. Fully direct-to-R2 streaming would require a separate signed-upload/finalization protocol to preserve this security guarantee.
- This does not generate separate thumbnail objects. Existing message and gallery surfaces continue to use the optimized main image; dedicated thumbnails remain a possible later improvement if media traffic grows substantially.

Deployment notes:

- no D1 migration is required;
- deploy the Next.js frontend;
- no Worker deployment is required because the Worker's validation and R2 write path are unchanged.

### Bounded bidirectional chat history window — 2026-08-02

This frontend optimization prevents very long historical browsing sessions from leaving every visited message mounted in the chat DOM.

- Normal initial and context loads are unchanged, but incremental history browsing now keeps an approximately `300`-message mounted window.
- When older pages push the window over the limit, the newest edge is released and the existing newer-message pagination remains available.
- When browsing forward again, the oldest edge is released and the existing older-message pagination remains available.
- Scroll restoration follows the actual DOM position of the boundary message instead of estimating from total scroll height, reducing jumps with mixed-height text, image, and widget bubbles.
- If the oldest edge would cut a reply away from its parent, the required parent is retained. The `300` limit is therefore deliberately soft by a small number of parent messages.
- Returning to the latest messages still uses the existing **latest messages** action and resets the context window to the current server page.

Trade-offs and UX changes:

- After traversing more than roughly 300 messages, messages beyond the opposite edge are removed from the DOM and must be fetched again if the user reverses direction far enough. This trades a small amount of repeat network traffic for bounded browser memory and rendering work.
- The optimization is windowing rather than pixel-perfect row virtualization. It avoids the high-risk requirement to predict dynamic heights for images, widgets, edited captions, reactions, and replies, while still bounding the worst historical-session DOM growth.
- A long reply chain can make the mounted count slightly exceed 300 because preserving reply context is preferred over displaying a reply as an unrelated top-level message.
- Search or gallery jumps to an unloaded message continue to replace the current list with the server's small context window, so direct historical navigation remains available.

Deployment notes:

- no Worker or D1 migration is required;
- deploy the Next.js frontend;
- this change does not alter message retention on the server, only how much history one browser mounts at once.

### Cursor-paginated platform support inbox — 2026-08-02

This frontend-and-Worker optimization bounds the expensive platform-admin support query while keeping inbox totals accurate.

- The initial platform support dashboard now loads at most `40` open tickets plus the existing `30` recently closed tickets.
- Older open tickets use a stable `(updated_at, id)` cursor and load in additional pages only when the operator selects **Load older tickets**.
- The Worker accepts a bounded open-ticket page size with a hard maximum of `100`, preventing clients from restoring an unlimited query through URL parameters.
- Dashboard counts are no longer derived from only the visible ticket page. A separate aggregate query calculates all open, waiting, unread, stale, and oldest-ticket totals across the complete open inbox.
- The aggregate groups open-thread message timestamps once instead of running the full ticket-preview subqueries for every open row.
- Regular 30-second dashboard refreshes retain already loaded older pages, so the visible list does not collapse back to the first page while an operator is working.

Trade-offs and UX changes:

- Platform operators initially see the newest 40 open tickets instead of every open ticket. Older items require an explicit **Load older tickets** action; normal users and channel admins are unaffected.
- Filters operate on tickets currently loaded in the browser, while the badges above them continue to show exact totals for the whole inbox. An operator may need to load older pages to see every ticket matching a high total.
- The aggregate query still scans message metadata for open support threads on each dashboard refresh. It is substantially more predictable than serializing every ticket, but very large support volume may eventually justify cached counters or a dedicated operational index.
- Cursor ordering is stable for normal ISO timestamps and uses the ticket ID as a tie-breaker. A ticket updated while paging can move into a newer page; client-side ID deduplication prevents duplicate rows.

Deployment notes:

- no D1 schema migration is required;
- deploy both the Worker and the Next.js frontend;
- Vercel deploys only the frontend, so the Worker must still be deployed separately.

### Indexed media-key resolution fast path — 2026-08-02

This Worker optimization reduces D1 reads on the most common protected-media path without introducing another ownership table.

- Attached message and DM media now resolve directly through the existing unique `upload_tickets.key` index.
- A normal message-image request now needs one narrow ticket lookup before token verification and R2 delivery, instead of batching a channel lookup together with a pending-ticket lookup on every request.
- Pending tickets remain hidden until attachment, and cancelled tickets now return `404` immediately instead of falling through to the broad channel-key path.
- Profile images and channel backgrounds continue to fall back to the channel row because channel assets intentionally do not create upload tickets.
- Malformed and legacy object keys retain the older multi-table compatibility lookup.

Trade-offs:

- Channel profile/background reads without an upload ticket now perform their channel lookup after the key lookup, so an uncached channel asset can incur two sequential D1 reads. These assets are comparatively rare and profile images use long-lived immutable browser caching.
- Attached upload-ticket rows must remain present for as long as their message or DM media exists. Existing delete paths already remove those rows together with their attachment.
- Legacy objects do not receive the fast path until they are migrated to indexed keys; compatibility is preserved at the cost of their existing wider lookup.

Deployment notes:

- no new D1 migration is required because `upload_tickets.key` has been unique and indexed since migration `0016`;
- deploy the Worker for this optimization;
- no Next.js frontend deploy is required for this line by itself.

### Shared support foreground polling — 2026-08-04

This frontend-only optimization removes duplicated support-thread polling policy and adds missing in-flight request coalescing to the user support panel.

- A new shared foreground-polling hook now owns the interval, focus and visibility refresh behavior used by both support thread panels.
- The user-facing `SupportPanel` now reuses one in-flight `fetchSupportState` request instead of allowing overlapping thread refreshes.
- The platform-admin `PlatformSupportThreadPanel` keeps its existing in-flight protection and now uses the same shared polling hook for the refresh schedule.

Trade-offs:

- Refresh behavior is intentionally unchanged, so this does not reduce the polling cadence by itself; it reduces duplicated logic and concurrent duplicate requests.
- A slow support-thread refresh now blocks overlapping refresh triggers until that request settles, which is preferable to stacking the same request repeatedly.

Deployment notes:

- no new D1 migration is required;
- no Worker deploy is required for this optimization;
- deploy the Next.js frontend for this line.

### Concurrent scheduled upload cleanup batches — 2026-08-04

This Worker-only optimization shortens the hourly abandoned-upload cleanup sweep without changing its retention policy.

- Each `cleanupExpiredUploadTickets` batch still selects the same expired pending upload-ticket rows and deletes the same rows from D1 afterward.
- R2 object deletions inside that batch are now processed in bounded parallel groups of `16` instead of one-by-one.
- Upload quotas, upload-ticket expiry rules and the hourly cleanup schedule are unchanged.

Trade-offs:

- The scheduled cleanup sweep now uses a small amount of parallel R2 delete pressure during each batch instead of purely serial calls.
- Deletion failures are still treated the same way as before: they are swallowed so the maintenance pass can continue, which keeps this change low risk but does not add retry tracking.

Deployment notes:

- no new D1 migration is required;
- deploy the Worker for this optimization;
- no Next.js frontend deploy is required for this line.

### Parallel user-support state reads — 2026-08-04

This Worker-only optimization reduces support-panel latency by collapsing independent D1 reads in the user support flow.

- `buildUserSupportState` now loads platform-admin status, open session and open thread in parallel, then loads transcript and thread messages in parallel when both are needed.
- `handleSupportStartSession` now parallelizes the existing-thread and existing-session lookup, and also parallelizes follow-up transcript, session and message reads when resuming or creating a support session.
- Response payloads, support-session behavior and support-thread behavior are unchanged.

Trade-offs:

- This increases concurrent D1 read pressure slightly during support-panel loads, but replaces longer sequential latency on the same request path.
- The change stays intentionally narrow: it does not redesign the API shape or merge the support-session and support-thread tables.

Deployment notes:

- no new D1 migration is required;
- deploy the Worker for this optimization;
- no Next.js frontend deploy is required for this line.

### Parallel support detail reloads — 2026-08-04

This Worker-only optimization trims more avoidable latency from support mutation and detail endpoints without changing their response shapes.

- Escalated support-thread creation now reloads the created thread row and its message list in parallel.
- Guided support-session answers now reload the updated session row and transcript in parallel after the session state write.
- Platform-admin support detail endpoints now load thread plus messages, and session plus transcript, in parallel.
- User-driven support-thread close now reuses the thread row it already loaded for ownership checks instead of fetching the same row again inside the close helper.

Trade-offs:

- A few endpoints now issue small parallel read bursts against D1 instead of strictly sequential reads.
- Thread-detail and session-detail requests may perform one harmless extra lookup on the associated messages or transcript even when the parent row is missing, in exchange for lower latency on the common success path.

Deployment notes:

- no new D1 migration is required;
- deploy the Worker for this optimization;
- no Next.js frontend deploy is required for this line.

### Dashboard owned-channel load coalescing — 2026-08-04

This frontend-and-Worker optimization reduces repeated owned-channel dashboard work without changing the visible dashboard model.

- The dashboard `loadChannels` path now reuses one in-flight `/api/user` request instead of launching duplicate owned-channel reloads when multiple UI actions ask for the same refresh.
- Removing only recent channels from the dashboard no longer forces an unnecessary owned-channel reload.
- The Worker `readUserState` query now scopes message activity aggregation to the current owner's channels and joins live-state rows in one pass, instead of running per-channel correlated lookups for `last_message_at` and live status.

Trade-offs:

- Concurrent dashboard refresh triggers now wait on one shared owned-channel request, so a second trigger will not force an immediate duplicate fetch.
- The Worker query is more complex than before, but it does less repeated work on the common success path and keeps the response shape unchanged.

Deployment notes:

- no new D1 migration is required;
- deploy the Worker for the `readUserState` query change;
- deploy the Next.js frontend for the dashboard request-coalescing change.

### Indexed dashboard activity lookup — 2026-08-05

This Worker and D1 optimization reduces rows read when loading owned channels without changing dashboard behavior.

- Added migration `0029_message_activity_lookup.sql` with a covering index on `(channel_id, deleted, created_at DESC, id DESC)`.
- Replaced the `/api/user` `GROUP BY + MAX` message-activity aggregation with one latest-visible-message index lookup per owned channel.
- The index also supports the ordering and deletion filter used by paginated channel search, avoiding a separate sort while substring matching remains unchanged.

Trade-offs:

- Each message insert, deletion-state update, and timestamp/id index change now maintains one additional index entry.
- The index consumes additional D1 storage.
- Arbitrary substring search still scans candidate message text because a normal B-tree cannot index `instr(lower(text), ...)`; trigram search remains a separate, higher-cost redesign.

Deployment notes:

- apply D1 migration `0029_message_activity_lookup.sql` first;
- deploy the Worker after the migration;
- no Next.js frontend deployment is required.

### User-acknowledged support closure — 2026-08-05

- Added migration `0030_support_closure_acknowledgement.sql` to retain whether a user has acknowledged an admin-closed support ticket.
- Closing a ticket as platform admin now appends a localized closure message and keeps that closed ticket visible in the user's support state and dashboard preview.
- The user confirms the closure from the final message. Acknowledgement then removes the ticket from the user's dashboard and allows the normal new-support flow.
- User-initiated ticket closure retains its previous immediate-removal behavior.

Deployment notes:

- apply D1 migration `0030_support_closure_acknowledgement.sql` first;
- deploy the Worker and Next.js frontend together.

### Dashboard foreground refresh consolidation — 2026-08-05

- Replaced separate dashboard interval, focus and visibility refresh effects with the shared foreground polling hook.
- One scheduler now applies independent freshness windows for the platform-admin dashboard, normal-user support preview and operational-health data.
- Existing in-flight request deduplication remains in place, while focus and visibility events no longer fan out through multiple listener sets.
- Support-ticket mutation events still force an immediate targeted refresh.

Trade-offs:

- Returning to the dashboard before a resource becomes stale no longer forces a redundant network request, so data can remain at most 30 seconds old for platform admins, 60 seconds old for support previews and five minutes old for operational health.
- Manual refresh controls and known ticket mutations continue to bypass the polling wait.

Deployment notes:

- no D1 migration or Worker deployment is required;
- deploy the Next.js frontend.

### Parallel platform-support dashboard reads — 2026-08-04

This Worker-only optimization reduces platform-admin support dashboard latency by collapsing independent dashboard reads into one concurrent batch.

- Reports channel metadata, open-report summary, open ticket page, closed ticket preview, and support stats now load in parallel inside `fetchPlatformSupportDashboard`.
- Ticket serialization, pagination, stats calculation, and response shape are unchanged.
- The optimization only changes how the Worker gathers the data, not what the admin dashboard displays.

Trade-offs:

- The dashboard request now creates a wider burst of concurrent D1 reads instead of a longer sequential chain.
- If a reports channel ID is configured but the channel row is missing, the Worker can still run the open-report summary query in parallel before discarding it because `reportsInbox` remains gated on the channel row existing.

Deployment notes:

- no new D1 migration is required;
- deploy the Worker for this optimization;
- no Next.js frontend deploy is required for this line.

### Parallel owned-channel account teardown — 2026-08-04

This Worker-only optimization shortens account deletion for users who own multiple channels.

- The account-deletion path now deletes the user's owned channels in parallel instead of awaiting each `deleteChannel` call one-by-one.
- This stays low risk because channel ownership is already capped to a small fixed count, and each channel still uses the existing `deleteChannel` teardown logic.
- User deletion semantics, response shape, and downstream cleanup are unchanged.

Trade-offs:

- Account deletion now creates a small burst of concurrent D1, Durable Object, and R2 cleanup work instead of a strictly serial teardown.
- Because the path still relies on `Promise.all`, one failing channel deletion continues to fail the whole request, which preserves the existing all-or-nothing request behavior but does not introduce partial-progress reporting.

Deployment notes:

- no new D1 migration is required;
- deploy the Worker for this optimization;
- no Next.js frontend deploy is required for this line.

### Dashboard refresh request coalescing — 2026-08-04

This frontend-only optimization prevents the dashboard's overlapping refresh triggers from starting duplicate support-preview and platform-dashboard fetches at the same time.

- `loadPlatformDashboard` now reuses one in-flight promise across initial load, interval polling, focus refresh and `support-ticket-changed` refreshes.
- `loadSupportPreview` now does the same for guest and non-admin dashboard refreshes.
- The refresh cadence and existing state-merging behavior are unchanged; only concurrent duplicate requests are collapsed.

Trade-offs:

- When one dashboard request is already in progress, later refresh triggers now wait for that same request to settle instead of launching a second fetch immediately.
- This favors steadier network and Worker load over the small chance that two back-to-back refresh triggers might otherwise observe slightly different data.

Deployment notes:

- no new D1 migration is required;
- no Worker deploy is required for this optimization;
- deploy the Next.js frontend for this line.

### Scheduled upload-ticket cleanup only — 2026-08-04

This Worker-only optimization removes abandoned upload-ticket cleanup from the synchronous upload request path.

- Non-channel-asset uploads no longer call `cleanupExpiredUploadTickets` before quota enforcement and ticket creation.
- Expired pending upload tickets are still ignored by quota checks because those queries already require `expires_at > now`.
- R2 object deletion for abandoned pending uploads now relies on the existing hourly Worker scheduled-maintenance sweep instead of charging that cost to unrelated uploads.
- Upload behavior, quota rules and upload-ticket issuance are otherwise unchanged.

Trade-offs:

- Unattached expired media can remain in R2 until the next scheduled maintenance window instead of being deleted by the next user's upload request.
- The cleanup cadence is now bounded by the Worker cron schedule, so storage reclamation is slightly less immediate but normal upload latency is more predictable.

Deployment notes:

- no new D1 migration is required;
- deploy the Worker for this optimization;
- no Next.js frontend deploy is required for this line.

### Visibility-gated link preview loading — 2026-08-02

This frontend-only optimization prevents the links panel from launching a burst of preview work whenever it opens.

- Link cards now request Open Graph preview data only when they enter, or approach within `160px` of, the panel's visible scroll area.
- Preview fetches are limited to at most three concurrent requests across open link panels.
- Requests for the same URL share one in-flight promise and continue to reuse the existing in-memory result cache.
- Preview failures are cached as an empty result for the current page session, avoiding repeated failed outbound requests.
- Link navigation and indexed link pagination are unchanged.

Trade-offs:

- Cards farther down the panel initially show their URL fallback and fetch richer metadata only as the user scrolls toward them.
- A slow preview among the three active slots can briefly delay later previews, but it no longer allows a 30-request burst against the Worker and external sites.
- The cache remains process-local in the browser; reopening the app in a new tab can still request previews, while the existing Worker cache provides the shared one-hour layer.

Deployment notes:

- no D1 migration is required;
- no Worker change is required;
- deploy the Next.js frontend for this optimization.

### Live expiry sync for connected viewers — 2026-07-31

This frontend follow-up closes the last obvious gap in live-session expiry behavior for people who are already inside the room.

- When a joined live session's local timer reaches zero, the client now forces a fresh live `init` check instead of waiting for the next manual refresh or write attempt.
- That recheck hits the Worker `init` path with `no-store`, so an expired live session is ended immediately through the existing Worker cleanup path and `live-ended` broadcast.
- Connected viewers therefore see the live session end at the deadline instead of sitting in a stale room until someone reloads.
- Truly abandoned live sessions are still covered by the earlier fallback paths: expired writes are rejected, `init` auto-closes stale sessions, and hourly Worker maintenance sweeps anything nobody reopened.

Deployment notes:

- no new D1 migration is required;
- deploy the Next.js frontend for this line;
- this behavior assumes the earlier Worker live-expiry support from the 8-hour session update is already deployed.

### Live session timeout and hourly expiry cleanup — 2026-07-31

This follow-up line stops temporary live rooms from staying open indefinitely.

- Live sessions now store a started timestamp and an expiry timestamp when the owner starts them.
- The current timeout is `8` hours per live session, which fits the requested `5` to `10` hour window without leaving sessions open forever.
- Live message, DM and upload write paths now reject expired live sessions immediately and trigger the same cleanup path used by manual live-end.
- Channel init now auto-closes an expired live session before returning live state, so stale live banners do not linger after refresh.
- Scheduled Worker maintenance now checks live-session expiry hourly instead of once per day, which cleans up abandoned sessions even when nobody revisits the room.
- No D1 migration is required because the live-session state remains stored in existing `config` rows.

Deployment notes:

- deploy the Worker because the timeout enforcement and hourly cleanup run there;
- deploy the Next.js frontend as well if you want the owner-facing live-start prompt to mention the 8-hour auto-end behavior;
- no new D1 migration is required.

### Vercel origin-transfer spike and dashboard request spike — 2026-07-31

This incident line explains the unusually large morning bandwidth and request jump that showed up after the support/dashboard rollout.

Observed symptoms:

- Vercel `Outgoing Fast Origin Transfer` spiked unexpectedly even though no new media set had been uploaded.
- Edge request volume also jumped, especially around dashboard and support surfaces.

Root causes:

- A meaningful share of media reads was still passing through the same-origin Next.js `/api/media/*` proxy even when the browser already had enough information to fetch the object directly from the Worker. That made Vercel sit in the middle of large media responses that should have stayed on the Cloudflare side.
- The super-admin dashboard was still refreshing too aggressively and was also touching support-preview reads that were only relevant to normal users.
- Open support-thread views and support panels were polling too often, including cases where the tab was hidden.
- The Next.js `/api/user` GET path could still fall through to a sync-style write path instead of behaving as a read-first endpoint.
- Link previews, locale persistence, and version checks were generating avoidable duplicate requests.

Fixes shipped:

- `31574f9` `Bypass Vercel media proxy for worker assets`
  - The media route now redirects straight to the Worker whenever the browser already has room-token access or is using the guest path.
  - The same-origin proxy is preserved only as an authenticated owner fallback path instead of the default byte-serving path.
- `88334cd` `Fix dashboard request loop for admin support`
  - Removed the bad dashboard refresh behavior that kept super-admin support surfaces hotter than intended.
- `3b45189` `Reduce dashboard and support traffic overhead`
  - Changed `/api/user` to a read-first contract and added matching Worker-side read behavior.
  - Slowed and gated dashboard polling so the super-admin dashboard and normal-user support preview do not both refresh all the time.
  - Stopped polling support preview when the user has no active temporary `1:1` ticket item.
  - Made support-thread polling visibility-aware and focus-aware.
  - Deduped locale persistence writes, link-preview in-flight fetches, and version checks.

Result:

- Media bytes that do not need authenticated frontend proxying now bypass Vercel.
- The dashboard and support surfaces generate materially fewer repeated reads.
- Request growth from ordinary dashboard/support usage is now bounded much more tightly.

Deployment notes:

- no new D1 migration is required;
- the media-bypass change is frontend-only;
- the `/api/user` read-first contract requires both Worker and Next.js deploys;
- in practice, deploy both runtimes together when catching up this whole incident-fix line.

### Media lookup fast path and indexed links panel — 2026-07-31

This follow-up line reduces hot D1 work that still remained after the Vercel-transfer and dashboard polling fixes.

- Added D1 migration `0028_media_lookup_and_message_links.sql`.
- The new `message_links` table stores one indexed row per message that currently contains a link and is backfilled from existing messages during migration.
- Message create, edit, delete, admin delete, channel delete, and live-session cleanup paths now keep that link index synchronized.
- The links panel no longer scans `messages.text` with leading-wildcard `LIKE` filters and instead reads recent link-bearing messages through `message_links(channel_id, created_at, message_id)`.
- Protected media reads now infer the channel directly from the R2 object key prefix, then do a narrow channel lookup plus pending-upload check on the common path.
- The older multi-table reverse lookup remains in place only as a compatibility fallback for malformed or legacy keys that do not follow the current `{channelId}/{uuid}.{ext}` object-key format.
- Support thread polling was slowed from `15s` to `30s`, the admin dashboard poll was slowed from `15s` to `30s`, and the normal-user support preview poll was slowed from `30s` to `60s`.

Why this mattered:

- The previous links query had to search message text directly, which gets more expensive as a room grows.
- The previous protected-media route could do up to six reverse-lookup queries before it even reached access checks or R2.
- Support and dashboard traffic was already bounded, but the baseline idle request rate was still higher than necessary.

Deployment notes:

- apply D1 migration `0028_media_lookup_and_message_links.sql` first;
- deploy the Worker next so write paths and the media/links readers understand the new table;
- deploy the Next.js frontend as well if you want the slower support/dashboard polling constants to take effect immediately.

### Locale-aware legal pages and language-preference precedence — 2026-07-31

This frontend-only line finished the user-facing legal surface.

- The `/privacy` and `/terms` pages now render only the currently active locale instead of showing Korean and English together on the same page.
- Both legal documents were rewritten into fuller article-by-article documents aligned to the current product behavior and to the fact that `yap.` is a personally operated project, not a separate company entity.
- The legal renderer now waits for the hydrated locale before drawing the final document, which avoids flashing the wrong language first.
- Manual locale choice now takes precedence over device language for the legal pages because they follow the same app-level locale state as the rest of the product.

Deployment notes:

- no new D1 migration is required;
- this is a frontend deploy only.

### Dashboard and support traffic reduction — 2026-07-31

This follow-up line reduced avoidable request volume without changing schema.

- The Next.js `/api/user` proxy now reads the existing user row first and only falls back to the sync-creation path when the Worker reports `user_not_found`, instead of writing on every dashboard load.
- The Worker `/api/user` route now supports that read-first contract by resolving internal user identity and returning current channel and preference state without forcing a write.
- The super-admin dashboard now polls more slowly, and the normal user dashboard polls support preview state only when a temporary active `1:1` ticket item actually exists.
- Open support-thread views now skip background polling while the tab is hidden and refresh on focus or visibility return instead of hammering the endpoint continuously.
- Locale persistence writes are now deduped through `UserPreferencesSync`, so changing language no longer triggers duplicate preference PATCHes.
- Link-preview fetches now share one in-flight request per URL, and app-version checks now run less often without a timestamp cache-buster.

Deployment notes:

- no new D1 migration is required;
- deploy the Worker and the Next.js frontend together for this line because the `/api/user` read/sync behavior changed on both sides.

### Support, reports and dashboard UI polish — 2026-07-31

This frontend-only line polished the current support and moderation surfaces without adding schema.

- The guided user support panel now clears its in-progress session when the user closes it, so reopening starts from the first step instead of dropping back into the previous `still need help` state.
- The super-admin reports inbox now keeps unresolved reports at the bottom while preserving chronological order inside each group.
- The reports inbox now includes a restricted-channel summary block plus simple plus-menu filters for `Open`, `Warned`, and `Frozen`.
- The super-admin dashboard support rows now use topic-specific simple icons instead of a generic empty profile image slot.
- The super-admin dashboard no longer applies the row-reorder animation, so new `1:1` tickets do not shake the whole list.
- Visible app logos now switch to `logo-white.svg` in dark mode, including dashboard and onboarding surfaces.

Deployment notes:

- no new D1 migration is required;
- Worker deploy is only required if you are also catching up the earlier support/report payload changes from `0025` to `0027`;
- otherwise these are frontend deploys only.

### Hardening controls and monitoring — 2026-07-30

This deployment line added the first durable abuse-control and observability pass.

- Added `0021_hardening_controls.sql` with:
  - `durable_rate_limits`
  - `moderation_audit_logs`
  - `operational_events`
- Replaced isolate-local message, DM and preview throttles with D1-backed durable rate limits.
- Added a daily durable per-reporter quota for channel reports.
- Added append-only moderation audit entries for report resolution, warnings, freezes, unfreezes, deletions and petition decisions.
- Added explicit Worker-side security headers and operational event recording for `429`, `403`, `5xx` and unhandled exceptions.
- Added focused edge-case tests for rate-limit bucket math and preview URL policy in `worker/tests/hardening.test.ts`.

Deployment notes:

- apply `0021` before deploying the Worker code that reads the new hardening tables;
- the hardening test command is `cd worker && npm run test:hardening`;
- local Wrangler D1 commands still depend on the local `workerd` binary, so environment/runtime issues can block local migrations even when the schema itself is valid.

### Chat UI polish — 2026-07-30

This frontend-only line cleaned up recent chat surfaces without changing schema.

- Refined the floating notice banner styling.
- Capped floating notice banner width.
- Added explicit text padding for text that shares a bubble with embedded widgets so mixed text-plus-widget bubbles match the media-bubble padding model.

Deployment notes:

- no new D1 migration is required;
- these are frontend deploys only.

### Query performance and retention maintenance — 2026-07-30

This follow-up line addressed the next obvious D1 scaling gaps without changing application behavior.

- Added `0022_query_perf_and_retention.sql`.
- Added message paging indexes aligned to `channel_id`, `created_at` and `id`.
- Added upload-ticket quota indexes aligned to the actual `channel_id + uid/ip_hash + purpose + created_at/expires_at` count queries.
- Added created-time indexes for moderation audit log and operational event retention cleanup.
- Added a daily Worker cron to prune expired upload tickets, old durable rate-limit buckets, old operational events and old moderation audit rows in bounded batches.

Deployment notes:

- apply `0022` before deploying the Worker if you want the new query plans active immediately;
- the scheduled maintenance handler is activated by the Worker cron configured in `worker/wrangler.toml`.

### Privacy-focused identity cleanup — 2026-07-30

This follow-up line removed the last browser-fingerprint-era paths and reduced identifier retention.

- Added `0023_privacy_identity_cleanup.sql`.
- Added `blocked.device_id` and backfilled it from the legacy `fingerprint` column for backward compatibility.
- Cleared legacy message-level fingerprint values so normal chat history no longer retains per-message device identifiers.
- Stopped writing device identifiers onto new normal messages.
- Shortened anonymous and device identity token lifetime from one year to ninety days.
- Removed the unused browser fingerprint helper from the frontend codebase.

Deployment notes:

- apply `0023` before deploying the Worker if you want the backfill and message-identifier cleanup in place immediately;
- the Worker still reads the legacy `blocked.fingerprint` column as a compatibility fallback during the transition.

### Server-side anonymous block resolution — 2026-07-30

This follow-up restores stronger anonymous blocking without returning to browser fingerprinting or exposing device identifiers to the owner UI.

- Added `0024_message_actor_identities.sql`.
- Added a server-only `message_actor_identities` table for anonymous message and DM senders.
- The chat block action now sends record context (`message_id` plus message kind) instead of trusting client-supplied device identifiers.
- The Worker resolves that record to the sender's anonymous `uid` plus an HMAC-hashed device block key and stores both in `blocked`.
- Block enforcement now checks both the hashed device key and legacy raw-device and fingerprint values during the transition.
- Scheduled maintenance now expires old actor-identity rows after ninety days.

Deployment notes:

- apply `0024` before deploying the Worker if you want message-based anonymous block resolution active immediately;
- older `blocked.device_id` rows may still contain pre-hash values until they are rewritten or naturally aged out.

### Guided support sessions and admin dashboard routing — 2026-07-30

This deployment line added the first guided support system and reshaped the super-admin dashboard around separate report and ticket flows.

- Added `0025_support_guided_sessions.sql`.
- Added `support_sessions`, `support_session_events`, `support_threads` and `support_messages`.
- Users now enter help and support from the dashboard help button instead of a persistent support inbox page.
- The user support flow starts as a chatbot-style decision tree with self-resolve steps and escalates to a human thread only when needed.
- The user side keeps no visible support history; once the super admin closes a ticket, it disappears from the user's dashboard and support panel.
- After a super-admin reply, the active support thread can surface as a temporary channel-like dashboard item for that user.
- The super-admin dashboard now exposes `Report` and `Tickets` labels: reports still open the private reports inbox channel, while support tickets appear as separate channel-like rows and open in `/support`.
- Support transcript ordering now sorts by `created_at ASC, rowid ASC` so a user's decision-tree choice appears before the next bot response.
- Later follow-up changes reused the existing signed anonymous/device identity path so guests can also use support without adding a new schema.
- That same follow-up keeps the guide accessible while a ticket is open, but blocks submitting another ticket until the active ticket is closed.
- A later follow-up also lets the user delete the temporary `1:1` support dashboard item, which closes the active support thread on the super-admin side instead of only hiding it locally.
- The super-admin ticket view now keeps the summary card as context but suppresses the duplicated seed user-message bubble when it only repeats that summary text.
- The dashboard's exact channel-address search now retriggers on blur, so closing the mobile keyboard still resolves `/ch/...` or full-link searches.

Deployment notes:

- apply `0025` before deploying the Worker code that reads or writes support sessions or tickets;
- deploy the Worker and the Next.js frontend together for this line because the route surface and dashboard entry points changed on both sides;
- no additional D1 migration is required for the later dashboard reshape, transcript-ordering fix, anonymous-support access, active-ticket UI guard, user-side ticket deletion, super-admin summary dedupe, or mobile address-lookup trigger beyond `0025`.

### Support operator hardening and triage metadata — 2026-07-30

This follow-up line hardened the guided support system for real operator use without turning it into a permanent user inbox.

- Added `0026_support_operator_hardening.sql`.
- Added `support_thread_reads` for per-thread read markers by user and platform admin.
- Added `support_audit_logs` for thread lifecycle events such as ticket creation, replies and user/admin closes.
- Support thread serialization now includes actor type, waiting side, last action, unread flags, stale level and open-duration minutes.
- The super-admin dashboard now exposes compact support stats for open count, needs-reply count, waiting-on-user count, unread count and stale buckets.
- The super-admin thread view now renders a structured triage header from the guided transcript: issue category, chosen path, first user free-text, actor type, last action and open duration.
- Opening a support thread now marks it read for the appropriate side, so unread/reply indicators behave like a temporary active conversation rather than a persistent inbox.

Deployment notes:

- apply `0026` before deploying the Worker code that reads `support_thread_reads` or writes `support_audit_logs`;
- deploy the Worker and the Next.js frontend together for this line because both the support payload shape and dashboard rendering changed;
- no extra migration is needed beyond `0026` for the admin triage card, unread badges, stale indicators or support operator summary chips shipped in the same line.

### Support dashboard load shaping and audit retention index — 2026-07-30

This follow-up line reduced support polling cost and fixed the missing retention-support index for support audit cleanup.

- Added `0027_support_audit_retention_index.sql`.
- Added `support_audit_logs(created_at DESC)` so scheduled support-audit cleanup no longer depends on table scans as audit volume grows.
- The user dashboard support preview now reads from a lightweight `/api/support?type=preview` response instead of loading full support messages and guided-session transcript data.
- The super-admin dashboard now loads all open tickets plus a bounded recent-closed window instead of reloading the full historical ticket list on each refresh.
- Hidden dashboard tabs and open support-thread views now skip background polling so the frontend does less unnecessary refresh work.
- Removed the unused platform-admin `type=threads` support list path from the current frontend/backend contract.

Deployment notes:

- apply `0027` before deploying the Worker if you want the support-audit retention cleanup index active immediately;
- deploy the Worker and the Next.js frontend together for this line because the support/dashboard fetch surface changed on both sides;
- the application still works without `0027`, but scheduled cleanup on `support_audit_logs` will stay less efficient until that migration is applied.

## D1 migration runbook

D1 migrations are ordered files in `worker/migrations`. Wrangler records applied migrations, so do not rename or edit a migration after it has reached production. Add a new numbered migration instead.

### Apply locally

```bash
cd worker
npm install
npm run db:migrate
```

### Apply to production

```bash
cd worker
npm run db:migrate:prod
```

For code that reads a new table or column, deploy in this order:

1. apply the production D1 migration;
2. deploy the Worker;
3. build and deploy the Next.js frontend.

This order keeps the old application compatible while the schema is changing and avoids runtime `no such table` or `no such column` failures.

### Current migration inventory

#### `0001_initial_schema.sql`

Creates the base multi-tenant schema:

- `channels`
- `messages`
- `blocked`
- `dm`
- `gallery`
- `config`
- `moderators`
- `messages_fts` and its synchronization triggers

It also creates the first channel, message, block and gallery indexes. Live sessions reuse this schema through a temporary `${channelId}_live` channel row.

#### `0002_banned_words.sql`

Adds per-channel banned words with optional expiry and a channel lookup index.

#### `0003_users.sql`

Adds registered users and the unique email index used for OAuth/account ownership.

#### `0004_user_password.sql`

Adds the nullable `users.password_hash` column.

This migration changes only the schema; it does not transform existing password values. Existing credential rows were originally stored as unsalted SHA-256. The current Worker recognizes that legacy format and attempts to replace it with salted PBKDF2 after successful verification. The production upgrade path still needs dedicated end-to-end monitoring and password-reset support.

#### `0005_hot_path_indexes.sql`

Adds indexes used by initialization and moderation:

- message reply/deletion lookup;
- blocked UID lookup;
- blocked fingerprint lookup;
- DM channel/time ordering.

These indexes increase write count slightly but prevent large row scans on common reads.

#### `0006_passcode_hint.sql`

Adds nullable `channels.passcode_hint`. The hint is display-only and must never contain the passcode itself.

#### `0007_user_recent_channels.sql`

Adds account-synced dashboard state:

- `(user_id, channel_id)` composite primary key;
- last visit timestamp;
- pinned state;
- the user's personal bubble color for that channel.

The table intentionally does not store passcodes or room tokens. Channel deletion explicitly removes matching recent records. Logged-in clients migrate existing browser recents in small batches; guest recents remain in browser storage.

The initial implementation returned 20 records. That application-level limit has since been removed; batching remains in place for migration and guest validation so D1 bound-parameter limits are not exceeded.

#### `0008_email_verification.sql`

Adds `users.email_verified_at`, verification tokens and hashed signup request records.

- Existing users are backfilled as verified so deployment does not lock them out.
- New credential accounts are created with `email_verified_at = NULL`.
- Raw email verification tokens are never stored; only their SHA-256 hashes are persisted.
- Tokens expire after 30 minutes and are invalidated after use or resend.
- Signup throttling stores hashed email/IP identifiers rather than raw IP addresses.
- Failed logins are throttled independently by hashed email and IP identifiers; nonexistent accounts still perform a dummy PBKDF2 verification to reduce timing-based enumeration.
- The Resend sandbox sends only to `EMAIL_TEST_RECIPIENT`.

Apply this migration before deploying the Worker version that reads `email_verified_at`.

#### `0009_channel_instance_id.sql`

Adds a random `channels.instance_id` and backfills existing channels. The client compares this value with its browser record so recreating a deleted channel at the same address does not inherit the previous channel's colors or other channel-scoped local state.

#### `0010_user_font_size.sql`

Adds nullable `users.font_size`. Logged-in users synchronize their preferred chat font size through the account; guest users continue to store it only in the current browser.

#### `0011_channel_profile_visibility.sql`

Adds `channels.show_on_profile` with a private (`0`) default. Owners may publish individual channels from channel settings. Public owner-channel lookup returns only explicitly published channels and the profile selector is enabled only when at least two channels are visible.

#### `0012_default_channels_private.sql`

Sets all existing non-live channels to private on owner profiles. This is intentionally separate from the column migration so the privacy default and existing-data policy remain explicit.

#### `0013_password_reset_tokens.sql`

Adds hashed, single-use password-reset tokens with expiry, use time and a user/time index.

- Raw reset tokens are delivered by email and never stored in D1.
- Requests return a generic success response to reduce account enumeration.
- Email and IP-based throttles reuse hashed request identifiers.
- Successful reset invalidates the token and stores a salted PBKDF2 password.

Apply `0013` before deploying the Worker routes that request or consume password-reset tokens.

#### `0014_channel_background.sql`

Adds channel-owned chat background settings:

- `background_type`: `default`, `color` or `image`;
- `background_color`: an optional six-digit hex color;
- `background_image`: an optional owner-uploaded R2 media URL;
- `background_overlay`: a `0`–`60` percent dark overlay used for readability;
- `background_blur`: an optional light blur applied only to the background image.

The background is limited to the scrollable chat field, while the header and
composer retain their translucent surfaces. The owner UI accepts JPEG, PNG and
WebP images up to 5 MB. It uploads only when the owner saves, and replacing or
resetting a saved background removes the previous R2 object. With blur disabled,
the original image is rendered unchanged apart from the independently selected
dark overlay. Apply `0014` before deploying Worker or frontend code that saves
these fields.

#### `0015_deleted_accounts.sql`

Adds a `deleted_accounts` tombstone table keyed by an HMAC of the normalized
email address.

- The table was introduced for a temporary "deleted accounts cannot be reused"
  policy.
- Current application code no longer enforces that policy, so the table is now
  legacy state and may remain empty or unused in new deployments.
- Do not rename or delete the migration file after production use; existing
  environments may already have it recorded in Wrangler's migration history.

#### `0016_upload_tickets.sql`

Adds durable upload tracking for chat and DM media:

- `upload_tickets` records the uploaded R2 key, target channel, uploader
  identity, IP hash, purpose and expiry.
- Pending message and DM uploads expire automatically and are deleted from R2
  on the next scheduled upload cleanup pass if they were never attached.
- Worker routes now use the table for per-channel durable upload quotas and to
  prove that a message or DM image was created by the same anonymous or owner
  identity that is attaching it.

Apply `0016` before deploying the Worker version that enforces upload tickets
for message or DM image attachments.

#### `0017_channel_reports.sql`

Adds durable channel-report storage with reporter identity signals:

- channel ID, reporter UID, optional authenticated reporter ID and optional device ID;
- structured reason and optional details;
- channel and reporter indexes for moderation lookup and duplicate detection.

#### `0018_channel_report_status.sql`

Extends `channel_reports` with moderation workflow state:

- `status`
- `resolution_note`
- `resolved_at`
- `inbox_message_id`

This migration supports the private reports inbox workflow and lets the Worker
sync an inbox message with the current report status.

#### `0019_channel_moderation.sql`

Adds owner-moderation state and petition storage:

- `channel_moderation` tracks warning, suspension and freeze state;
- `channel_petitions` stores owner appeals tied to a moderated channel.

This migration enables warning, freeze, petition review and explicit
unfreeze/reject flows without overloading the base `channels` table.

#### `0020_user_locale.sql`

Adds `users.locale` so account-backed UI can persist a preferred language
instead of relying only on browser-local detection.

#### `0021_hardening_controls.sql`

Adds the first dedicated hardening and observability tables:

- `durable_rate_limits` for D1-backed route throttles and quotas;
- `moderation_audit_logs` for append-only privileged-action history;
- `operational_events` for lightweight request-failure and abuse telemetry.

Apply `0021` before deploying Worker code that enforces durable rate limits or
writes moderation or operational logs.

#### `0022_query_perf_and_retention.sql`

Adds follow-up performance and retention-support indexes:

- `messages(channel_id, created_at, id)` for chat paging and history lookups;
- `messages(channel_id, deleted, reply_to)` for reply-visibility lookups on deleted parent messages;
- upload-ticket quota indexes aligned to the recent-count and pending-count queries;
- `moderation_audit_logs(created_at)` and `operational_events(created_at)` so scheduled retention cleanup does not degrade as those tables grow.

Apply `0022` before deploying Worker code if you want the new indexes in place
before the next traffic spike, though the code remains backward-compatible.

#### `0023_privacy_identity_cleanup.sql`

Adds a privacy-hardening transition for anonymous/device identifiers:

- introduces `blocked.device_id` and backfills it from the legacy column;
- creates the new `blocked(channel_id, device_id)` index;
- clears legacy message-level fingerprint values from `messages`.

This migration is intentionally additive rather than a hard rename so the
existing deployment order remains safe while the Worker code transitions away
from the legacy field names.

#### `0024_message_actor_identities.sql`

Adds a server-only actor-identity lookup table for anonymous moderation:

- `message_actor_identities` maps a message or DM row back to the sender's
  anonymous `uid` and hashed device block key without exposing those values to
  the browser;
- channel and created-time indexes support fast block resolution and bounded
  retention cleanup.

Apply `0024` before deploying Worker code that resolves anonymous block actions
from message or DM context.

#### `0025_support_guided_sessions.sql`

Adds the first guided support and escalated-ticket schema:

- `support_sessions` stores the current guided-flow state for a support actor;
- `support_session_events` stores the chatbot transcript, user choices and
  escalation path;
- `support_threads` stores escalated admin tickets and their lifecycle state;
- `support_messages` stores the human side of escalated support conversations.

Apply `0025` before deploying Worker code that serves guided support, ticket
listing or support messaging.

#### `0026_support_operator_hardening.sql`

Adds operator-facing support lifecycle and triage state:

- `support_thread_reads` for per-side unread markers;
- `support_audit_logs` for append-only support lifecycle events.

Apply `0026` before deploying Worker code that reads support unread state or
writes support audit entries.

#### `0027_support_audit_retention_index.sql`

Adds the missing retention-support index for support audit cleanup:

- `support_audit_logs(created_at DESC)`.

Apply `0027` before or with the Worker deploy if you want scheduled support
audit retention cleanup to avoid degrading into table scans as the log grows.

### Operational checks

After a migration:

```bash
cd worker
npx wrangler d1 migrations list letsplay-db --remote
```

Then verify:

- the Worker deploy completed successfully;
- the frontend production build passes;
- both owner and anonymous channel initialization still work;
- channel deletion cleans up rows introduced by newer migrations;
- no secrets or database exports are staged in Git.

### Media serve incident — 2026-07-29

Uploaded media reads briefly failed with Worker `500` responses even though the
required schema (`0014_channel_background.sql` and `0016_upload_tickets.sql`)
was already present in production.

Root cause:

- `handleMediaServe()` used one compound `UNION` query to resolve a media key
  against `messages`, `gallery`, `dm`, `channels.profile_image`,
  `channels.background_image` and `config`.
- Production D1 rejected that query shape with
  `D1_ERROR: too many terms in compound SELECT: SQLITE_ERROR`.
- The Worker fetch handler caught that exception and returned the generic
  `{"error":"internal_error"}` `500`.

Fix:

- Replace the compound lookup with ordered per-source lookups executed via one
  `env.DB.batch()` call in `worker/src/routes/upload.ts`.
- Keep the existing room-token, owner and upload-ticket checks unchanged.
- Deploy the Worker only; this fix does not require a new D1 migration or a
  frontend deployment.

If `/api/media/*` starts returning `500` again, confirm the cause with
`npx wrangler tail` before assuming the database is missing a migration.

### Media auth, preview isolation and passcode refresh — 2026-07-29

Follow-up hardening on the same deployment line changed three user-visible
paths without adding a new migration:

- Passcode-protected media now remains on the same-origin Next.js
  `/api/media/*` route. The browser no longer receives a room-access token in
  the media URL query string; the proxy forwards room access to the Worker in
  the `X-Room-Token` header instead.
- The preview Worker route now accepts only absolute `http:`/`https:` URLs,
  blocks obvious local/private/internal hostnames, follows redirects manually
  with per-hop validation, enforces a short timeout, requires HTML-compatible
  content and caps the body size before OG parsing. This initial route
  hardening later gained D1-backed durable caller rate limits on 2026-07-30.
- When room access is revoked or expires, the chat view now re-fetches the
  gated `init` payload before showing the passcode overlay. This ensures the
  latest `passcodeHint` appears immediately instead of only after a full page
  refresh.

Deployment notes:

- the preview-route hardening and media-read D1 fix are Worker deploys;
- the tokenless same-origin media proxy and passcode-hint refresh are frontend
  deploys;
- no new D1 migration is required for any of these changes.

### Passcode hardening and anonymous block persistence — 2026-07-29

This deployment line hardened two previously reviewed abuse paths without
adding a new D1 migration.

Passcode changes:

- New and rotated channel passcodes now store salted PBKDF2 verifiers instead
  of plain SHA-256 digests.
- Signed room tokens no longer embed `passcode_hash`, so a leaked token no
  longer exposes an offline-crackable verifier.
- Successful unlock of a legacy SHA-256-protected room upgrades that room to
  the PBKDF2 format in place.
- Existing room tokens issued before this change become invalid, so users may
  need to enter a room passcode once after deployment.

Anonymous blocking changes:

- Anonymous and device identity now live in HttpOnly cookies rather than
  browser-local storage readable by client JavaScript.
- Anonymous chat, DM, report and reaction writes now flow through same-origin
  Next.js proxy routes so the browser can send those cookies without exposing
  them to application code.
- Block persistence now uses a server-issued device token instead of a
  client-generated fingerprint or empty-string placeholder.
- Clearing localStorage alone no longer resets a blocked anonymous identity.
- Remaining limitation: clearing cookies or changing to a different
  browser/profile still creates a fresh anonymous identity.

Deployment notes:

- passcode hardening is a Worker deploy;
- anonymous block persistence requires both Worker and frontend deploys because
  anonymous write paths now proxy through Next.js;
- no new D1 migration is required for either change.

### Reporting, moderation, and guide UX updates — 2026-07-29

This deployment line extended the earlier moderation work without adding a new
D1 migration.

- Channel reports now submit through the same-origin frontend proxy, enforce
  server-side reporter identity and reject duplicate submissions for the same
  reporter/channel during a 24-hour cooldown.
- The private reports inbox now carries structured report messages with direct
  channel links and inline resolve, dismiss, freeze, unfreeze, delete and
  petition-review actions for the inbox owner.
- Frozen channel owners can submit one petition from chat, and rejected
  petitions now support an explicit unfreeze flow instead of leaving the
  channel stuck in moderation state.
- Viewer-facing moderation UI now only exposes a generic frozen-channel state;
  non-owners do not receive the moderation reason.
- The general user guide first moved into dashboard entry points, guest
  onboarding's final page can open the same guide, and the in-channel owner
  guide now documents report-handling and moderation states from the owner's
  perspective. Later support work consolidated the current logged-in help entry
  into the dashboard help button.

Deployment notes:

- channel-report enforcement and moderation actions are Worker deploys;
- report dialog, reports-channel rendering and guide entry-point changes are
  frontend deploys;
- no new D1 migration is required for these UX and policy updates.

---

# CSS → TSX Style Migration Notes

When porting styles from the vanilla CSS prototype to React/Tailwind components, these differences cause visual mismatches.

## Tailwind base styles inflate element height

Tailwind preflight sets a body line height and makes buttons inherit it. The original browser-button line height was closer to `1.2`, so equivalent Tailwind buttons can appear taller.

Use `lineHeight: 1` where padding, rather than text line height, defines the control height.

## Font-size inheritance

The prototype applied `var(--bubble-font-size, 17px)` globally. The Next.js version must either preserve that value on `body` or explicitly apply it to scalable components.

## Auto-sizing menus

Avoid an arbitrary `min-width` on short context menus. Korean labels are often compact and a forced width introduces excess whitespace.

## Scalable bubble padding

Dimensions that follow the user's font-size setting should use the shared variable:

```tsx
padding: "calc(var(--bubble-font-size) * 0.588) calc(var(--bubble-font-size) * 0.824)"
```

Media bubbles, embedded widgets and loading bubbles intentionally use their own wrappers. Text or edited labels inside a media bubble should receive text padding explicitly rather than changing the image dimensions.

## Port checklist

1. Preserve the existing icon geometry and stroke widths.
2. Set explicit line height for compact controls.
3. Avoid fixed minimum widths unless the reference UI uses one.
4. Use `calc(var(--bubble-font-size) * ratio)` for scalable dimensions.
5. Use shared color variables such as `--hairline`, `--meta`, `--gray-text` and `--bubble-sent`.
6. Test both Korean and English labels.
7. Test the smallest supported mobile width.
8. Check loading, empty, error and long-content states.

---

## Platform progress log

### Foundation — 2026-07-23

- Rebuilt the prototype with Next.js 16 and Tailwind.
- Added Cloudflare Worker, D1, R2 and a channel-scoped Durable Object.
- Added persistent messages, WebSocket broadcasts and presence.
- Added Auth.js, channel ownership, dashboard and onboarding.
- Added server-side message validation and owner-action proxies.

### Chat, media and live mode — 2026-07-24

- Added R2 uploads, gallery, DMs, reactions, reports and FTS5 search.
- Added multiple-image sending and media loading states.
- Originally added native X/Twitter and Instagram widgets plus link previews. Instagram remains native; X/Twitter now uses the lighter persistent metadata-card path documented above.
- Added temporary live channels, live presence, emoji presets and automatic cleanup.
- Replaced event-wide refetches with payload-based local patches for normal realtime events.
- Added cursor pagination and on-demand gallery/link loading.

### Security and performance hardening

- Restricted CORS and protected internal Worker routes.
- Prevented client-side admin spoofing.
- Added owner-authenticated WebSockets for private DMs.
- Added passcode-bound room tokens and brute-force limiting.
- Added upload validation, hot-path indexes and banned-word caching.
- Added immediate broadcasts for rules, blocking, petitions, DMs, freezes and notices.
- Split large chat rendering work into memoized message, embed and reaction components.

### Dashboard and account synchronization — 2026-07-25

- Made the iMessage-style dashboard the main entry point.
- Added owned/joined section labels, swipe actions, pinning, batch edit/delete and channel deletion dialogs.
- Added guest and first-owner onboarding dialogs.
- Moved login into a dashboard dialog and kept `/login` as a redirect entry point.
- Added exact channel-address lookup while limiting name search to owned/joined channels.
- Added account-synced recent channels, pin state and personal channel colors through `0007_user_recent_channels.sql`.
- Kept guest recent channels and colors browser-local and documented that behavior in onboarding.
- Removed the recent-channel count limit.
- Enforced a maximum of five owned channels per account in a conditional Worker insert.
- Added channel passcode hints and immediate dashboard/channel-setting refresh behavior.
- Made channel deletion remove all users' recent references and notify connected anonymous users.

### Authentication transition

- Added Resend sandbox email signup for one configured test recipient.
- Added a confirmation page that consumes tokens only after an explicit POST.
- Added 30-minute, single-use verification tokens and signup throttling.
- Kept all pre-migration users verified to prevent a deployment lockout.
- Kept Google OAuth as the supported signup path.
- Retained login support for existing credential accounts.
- Added a salted PBKDF2 format and legacy SHA-256 verification/upgrade code.
- Added dashboard-based password-reset request UI and localized reset pages.
- Added generic responses and hashed email/IP throttling for password-reset requests.
- Do not introduce a platform-wide administrator account for UI testing; use a scoped QA account and test channels.

### Channel identity, profiles and preferences

- Added channel incarnation IDs so a deleted address can be safely reused without inheriting stale browser settings.
- Added cropped profile-image upload; temporary `blob:` previews are never persisted as channel profile URLs.
- Made owner-profile channel visibility opt-in and private by default.
- Added account-synced font size for logged-in users while retaining browser-local guest preferences.
- Fixed system dark-mode changes so dashboard and channel UI follow them without requiring a reload.

### Date grouping and historical navigation

- Chat, gallery and link panels share one date parser for D1 UTC timestamps.
- Date boundaries use the viewer's browser timezone rather than fixed KST.
- Korean dates use `YYYY. M. D`; English dates use `Mon D, YYYY`.
- Gallery loads 50 image records per page; links load 30 link-bearing messages per page. Deleted source messages are filtered at the data boundary.
- Selecting an unloaded gallery/link source uses its message ID to fetch the target, 25 surrounding messages on each side and a distant reply parent when needed.
- Historical context is isolated from the latest-message window. Scrolling upward or downward loads 50 messages using `(created_at, id)` cursors, preventing collisions when multiple messages share a timestamp.
- Realtime messages received while reading history are counted rather than appended, preserving the reader's position. The **Latest messages** control reloads the newest window.

Trade-offs of historical context mode:

- Returning to latest requires one additional server request.
- The initial context request performs multiple bounded D1 reads: target lookup, older/newer windows and an optional reply-parent lookup.
- New realtime message contents are intentionally hidden until the user returns to latest; only the pending count is shown.
- Continued two-way scrolling grows the in-memory React message list in 50-message pages. It avoids unbounded request loops but does not virtualize an extremely long reading session.
- Failed access tokens, deleted targets and network errors cannot resolve the requested message.

### Moderation and hardening follow-through — 2026-07-29 to 2026-07-30

- Added same-origin channel-report submission, duplicate report cooldowns and a private reports inbox with inline moderation actions.
- Added owner freeze petitions plus explicit petition accept, reject and unfreeze flows.
- Added D1-backed durable quotas and rate limits for reports, messages, DMs and preview fetches.
- Added append-only moderation audit logs and operational event capture for abuse and failure signals.
- Added explicit Worker security headers and focused hardening tests.
- Polished recent chat UI details including floating notice banner sizing and text padding for mixed text-plus-widget bubbles.

### Security audit — 2026-07-26

This audit started as a list of open findings. Status notes below were updated
after the 2026-07-29 and 2026-07-30 hardening work so the remaining gaps are
clear.

#### P0 — signed anonymous identity and block persistence

This item is no longer open.

- Anonymous write paths now derive identity from Worker-issued tokens rather
  than trusting client-supplied `uid`.
- The newer implementation stores anonymous and device identity in HttpOnly
  cookies and forwards them only through same-origin Next.js proxy routes.
- Clearing localStorage alone no longer bypasses owner blocks, and reaction
  writes now enforce the same block boundary.

Remaining limitation:

- Clearing cookies or switching to a different browser/profile still creates a
  fresh anonymous identity. Fingerprints and IP HMACs may supplement abuse
  review, but they still must not be treated as proof of ownership.

#### P1 — upload and media lifecycle

Most of this item was implemented on 2026-07-29:

- Public chat and DM uploads now require signed anonymous or owner identity,
  durable per-channel quotas and a matching upload ticket.
- Pending uploads are tracked durably and cleaned up if they expire unattached.
- Message, DM, live-cleanup and channel-deletion paths remove their attached R2
  objects.
- Passcode-room media is now served through an authenticated same-origin proxy
  rather than a permanent public URL carrying the room token.

Remaining gap:

- File validation should continue moving toward stricter decoded-type checks so
  hostile polyglot uploads do not rely only on request metadata or optimistic
  image handling.

#### P1 — server-side messaging policy

Most of this item is now implemented:

- DM submission reads the parent channel's DM toggle and rejects disabled
  submissions.
- DM and edit routes enforce length, block, banned-word and freeze policy at
  the Worker boundary.
- Message and DM image fields must resolve to a valid upload-ticket-backed
  object for the same channel and identity.

Remaining gap:

- Channel reports now enforce server-side reporter identity, same-channel
  duplicate prevention, a 24-hour cooldown and a durable daily quota.
- Remaining work is broader cross-channel abuse throttling and direct-API
  regression coverage around report policy.

#### P1 — preview fetch isolation

The preview endpoint must:

- accept only absolute `http:` and `https:` URLs;
- reject credentials, localhost, loopback, link-local, private and internal
  destinations;
- resolve DNS and repeat destination checks after every redirect;
- use a short timeout and bounded redirect count;
- stop reading after a small HTML response limit;
- require an HTML-compatible content type;
- apply durable caller/IP rate limits and cache successful results.

The first six controls above were implemented on 2026-07-29, and durable
caller rate limiting was added on 2026-07-30. Remaining gaps:

- destination blocking is still hostname-based and does not perform
  independent DNS or post-resolution private-IP validation;
- successful results should continue to stay tightly bounded and cached only
  within the intended preview policy.

An allowlist for supported native providers is still safer than unrestricted
arbitrary-site previewing.

#### P2 — headers and dependencies

Most response-header work is now in place:

- the Next.js app already defines a broader header policy;
- the Worker now also applies `nosniff`, Referrer Policy, Permissions Policy,
  frame restrictions and HSTS on HTTPS responses.

Remaining work:

- keep CSP coverage tested against the Twitter and Instagram widget domains;
- continue dependency upgrades without using forced audit downgrades.

The production dependency audit reported:

- three high findings and one moderate finding;
- Next.js `16.2.11`;
- nested PostCSS `8.4.31`;
- Sharp `0.34.5`;
- a transitive NextAuth report through Next.js.

At audit time npm reported Next.js `16.2.12`, PostCSS `8.5.23` and Sharp
`0.35.3` as current releases. Do not accept the audit tool's incompatible
Next.js `9.3.3` force-fix. Upgrade through normal dependency changes, verify
Next compatibility with fixed transitive versions, run a production build and
repeat `npm audit --omit=dev`.

#### Remediation order and verification

1. Broader abuse throttling and direct-API tests with the UI bypassed.
2. Stronger preview-destination validation plus redirect and oversized-body fixtures.
3. Dependency upgrades, followed by widget tests.

Every remediation should be deployed Worker-first when the frontend depends on
new enforcement or token issuance. Keep backward compatibility bounded and
remove it after clients have updated.

### Operational metrics and retention policy

This section defines the minimum observability and data-lifecycle policy to
implement before public launch. Operational metrics should answer whether the
service is healthy without recording private chat content.

#### Core operational metrics

Record counters, latency distributions and failures by route and deployed
version:

- request count and success, `4xx`, `429` and `5xx` rates;
- average and p95 response latency;
- message send success/failure and server rejection reason;
- upload count, bytes, success/failure and pending-object count;
- email delivery request, provider success/failure, verification completion
  and expired-token count;
- WebSocket open, authenticated, rejected, closed and reconnect count;
- active authorized connections and channel live-viewer count;
- D1 query error and slow-operation count;
- R2 stored bytes, delivered bytes, deleted objects and cleanup failures;
- login failure, room-token failure, blocked request, report submission and
  rate-limit count.

Start with service-wide and route-level dimensions. Channel/user dimensions
must use an HMAC-pseudonymous identifier and should be added only when they are
needed for abuse investigation. Do not create unbounded metric labels from raw
channel IDs, UIDs, URLs or error messages.

Average latency alone is insufficient. Track p95 latency so a smaller group of
very slow requests remains visible. Each log or metric event should include a
request ID, timestamp, route, status/error code, duration and deployed version
where available.

#### Log privacy rules

Logs must never contain:

- message, DM, petition or report description text;
- passwords or password hashes;
- room, email-verification, reset or admin WebSocket tokens;
- `INTERNAL_SECRET`, Resend keys, OAuth secrets or cookies;
- full request headers or bodies;
- raw email addresses, IP addresses, fingerprints or user-agent-derived
  fingerprints;
- arbitrary link-preview response bodies.

When correlation is necessary, use a purpose-specific HMAC secret and store
only the resulting pseudonymous ID. Hashing a low-entropy value such as an
email or IP without a secret is not sufficient protection against guessing.

#### Initial alert thresholds

Begin with a small set of actionable alerts:

- `5xx` rate above 3% for five minutes;
- five consecutive email-provider failures;
- any repeated D1 migration or query failure;
- upload bytes or object count materially above the recent baseline;
- sudden WebSocket authentication/reconnect growth;
- repeated owner-authorization failures;
- cleanup backlog or R2 deletion failures older than 24 hours.

Thresholds must be tuned after real traffic is observed. Avoid alerts for
normal `403` and `404` traffic unless their rate changes sharply.

#### Recommended retention matrix

| Data | Recommended initial retention | Deletion behavior |
| --- | --- | --- |
| Normal messages | While the channel exists | User/admin deletion removes content and R2 media immediately; retain only a minimal reply placeholder when required |
| Live messages and DMs | Until the live session ends | Delete messages, DMs, gallery rows, config and R2 objects at session end; retry partial failures |
| Normal-channel DMs | 90 days | Delete automatically in bounded batches; allow earlier owner deletion |
| Pending/unattached uploads | 1 hour | Delete R2 object if no message or DM attachment was committed |
| Deleted-message media | No retention | Delete the R2 object during the same logical deletion workflow |
| Open reports | Until resolved | Retain the minimum evidence required for review |
| Resolved reports | 90–180 days | Remove or anonymize after the policy window; preserve only legally required audit data |
| Email verification tokens | Expiry plus at most 7 days | Tokens are unusable immediately after use/expiry; delete hashed records in cleanup |
| Password-reset tokens | Expiry plus at most 7 days | Invalidate immediately after use; delete expired/used hashed records |
| Signup/login rate-limit records | 7 days initially | Delete records outside every enforcement and investigation window |
| Channel block records | Until unblock or channel deletion | Remove with the channel; never reuse across channels |
| Normal request logs | 30 days | Aggregate first where possible, then delete raw events |
| Error logs | 90 days | Remove private payloads before storage |
| Platform-admin audit logs | At least 1 year, subject to policy review | Append-only, access-controlled and excluded from ordinary application deletion |

These are initial product recommendations rather than legal advice. Before
launch in additional jurisdictions, align user-facing policy, legal
requirements and actual deletion behavior.

#### Minimal deleted-message placeholder

When replies require the parent row to remain, immediately remove:

- original text and image URL;
- gallery record and R2 object;
- nickname, fingerprint and other unnecessary sender metadata.

Keep only the message ID, channel/reply relationship, deletion state and the
minimum timestamp required to render the thread. Delete the placeholder after
its final visible reply is removed if no other integrity rule requires it.

#### Pending upload lifecycle

The current direct-to-R2 model needs an explicit attachment lifecycle:

```text
upload ticket issued
  → R2 object stored as pending
  → message/DM transaction attaches the object
  → object becomes active

pending for more than 1 hour
  → cleanup job deletes R2 object and pending record
```

A ticket should be short-lived and bound to the signed actor, channel, allowed
content type and maximum size. A message may attach only a valid pending object
for the same actor and channel.

#### Scheduled cleanup

Use a Cloudflare Cron Trigger, initially once per day, to process:

- expired and used email-verification tokens;
- expired and used password-reset tokens;
- old authentication/rate-limit request records;
- DMs beyond the retention window;
- expired pending uploads;
- queued R2 deletions;
- expired operational logs and resolved-report records.

Never issue an unbounded delete. Select a bounded batch of IDs (for example
100–500), delete it, record the result and continue on the next run or within a
strict execution budget. Before enabling deletion in production, run a
read-only dry run that reports candidate counts and oldest/newest timestamps.

#### Reliable cross-store deletion

D1 and R2 cannot be modified in one atomic transaction. Use a retryable cleanup
queue rather than assuming both operations always succeed:

```text
cleanup_jobs
- id
- type
- target_key
- status
- attempts
- next_attempt_at
- created_at
- completed_at
```

For media deletion:

1. mark the application record deleted or inaccessible;
2. enqueue the exact R2 key;
3. attempt R2 deletion;
4. mark the cleanup job complete;
5. retry failures with bounded exponential backoff;
6. alert when attempts or age exceed the operational threshold.

The deletion operation must be idempotent: an already-missing D1 row or R2
object counts as success.

#### Account deletion policy

Before exposing account deletion, define and test:

- whether owned channels are deleted or transferred;
- whether authored messages are deleted or anonymized;
- removal of account recents, personal colors and font preferences;
- removal of email, credential, verification and reset records;
- treatment of reports and platform audit records under a documented
  retention exception;
- the maximum time until backups and derived logs no longer contain the data.

Show the user the consequence before confirmation and require recent
authentication for destructive account deletion.

#### Rollout phases

1. Add structured error codes, request IDs and deployed-version fields.
2. Record core API, upload, email, WebSocket, D1 and R2 metrics without content.
3. Add dashboards and the small initial alert set.
4. Add pending-upload state and reliable cleanup jobs.
5. Run retention dry reports and compare candidate records with product policy.
6. Enable token/rate-record cleanup first.
7. Enable pending-media and deleted-media cleanup with retries.
8. Enable DM, report and log retention only after restore and audit checks.

Trade-offs:

- metrics and logs introduce storage and processing cost;
- overly detailed labels or logs create a new privacy risk;
- short retention may impede incident or report investigation;
- long retention increases cost and breach impact;
- cleanup bugs can delete required data, so dry runs, bounded batches,
  idempotency and retry visibility are mandatory;
- aggressive alert thresholds create alert fatigue.

## Current follow-up work

- remove legacy transition origins after rollback readiness and complete nonce-based CSP hardening;
- add focused regression coverage for chat history/reply behavior and support, reports and dashboard state transitions;
- calibrate production health baselines before adding external alert delivery;
- monitor production Resend delivery and the legacy-password upgrade path;
- move cross-store deletion and retention toward bounded, observable and retryable workflows;
- use the new dashboard timing entries before pursuing precomputed channel activity or another broad performance redesign;
- continue mobile and accessibility testing for widgets, dialogs, support flows and dashboard gestures.

The authoritative remaining-work list is maintained in [FUTURE_PLANS.md](./FUTURE_PLANS.md).
