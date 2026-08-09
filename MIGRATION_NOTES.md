# Migration Notes

This file records both the original CSS-to-TSX porting constraints and the database/platform changes made during the rebuild.

## Recent implementation updates

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
