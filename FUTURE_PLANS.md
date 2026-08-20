# Future Plans

This file contains only unimplemented product and platform plans. Launch
requirements belong in [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md), and shipped
behavior belongs in [MIGRATION_NOTES.md](./MIGRATION_NOTES.md).

## Top Priority: Faster Gallery-To-Message Navigation

The current gallery navigation is paginated, but it still waits for too much of
the mounted context window before revealing the target. A context lookup mounts
up to 25 visual roots before the target, the target itself, and 25 roots after
it, expands their replies, activates history preview work, and then repeatedly
scans pending images, videos and layout markers until the relevant window has
been quiet for 900 ms. The scan may continue for up to 45 seconds. Media-heavy
history therefore becomes slower even though the database read is bounded.

Treat this as an atomic staged-navigation project rather than increasing
prefetch distance or page size. Do not reveal the destination as soon as only
the selected image is ready: media or widgets above it can still change height,
move the target and reintroduce the scroll flash or vertical bounce that the
current complete-window wait was designed to prevent.

### Safe implementation order

1. Add development timing marks for context fetch, React mount, target element
   discovery, target-media readiness, layout stabilization and final scroll.
   Keep production logging sampled and aggregate-only if it is later needed.
2. Keep the current viewport visibly fixed while the destination context is
   mounted and prepared. Reveal the new context and perform the final scroll as
   one atomic transition only after its target position is trustworthy.
3. Split gallery staging from the broad `chat-history-preload` signal. Await the
   selected media plus every image, video or embed above it whose unresolved
   height can change the target offset. Content below the target and bounded
   nearby-preview warming must not delay the transition.
4. Reserve final geometry before resource completion wherever possible: use
   stored media dimensions for image aspect ratios and stable preview-card
   placeholders for known link types. Then wait on the remaining relevant
   `decode()`/load/metadata promises in parallel.
5. Replace repeated full-container `querySelectorAll()` polling on the gallery
   path with the collected readiness promises and a short-lived
   `ResizeObserver` covering the staged region above and including the target.
   Once those promises finish, require only two or three stable layout frames.
6. After the staged path is stable, reduce gallery context radius from 25
   roots per side to approximately 12 per side. Existing bidirectional cursors
   must continue loading older and newer pages from that smaller window.
7. Remove the old broad wait from gallery navigation only after slow-network,
   media-heavy and reply-heavy regression coverage passes. Keep it available
   for history operations that genuinely require a complete mounted window.

### Acceptance criteria

- A cached gallery image centers without waiting for content below it or
  unrelated background link warming.
- A slow selected image keeps the old viewport fixed while staging, then
  reveals and centers the destination once without a visible intermediate
  position, scroll flash or vertical vibration.
- Late resource completion above the target cannot change its visible offset;
  geometry is either reserved in advance or included in staged readiness.
- Older and newer loading both continue after entering the smaller context
  window.
- Nearby preview metadata and up to six thumbnails still warm in the
  background without mounting off-screen external widgets.
- User interruption cancels pending alignment immediately.
- Target-not-found, deleted-message and authorization behavior remains
  unchanged.

### Trade-offs and rollback

Staging preserves visual stability but still delays navigation when media above
the target has unknown geometry or a relevant resource is genuinely slow.
Geometry reservation and parallel event-based readiness reduce that delay; they
must not be replaced with an early visible jump followed by repeated scroll
corrections. A staged context can also temporarily retain the old and new
windows at once, increasing short-lived DOM and memory usage, so keep the
context bounded and discard the old window immediately after the atomic
transition. Reducing the context radius causes pagination requests to occur
sooner, trading a smaller and faster staged render for occasional additional
bounded reads. Ship staging/event separation before changing the radius so each
effect can be measured and rolled back independently.

## Recommended Order

1. Complete the atomic staged gallery navigation work above and validate it on
   slow, media-heavy history.
2. Use beta traffic to identify real abuse, reliability and performance needs.
3. Improve the guided-support workflow before adding another large
   communication surface.
4. Add notice comments only if channels need lightweight public discussion.
5. Add rewarded media credits only after a viable ad provider and server-side
   reward verification are confirmed.
6. Add delegated platform moderation only when one super admin is no longer
   operationally sufficient.

## Operational Improvements

- Complete production fan-out/query calibration and the global observation window
  for the implemented unified normal/live/reports timeline. After the exit criteria
  in [UNIFIED_CHAT_PAGINATION.md](./UNIFIED_CHAT_PAGINATION.md) pass, remove shadow
  double reads and legacy compatibility state while retaining the global rollback
  until the cleanup release is stable.

- Add bounded dashboard summaries for moderation actions, report volume,
  petition outcomes and support queue age.
- Track WebSocket disconnect, reconnect-attempt and authorization-failure
  counts so retry timing can be calibrated from production behavior.
- Track scheduled-maintenance duration, per-table deletion counts and cleanup
  jobs that remain pending beyond their normal recovery window.
- Define retention for closed support sessions and tickets, channel reports,
  petitions and visit-survey responses before automating their deletion.
- Add dry-run counts, bounded batches and failure reporting before expanding
  destructive scheduled maintenance.
- Consider a durable post-commit delivery outbox only if operational events
  show repeated message broadcast or link-index failures.
- Surface client-cancelled `499` traffic separately if bounded edge-log
  ingestion becomes available.

## Abuse And Safety Controls

- Expand durable limits from individual routes to suspicious cross-channel
  sending, report and upload behavior.
- Validate direct-API report targets and evidence against authoritative channel
  records before accepting a report.
- Add a low-cost upload-attempt limiter only if metrics show repeated failures
  before ticket creation.
- Consider full image decoding or malware scanning only if production abuse or
  a future image-processing pipeline justifies the CPU and operational cost.
- Strengthen preview destination validation if the platform exposes safe DNS or
  resolved-IP verification primitives.

## Notice Comments

Add a separate flat discussion surface for channel notices.

- Keep comments in the expanded notice panel or a notice-detail view, not in
  the small floating banner.
- Start with text-only comments: no replies, reactions, attachments or
  cross-channel notifications.
- Give every notice an ID or version so replacing a notice starts a new comment
  thread.
- Store comments in dedicated rows rather than inside the existing notice
  configuration payload.
- Reuse signed anonymous/device identity, owner authorization, blocked-user
  enforcement and bounded rate limits.
- Let owners delete comments and lock further comments without deleting the
  notice.
- Add realtime updates only if refresh-on-open or lightweight polling is
  insufficient.

## Guided Support Enhancements

- Refine the guided decision tree only when real support cases expose a missing
  question or an answer that no longer matches shipped behavior.
- Add operator macros or close-reason presets after common reply patterns are
  established.
- Add archive filtering or pagination if closed-ticket volume outgrows the
  current bounded view.
- Decide whether support audit logs need an operator review interface or should
  remain backend-only incident data.
- Define a retention window for closed sessions and tickets, then add cleanup
  if the audit policy permits it.
- Preserve one active ticket per signed actor and keep support separate from
  the reports inbox.

## Rewarded Media Credits

If the product adds “watch an ad to unlock media sends,” implement it as a
server-enforced credit system.

- Define one credit unit as one successfully committed image attachment.
- Bind credits to the authenticated user, or to the existing anonymous plus
  device identity for logged-out chat.
- Verify rewarded-ad completion on the server; never trust a client callback
  by itself.
- Consume credits only when a message attachment is committed, not when an
  upload starts.
- Start with normal channel messages and exclude DMs, live chat and moderation
  channels until the base flow is stable.
- Define stacking, expiry, daily caps, multi-image behavior and failed-send
  refunds before launch.
- Audit reward grants, verification failures, consumption, suspicious repeat
  claims and upload/send mismatches.

## Delegated Platform Moderation

Add multiple operator roles only when the current single-super-admin model is
insufficient.

- Keep platform moderation separate from channel ownership and enforce every
  role in the Worker.
- Introduce `reviewer`, `moderator` and `super_admin` scopes through a
  `platform_admins` table.
- Extend the existing moderation audit model rather than creating a competing
  audit system.
- Add operator assignment and audit-review UI without replacing the current
  reports workflow prematurely.
- Require recent authentication for destructive or system-level actions.
- Continue storing reporter network/device signals only as HMAC-derived values.

## Conditional Performance Work

- Monitor the visual-order search parent join, temporary sort, FTS storage and
  write cost before adding denormalized root-order fields.
- Remove redundant indexes only after production query plans prove that their
  traffic has moved to replacement indexes.
- Add precomputed channel activity only if `/api/user` remains a measured
  hotspot after current query and polling optimizations.
- If precomputed activity is justified, use a backfill, dual writes, shadow
  comparison and a reversible read switch before removing current derivation.
- Split more dashboard or chat orchestration only when profiling or regression
  work identifies a concrete performance or maintainability problem.
- Continue targeted selector, history-navigation, realtime, mobile and
  accessibility coverage before introducing another large chat UI surface.
