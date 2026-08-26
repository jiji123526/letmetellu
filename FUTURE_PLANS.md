# Future Plans

Last reviewed: 2026-08-26 against deployed `main` commit `749df13`.

This file provides a short current-state snapshot and orders the remaining
product and platform work. Detailed shipped behavior belongs in
[MIGRATION_NOTES.md](./MIGRATION_NOTES.md), launch requirements belong in
[LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md), and subsystem-specific evidence
remains in the linked implementation documents.

## Current Status

### Main branch

- Unified normal, live and reports timelines, source-qualified DM replies,
  bounded history mounting, stable prepend/navigation and the global rollback
  switch are implemented. The Stage 6 production data-shape and index audit
  passed with maximum public fan-out of 15, maximum DM fan-out of two and no
  over-budget roots. Owner/visitor runtime calibration and Stage 8
  observation/legacy cleanup in
  [UNIFIED_CHAT_PAGINATION.md](./UNIFIED_CHAT_PAGINATION.md) remain incomplete.
- Authenticated Web Push supports role-aware `Important` and `All` modes,
  immediate individual message events, live starts, DMs and private DM replies.
  Delivery has leases, retries, endpoint revocation and bounded terminal-row
  retention.
- Migration `0063_notification_ready_lookup.sql` and Worker commit `f515d5f`
  replace an empty-queue table scan with two exact partial-index probes.
  Production migrations through `0063` and the current Worker are deployed.
  The 2026-08-26 production audit found 742 delivered rows, zero ready/retry/dead
  work, five active subscriptions and all seven required indexes. D1
  fingerprints should still be compared with the recorded pre-rollout baseline
  before changing delivery architecture.
- Public channel appearance already uses a versioned browser snapshot and stable
  media paths. Commit `8fc6c42` additionally decodes the authoritative
  background before replacing the cached loading surface. The frontend is
  deployed; production mobile re-entry still needs explicit device verification.
- The deployed chat accepts JPEG, PNG, GIF and WebP files through chat-wide
  drag-and-drop and textarea clipboard paste without adding a visible drop-zone
  overlay. File selection, drop and paste share the existing image validation,
  processing and upload limits.
- Live emoji controls are positioned relative to the chat composer, and flying
  emoji broadcasts are accepted and delivered only for authenticated Live
  viewers. Normal chat independently rejects stale flying-emoji events.
- Production health monitoring recovered from the short 2026-08-26 D1 storage
  timeout. The deployed alert policy keeps D1, request-5xx and exception bursts
  critical while classifying an isolated maintenance failure as degraded.
- Recent D1 inspection found no urgent main timeline or gallery query problem.
  The one/two-character substring search read about 30,040 rows across 12
  searches but remained at 1.4 ms P50/P99 and 0.07% of runtime, so it is not a
  current optimization target.

### Monetization branch

- Plus entitlement, expiry/channel-retention, image quota and Toss billing work
  exists only on `monetization-beta`; it is not part of `main`, and production
  legal text still states that paid plans are not operating.
- As of this review, the branches have 33 monetization-only commits and 65
  `main`-only commits. A wholesale merge would conflict with or remove newer
  notification, timeline and background work.
- Before any paid launch, make an explicit go/no-go decision based on expected
  conversion, the annual PG cost, legal readiness and support burden. If the
  answer is go, port the billing work onto a fresh branch from current `main`
  in bounded stages rather than merging the old branch as-is.

## Recommended Order

1. Run the focused production checks for chat media input, Live-only emoji
   delivery, cached background transitions and notification query plans.
2. Compare post-deploy notification and D1 behavior with the recorded baseline.
3. Complete unified-timeline production calibration and remove legacy/shadow
   paths only after the observation gates pass.
4. Add only the operational metrics and retention work justified by real beta
   traffic.
5. Decide whether Plus/Toss economics justify launch. If yes, re-port and
   validate the monetization branch against current `main`.
6. Improve guided support before adding another communication surface.
7. Add notice comments only if channels demonstrate a real need for lightweight
   public discussion.
8. Add rewarded media credits only after a viable ad provider and server-side
   reward verification are confirmed.
9. Add delegated platform moderation only when one super admin is no longer
   operationally sufficient.

## Immediate Production Checks

### Notification ready-query optimization

Production migrations through `0063` and the current Worker deployment were
confirmed on 2026-08-26. No additional schema or deployment step is pending.

The 2026-08-26 read-only audit confirmed an empty ready backlog, no expired
terminal rows, five active subscriptions and all seven required indexes.

1. Confirm `EXPLAIN QUERY PLAN` reports
   `notification_outbox_attempt_ready_idx` and
   `notification_outbox_lease_ready_idx`, with no table scan or temporary
   ordering tree.
2. Compare a post-deploy six-hour D1 window with the previous 1,555 probes and
   479,570 rows-read baseline.
3. Continue recording ready backlog, retry/dead counts, delivery latency and
   active subscription volume. Do not add Queues or increase batch limits
   unless these measurements show a real bottleneck.

### Cached channel appearance

1. Re-enter image-background public channels on iOS Safari and Android Chrome
   both within and after the five-minute browser freshness window.
2. Verify that cached loading and authoritative chat surfaces transition without
   a default-background flash.
3. Change the background, overlay, blur and bubble color once and confirm that
   the new appearance version replaces the old snapshot.
4. Confirm a broken or slow background cannot hold channel entry longer than
   the two-second preparation limit.

### Chat media and Live emoji regression

1. On desktop, drop each supported image type onto the chat outside the
   textarea and confirm the browser does not navigate away or show a page-wide
   drop overlay.
2. Paste an image into the textarea on desktop and mobile, then confirm any text
   in the same clipboard operation is preserved.
3. Confirm unsupported files, oversized images and blocked/frozen composers
   fail with localized feedback and do not create pending uploads.
4. In Live mode, confirm the shortcut row and picker stay aligned with the chat
   composer and that a second authenticated Live viewer receives the animation.
5. Keep another client in normal chat and confirm it never receives or renders
   the Live flying emoji.

## Operational Improvements

- Complete production fan-out/query calibration and the global observation
  window for the implemented unified normal/live/reports timeline. After the
  exit criteria in
  [UNIFIED_CHAT_PAGINATION.md](./UNIFIED_CHAT_PAGINATION.md) pass, remove shadow
  double reads and legacy compatibility state while retaining the global
  rollback until the cleanup release is stable.

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
- Consider a separate durable post-commit outbox for realtime broadcast or
  link-index work only if operational events show repeated failures. The
  existing Push outbox does not cover those dependencies.
- Surface client-cancelled `499` traffic separately if bounded edge-log
  ingestion becomes available.

## Notification Follow-Up

- Confirm notification backlog, delivery latency, retry/dead counts and active
  subscription volume after the `0063` rollout before changing batch limits or
  moving delivery to Queues.
- Keep client-side visible-channel suppression as the default. Add server-side
  Durable Object presence suppression only if Push volume shows meaningful
  provider waste; do not write presence heartbeats to D1.
- Add quiet hours only after defining timezone, daylight-saving, multi-device
  and urgent-event behavior.
- Add anonymous Push only after a separate privacy, abuse and identity-lifetime
  review.
- Keep terminal retention at delivered 30 days, dead 90 days and revoked
  subscriptions at least 90 days unless incident-response evidence justifies a
  change.

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

## Plus And Payments

Do not merge the existing `monetization-beta` branch directly into `main`.

- First decide whether the expected paid-user count can recover PG, tax,
  maintenance and support costs without relying on optimistic conversion.
- If proceeding, create a new branch from current `main` and port the work in
  stages: schema/entitlements, feature gates, expiry/channel retention, image
  quota, provider-neutral orders, Toss confirmation, renewal/cancellation, then
  UI and legal copy.
- Resolve migration-number collisions with the notification migrations before
  applying anything to preview or production.
- Preserve current Push, unified timeline, media loading and channel appearance
  behavior while porting; each stage needs focused tests and a separate commit.
- Use Toss test keys and a preview Worker/D1 database until first charge,
  renewal, cancellation, refund, webhook replay and failed-payment recovery all
  pass.
- Update terms, privacy disclosures, refund policy and merchant information
  before enabling any production checkout.
- Launch Plus without rewarded ads first. Add ads only after paid entitlement
  and downgrade behavior are stable and measured.

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

- Leave one/two-character substring search unchanged while latency and traffic
  remain near the observed 1.4 ms and 12 searches per six hours. Consider a
  minimum length, recent-history limit or dedicated short-gram index only after
  a measured user-facing regression.
- Monitor the three-or-more-character visual-order search parent join,
  temporary sort, FTS storage and write cost before adding denormalized
  root-order fields.
- Recheck notification-ready fingerprints after `0063`; do not add Queue/Alarm
  infrastructure solely because the old scan had a high rows-read ratio.
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
