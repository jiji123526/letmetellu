# Future Plans

This file contains only unimplemented product and platform plans. Launch
requirements belong in [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md), and shipped
behavior belongs in [MIGRATION_NOTES.md](./MIGRATION_NOTES.md).

## Recommended Order

1. Use beta traffic to identify real abuse, reliability and performance needs.
2. Improve the guided-support workflow before adding another large
   communication surface.
3. Add notice comments only if channels need lightweight public discussion.
4. Add rewarded media credits only after a viable ad provider and server-side
   reward verification are confirmed.
5. Add delegated platform moderation only when one super admin is no longer
   operationally sufficient.

## Operational Improvements

- Continue unified public-message/DM pagination from the completed cursor, reader,
  shadow-comparison, production-shaped API, single-state adapter and unified
  bootstrap/reconnect stages into navigation, realtime mutation normalization,
  fan-out validation, special-channel and controlled-rollout work in
  [UNIFIED_CHAT_PAGINATION.md](./UNIFIED_CHAT_PAGINATION.md). Keep the production
  read path behind a kill switch until authorization, ordering, bounded-row,
  latency and scroll-stability exit criteria pass.

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
