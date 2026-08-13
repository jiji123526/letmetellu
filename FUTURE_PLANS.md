# Future Plans

This file tracks remaining product and platform work. Implemented behavior and deployment history belong in [MIGRATION_NOTES.md](./MIGRATION_NOTES.md).

## Recommended Order

If the goal is to ship safely, the next work should stay focused on hardening and operations rather than new surface area.

1. Remove transition origins after rollback readiness, then complete the nonce-based CSP hardening sequence.
2. Complete deployed browser regression checks for support, report and media-access revocation transitions; cross-tab auth transitions are verified.
3. Calibrate the existing operational-health view from production baselines, then add alert delivery and response procedures.
4. Add explicit monitoring for production email and legacy credential-upgrade paths.
5. Extend the production-verified retryable channel-cleanup foundation only to remaining cross-store retention workflows that need it.
6. Expand durable abuse controls beyond the current first pass.
7. Use the new dashboard startup measurements to decide whether any larger derived-activity redesign is justified.

## Remaining Ship Work

### Custom domain cutover

- The apex deployment, HTTPS security headers, permanent `www` redirect, provider-specific Google callbacks and production authentication/realtime smoke tests are complete for limited beta.
- Retain the matching legacy Vercel OAuth callbacks only during rollback readiness.
- After smoke tests and rollback readiness are complete, narrow production Worker CORS to `https://yapndot.com`. Remove the legacy Vercel hostname, remove `www` after its permanent apex redirect is confirmed, and move localhost to development-only Wrangler configuration.
- Plan a separate CSP hardening change to remove `script-src 'unsafe-inline'`. Treat the current setting as an accepted limited-beta defense-in-depth gap, not as evidence of a known exploitable XSS. First replace the inline theme bootstrap with request-scoped nonce handling, remove the generic arbitrary-HTML contract from `ConfirmDialog`, and preserve only the exact external origins required by active runtime integrations.
- Roll out the stricter CSP in report-only or focused preview validation first, then verify dark-mode startup, authentication, dashboard, chat, dialogs, X/Twitter and Instagram widgets, and the final production response headers before enforcement. Do not remove `'unsafe-inline'` as a header-only change.

### Abuse controls

- Expand durable rate limits to broader cross-channel abuse patterns, not just per-route throttles.
- Add stronger report-target and evidence validation for direct API callers.
- Add a separate low-cost upload-attempt limiter only if metrics show repeated authorized requests failing before ticket creation; do not lower successful-upload quotas preemptively.
- Consider full image decoding or malware scanning only if production abuse or a future image-processing pipeline justifies the additional CPU and implementation cost.
- If the platform later exposes safe DNS or IP verification primitives, strengthen preview destination validation beyond hostname rules.

### Rewarded media credits

- If the product adds "watch an ad to unlock 5 media sends", treat it as a server-enforced media-credit system rather than a frontend-only toggle.
- Define the unit clearly before implementation. The safest definition is `5` image attachments, not `5` message composer opens or one-time upload permission.
- Persist credits durably in D1 against the signed actor identity used for chat writes: authenticated user ID when logged in, otherwise the anonymous UID plus device-bound identity path already used by chat enforcement.
- Verify rewarded-ad completion on the server before granting credits. Do not trust a client callback alone, and do not ship the feature until a web-capable rewarded-ad provider and verification flow are confirmed.
- Enforce credit consumption in the Worker when a message or DM image attachment is successfully committed, not only when a blob upload starts. Uploads can fail or remain unattached, while message and DM attachment already pass through durable upload-ticket validation.
- Start with normal channel messages only. Leave DMs, live chat and any moderation/report-only channels out of scope until the base reward and deduction path is stable.
- Add explicit product limits before launch: stacking policy, expiry window, daily cap, behavior when a queued multi-image send exceeds remaining credits, and whether failed sends should refund the unused credit.
- Add audit and monitoring for reward grants, reward verification failures, credit consumption, suspicious repeat claims and upload/send mismatch rates before exposing the feature broadly.

### Monitoring and alerts

- Establish normal production baselines for the existing super-admin health card, then calibrate its `5xx`, exception and `429` thresholds.
- Track WebSocket disconnect, reconnect-attempt and authorization-failure counts so the jittered exponential reconnect policy can be calibrated from production recovery behavior. Init presence fallbacks are now recorded as `realtime_unavailable`; use them to distinguish provider resets from ordinary client disconnects.
- Add external alert delivery for degraded or critical health only after threshold calibration, with a documented operator response and escalation path.
- Add bounded summaries for moderation action volume, report volume, petition outcomes and support queue age; the underlying audit records already exist, but these trends are not yet presented.
- Add explicit operational-event coverage for upload failures, preview failures and WebSocket authorization/origin failures.
- Add explicit monitoring for email verification, password reset and legacy password-hash upgrade behavior.
- Measure `/api/user`, platform-support dashboard and support-thread latency before pursuing another query redesign.
- Track scheduled-maintenance duration and per-table deletion counts. Channel cleanup now records R2/Durable Object stage failures and recoveries, but broader scheduled retention still needs equivalent visibility.

#### 2026-08-12 error-analytics follow-up

- If the platform later adds bounded edge-log ingestion, surface client-cancelled `499` traffic as a separate low-priority signal rather than folding it into core backend health. Worker-side media `404` visibility is already covered by the current operational-health card.

### Measured performance follow-up

- The current post-Phase-1 frontend measurement from writable webpack builds is still heavy for the simplest routes: `/` at about `526 KB`, `/support` at about `638 KB`, `/privacy` and `/terms` at about `535 KB`, `/dashboard` at about `718 KB`, and `/ch/[slug]` at about `848 KB` of first-load uncompressed JS.
- The most recent API split reduced `/support` by about `16 KB`, `/dashboard` by about `16 KB`, and `/ch/[slug]` by about `14 KB` compared with the previous `c2f272b` build, while `/` and the already-optimized legal pages stayed effectively flat.
- Treat that route-bundle snapshot, plus request counts for dashboard refresh and chat reconnect paths, as the baseline for the next optimization pass. Re-measure after each phase instead of stacking another broad rewrite.
- Start with bundle and request-churn reductions that do not require a schema migration. Keep larger derived-data redesigns conditional on measured backend hotspots that remain after the cheaper changes ship.

#### Phase 1: global bundle reduction

- Completed on 2026-08-05: the root layout no longer mounts the full provider shell for every route, `/privacy` plus `/terms` now render on the server from request locale, and the old `src/lib/api.ts` monolith is split by domain with mock-only helpers lazy-loaded behind dynamic imports.
- Phase 1 is complete. The remaining route-bundle problem is now concentrated in the interactive chat, support and dashboard shells rather than in global providers or mixed-domain API code.

#### Phase 2: dashboard refresh consolidation

- Completed on 2026-08-05: replaced the overlapping dashboard timers plus focus and visibility listeners with one stale-time-aware foreground polling path.
- The consolidated scheduler retains in-flight dedupe and independently enforces 30-second admin-dashboard, 60-second support-preview and five-minute operational-health freshness windows.
- Follow-up validation fixed two edge cases before merge: request locale now reaches the document-level `lang`, and support-preview polling remains active from an empty state so another tab or device can create a ticket that this dashboard later discovers.
- Startup timing is now measurable through local `letmetellu:dashboard:*` Performance API entries. Remaining validation is to collect representative production baselines for request fan-out and usable-state timing.
- The 2026-08-07 startup follow-up parallelized required reads, moved normal-user support preview loading off the blocking path, folded platform-admin role into `/api/user`, restored a bounded 24-hour recent-channel snapshot and added a geometry-matched skeleton.
- Keep the custom support-ticket event as an explicit forced refresh for known mutations rather than treating it as polling.

#### Phase 3: chat init and reconnect shaping

- The first reconnect-shaping slice is complete: initial WebSocket authorization is no longer treated as a reconnect, so it does not repeat the page bootstrap reads. A true reconnect now performs one recovery request instead of independently fetching messages and channel init state.
- Normal viewers merge the message snapshot carried by their reconnect init without leaving contextual-history mode; owners retain a full recovery init, and the legacy manual-admin path keeps a message-only refresh.
- Keep full init for passcode/access changes and live-session transitions until narrower responses carry every authorization, moderation and live-state field those paths require.
- Completed on 2026-08-07: `/api/ws-token` now uses a narrow Worker socket-auth endpoint instead of calling full `/api/init` on every socket open or reconnect just to decide admin, reports-owner or room-viewer auth mode.
- Completed on 2026-08-07: owner-channel popup reads now flow through the existing same-origin `/api/user` proxy instead of fetching the Worker directly from the browser, so preview and production share one request path and avoid CORS-specific behavior.
- Completed on 2026-08-07: reply-parent recovery now uses a narrow batched parent lookup and merges each resolved batch in one pass instead of issuing one `message-context` request and one full message-window re-sort per missing parent.
- Production measurement on 2026-08-13 showed the non-recursive `requested_roots` CTE still reading roughly `2.7k-3.6k` rows per returned row, with its largest fingerprint reaching `212.62M` rows read. It has been replaced by batched primary-key root reads and indexed direct-child reads.
- Completed on 2026-08-13: page expansion now reuses root messages already present in the current page and queries only missing roots. The indexed child query still covers every requested root so complete reply groups are preserved. This removes at most roughly 50 inexpensive primary-key reads per page and is an incremental saving rather than another major query-shape change.
- Flat reply rollout phases 1–4 remain complete: new replies store the top-level `reply_to`, the production audit found all 747 existing replies already flat, and normal message paging expands indexed roots and direct children without recursive thread expansion. `message-context` uses a bounded recursive lookup only to resolve legacy nested targets to their true root, then expands the selected root window through the same indexed direct-child path. The product intentionally does not retain the originally clicked child reply.
- Completed and production-verified on 2026-08-13: migration `0037_message_root_pagination.sql` supports root-owned chronological paging. A page now selects parent messages first and expands each complete reply group, so late replies cannot consume adjacent parent slots or pull old threads into the latest window. Client trimming, reconnect merging and realtime insertion follow the same parent-owned boundary.
- The migration and functional checks through `0037` are complete. Continue using D1 Insights to compare the root and indexed-child fingerprints against the former `requested_roots` baseline before considering a persisted `thread_root_id`; that larger schema change is not currently justified.
- Completed on 2026-08-07: browser-local diagnostics now record chat bootstrap, reconnect and visibility-resume request counts plus settle time, and the dashboard trace now records per-request counts and durations, including repeated `/api/user` bootstrap reads across a session.
- The owner-channel-count lookup is already keyed only to channel identity and profile-visibility changes, while the owner-channel popup fetches on demand. Do not broaden either dependency set during later refactors.
- Keep the current correctness bias for passcode, moderation and live-state transitions, but separate "must refetch full init" cases from "message snapshot or targeted field refresh is enough" cases.
- Remaining Phase 3 validation is to collect representative baselines from those local diagnostics before calling the phase complete.

#### Later message-query optimizations

- Completed on 2026-08-13: root and child `IN (?, ...)` lookups now use eight bounded query sizes (`1`, `2`, `4`, `8`, `16`, `32`, `50`, `64`) instead of potentially producing a separate D1 Insights fingerprint for every page size. The `64` bucket covers the 51-root context window while staying below D1's variable limit. Repeating the final ID as padding is result-neutral; this improves observability but does not inherently reduce rows read or execution cost.
- Initial index audit completed on 2026-08-13: `messages_channel_idx(channel_id, created_at)` remains the only clear removal candidate because `messages_channel_created_id_idx(channel_id, created_at, id)` has the same leading columns. The two reply indexes intentionally use opposite column orders, the deleted/created index serves latest-visible reads, the new root/created index serves migration `0037` pagination, and the partial client-message index enforces idempotency. Run `worker/scripts/audit-message-indexes.sql` against representative production traffic before creating any removal migration; no existing index was dropped.
- Request-path audit completed on 2026-08-13: `/api/init` already coalesces same-channel in-flight reads, and scroll loading has a synchronous hook-level guard. Identical in-flight message-page reads now also coalesce by channel, direction and exact cursor as a defensive second boundary. Completed requests are never cached, and latest-message synchronization remains independent so a realtime event cannot reuse a potentially older snapshot. Continue checking browser diagnostics and edge analytics for request churn after deployment.

#### Phase 4: support dashboard query tuning

- The first measured query-tuning slice is complete: read markers now use direct primary-key joins, and composite indexes cover status pagination, latest-message ordering and sender-role timestamp lookups. A 1,000-ticket/20,000-message local fixture measured about 54-56% lower query time across repeated 250-read runs.
- A page-first windowed message rollup was evaluated but rejected after representative local SQLite benchmarks ran materially slower than indexed point lookups. Keep the measured point-lookup shape unless production data demonstrates a different crossover.
- Compare production platform-support latency after rollout before considering denormalized per-thread summaries.
- Keep the existing dashboard behavior stable while tuning query shape first; do not jump to a broader support schema redesign unless latency remains materially high after query and index work.
- Re-check operational-health summaries and platform-support latency after rollout so the next backend bottleneck is identified from measurement rather than assumption.

#### Phase 5: conditional derived activity redesign

- If `/api/user` still remains a proven hotspot after the earlier frontend, polling and support-query work, continue with the precomputed channel-activity plan below.
- Do not skip directly to derived channel activity while the cheaper bundle, refresh-policy and query-shape reductions are still available.

### Cleanup and deletion reliability

- Completed first phase on 2026-08-12: channel deletion atomically records a media snapshot and cleanup job with the D1 deletion, then tracks and retries Durable Object invalidation and R2 removal independently. Account deletion reuses this path for owned channels.
- Production verification is complete after migration `0036`: D1 channel deletion, R2 media removal, cleanup-job completion and operational-health failure visibility were checked end to end.
- Use observed retry age and attempt counts to set an operator threshold for cleanup jobs that remain pending beyond the normal recovery window.
- Extend the job model only where another cross-store workflow has the same partial-failure risk; do not turn ordinary single-store D1 retention into unnecessary queue work.
- Existing scheduled retention covers operational events, moderation/support audit logs, message actor identities, rate-limit rows and expired upload tickets. Define policy for closed support sessions and tickets, reports, petitions and visit-survey responses before extending automated cleanup to those product records.
- Add dry-run counts, bounded batches and failure monitoring before expanding destructive scheduled maintenance.
- The 2026-08-04 pre-beta cleanup removed seven legacy credential test accounts, their four owned channels and six additional orphan channels through an exact-ID, precondition-checked one-time maintenance run. The temporary route was removed immediately afterward; all Google accounts, the platform `reports` channel, `whaaa` and the new verified credential account were confirmed preserved.

### Precomputed channel activity

- The highest-upside remaining dashboard performance change is to stop deriving owned-channel activity from `messages` and live-config rows on every `/api/user` read.
- The intermediate 2026-08-05 optimization added an indexed latest-visible-message lookup, replacing the full per-owner message aggregation. Measure that rollout before pursuing this larger redesign.
- The 2026-08-07 dashboard startup pass removed serial client waits and the separate role probe. Use its `letmetellu:dashboard:*` measurements to distinguish frontend wait time from `/api/user` database time before changing the schema.
- Do not start this migration until latency and D1 query measurements show that the optimized `/api/user` query is still a material bottleneck.
- The likely shape is a dedicated `channel_activity` table keyed by `channel_id`, or equivalent derived fields on `channels`, that stores precomputed `last_activity_at`, `last_message_at`, and live-state fields.
- This should be treated as a data-consistency project, not a small hot-path tweak. All message creation, latest-message deletion/moderation, live start, live end, live expiry, channel creation, and channel deletion paths would need to keep the derived state correct.
- Prefer a separate table over immediately extending `channels` so rollout, backfill, dual-write, and shadow comparison are easier to control.
- Safe rollout order: add schema, backfill from existing `messages` and live config, dual-write on mutations, compare derived reads against the current read-time query, switch `/api/user` to the precomputed source, then remove the old aggregation path after confidence is high.
- The main risk is stale or incorrect dashboard ordering or live badges if any write path misses an update, so this should only be done with focused regression coverage and temporary comparison logging.

### Frontend maintainability

- Add targeted regression coverage around message selectors, action rules, history navigation, realtime synchronization and the extracted layer-stack contracts before further structural changes.
- The next maintainability candidate is reducing the state/orchestration surface in `src/app/dashboard/page.tsx`, especially if the Phase 2 polling consolidation still leaves that page effect-heavy.
- Reduce `ContextMenu` and overlay prop surfaces only when a concrete feature or testability problem justifies it.
- Continue mobile and accessibility testing for widgets, dialogs, support flows and dashboard gestures before adding another large chat UI surface.

### Email and account hardening

- Monitor Resend delivery, bounce and failure behavior during beta.
- Rehearse signup verification and password reset with a non-owner mailbox from the canonical production domain.
- Validate the legacy SHA-256 to PBKDF2 upgrade path end to end in production-like conditions.
- The beta dependency pass is currently clean under both production-only and full `npm audit`; repeat the audit before broader releases and continue normal upgrades without `npm audit fix --force`.

## Channel Request Inbox

Add a separate request inbox, modeled on Spin-Spin's receive, answer and publish flow, instead of turning owner-only DMs into ordinary channel replies.

### Product shape

- Treat each incoming DM as an inbox request with its own lifecycle: unread, opened, answered and archived.
- Keep the original request and owner answer together in a dedicated thread rather than mixing the answer into the channel message tree.
- Add an owner-only `/ch/[channel]/inbox` surface and, if public answers are enabled, a separate `/ch/[channel]/answers` archive.
- Start with one owner answer per request. Add multi-message conversations only if real usage demonstrates that they are needed.
- Let the owner explicitly choose whether an answer remains private or is published. Private should be the safe default unless product policy establishes clear sender expectations otherwise.

### Privacy and identity constraints

- Do not auto-publish existing DMs. Current product copy promises owner-only visibility, so public reuse requires explicit sender consent and clear submission-time disclosure.
- Keep anonymous private-answer access bound to the same signed browser identity used for submission. Require login for reliable cross-device access and recovery.
- Do not expose raw request IDs as authorization. Every sender and owner read must be authorized by the existing signed actor or authenticated ownership boundary.
- Define retention, deletion, blocking and moderation behavior before launch, including what happens to published answers when the source request or channel is deleted.

### Proposed storage

- Add `channel_inbox_threads` for channel, sender identity, lifecycle state, visibility, consent and timestamps.
- Add `channel_inbox_messages` for the original request and owner answer while retaining sender role and attachment metadata.
- Add `channel_inbox_reads` only when sender-side history or notifications require durable unread state.
- Preserve existing DMs as legacy private records initially. Migrate them into unanswered inbox requests only through an explicit, reversible migration after privacy behavior is finalized.

### Delivery phases

1. Build the owner-only inbox around new incoming requests while preserving the current DM path during rollout.
2. Add one-answer private responses and sender-side retrieval bound to signed identity.
3. Add explicit sender consent and owner-selected public publishing with a separate answered archive.
4. Add sender history, notifications and multi-message threading only if the MVP demonstrates demand.
5. Evaluate migration of legacy DMs after retention, consent and rollback behavior have been tested.

## Notice Comments

Add a separate flat comment section for channel notices, but treat it as its own lightweight discussion surface rather than extending the current notice string/blob format.

### Product shape

- Keep the existing floating notice banner as the summary surface and place comments in the expanded notice panel or a dedicated notice-detail view instead of inside the small banner itself.
- Start with flat text-only comments: no replies, no reactions, no attachments and no cross-channel notification system.
- Bind comments to a specific notice version or notice id so clearing or replacing a notice resets the discussion cleanly instead of carrying unrelated history forward.
- Show owner controls to delete comments and, if needed, lock further notice comments without deleting the notice itself.

### Data and authorization constraints

- Do not store comments inside the existing `config.notice_*` text payload. Use separate rows such as `channel_notice_comments` keyed by channel plus notice version/id.
- Reuse the existing signed anonymous/device identity model and authenticated ownership checks. Do not authorize reads or deletes from raw comment ids alone.
- Apply the same moderation expectations as chat and DMs: rate limits, blocked-user enforcement, deletion behavior and protected identity handling where appropriate.
- Define what happens when a notice is edited, deleted, or replaced before launch. The cleanest MVP is usually "new notice, new comment thread."

### MVP delivery shape

1. Add notice ids or versions plus a dedicated comments table.
2. Add owner/viewer read APIs and text-only comment creation/deletion.
3. Render the list in the notice panel with simple pagination or a bounded recent window.
4. Add realtime updates only if polling or refresh-on-open is not sufficient for the first release.
5. Reevaluate replies, reactions, unread state and alerts only after actual usage shows they are needed.

## Guided Support Follow-up

The implemented guided-support and operator-dashboard shape is recorded in [MIGRATION_NOTES.md](./MIGRATION_NOTES.md). Remaining work:

- Add focused regression tests for guided-session reset, active-ticket visibility, report filters and dashboard sync between user and super-admin views.
- Expand the decision tree coverage for real user issues and keep all new user-facing support copy in the centralized locale files rather than growing inline logic again.
- Add operator macros or close-reason presets for common support replies once the current flow stabilizes.
- Add explicit pagination or archive filtering for older closed tickets if the operator audit workflow outgrows the current recent-closed window.
- Decide whether support audit logs need an operator-visible review UI or should remain backend-only for incident tracing.
- Decide the retention window for closed support sessions and tickets, then automate cleanup if the audit policy allows it.

### Constraints to keep

- No second open ticket while one is already active for the same signed actor.
- No user-visible closed-ticket archive.
- No separate user-only "hide ticket" state that diverges from the actual support-thread status.
- No mixed report-plus-support inbox.
- No paid or plan-gated support path.

## Platform Moderation Direction

Current production has a narrow moderation model: one manually bootstrapped reports-inbox owner can review reports, warn owners, freeze or delete channels and resolve owner petitions. Durable reports, moderation state, petitions and moderation audit logs already exist; delegated platform roles still do not.

### Principles

- Platform moderation remains separate from channel ownership.
- The browser never submits its own trusted role.
- Vercel can authenticate the session, but the Worker makes the final authorization decision.
- Sensitive platform actions should live under a dedicated `/api/platform-admin/*` namespace.

### Proposed roles

| Role | Scope |
| --- | --- |
| `reviewer` | View reports and evidence, add internal review notes |
| `moderator` | Resolve reports, warn owners, restrict, suspend and restore channels |
| `super_admin` | Grant and revoke operator roles, perform destructive or system-level actions |

### Existing foundation

- `channel_reports`
- `channel_moderation`
- `channel_petitions`
- `moderation_audit_logs`

### Future additions

- Add `platform_admins` only if the product actually needs delegated reviewer and moderator roles.
- Extend the existing moderation audit model instead of creating a second overlapping platform-audit system unless non-moderation operator actions require a separate boundary.

Reporter network and device signals should stay HMAC-hashed; raw IP addresses and fingerprints should not be retained.

### Delivery phases

1. Add regression coverage and retention policy for the existing report, warning, freeze, deletion, restoration and petition flows.
2. Decide whether the current single-super-admin model is still insufficient before adding role infrastructure.
3. If delegation is needed, add `platform_admins`, shared role checks and a migration path from reports-inbox ownership.
4. Add operator assignment and audit-review UI without replacing the existing reports-inbox workflow prematurely.
5. Require recent authentication for destructive or system-level actions.
6. Add a separate report console only if measured operator workflow problems justify it.

## Not Next

- Full multi-moderator RBAC before the current single-admin flow is fully stable.
- A large mixed support-plus-reports inbox built on top of the current owner DM model.
- Shareable or raw-ID anonymous support thread access outside the current signed-identity boundary.
- Another broad `ChatView` extraction pass without a concrete feature, defect or testability reason.
- Precomputed channel activity without production measurements, a backfill, dual writes and shadow comparison.
