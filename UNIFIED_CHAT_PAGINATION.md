# Unified Chat Pagination

This document tracks the isolated implementation on `codex/unified-chat-pagination`.
Nothing in this project should replace the production message or DM read path until
the shadow-comparison stage is complete.

## Objective

Return public messages, visible private DM roots and their replies as one stable,
authorization-aware visual timeline. A page boundary must never cause a DM to
appear before the root window that actually contains it.

## Current production behavior

- Public messages use root-aware, bidirectional pages.
- DM roots are read separately with a latest-50 limit; replies are fetched in a
  second query.
- The client merges both collections and conditionally reveals DMs using the raw
  timestamps of the currently mounted public messages.
- A recent reply attached to an old public root can widen that timestamp range and
  reveal DMs that belong to a different visual window.

## Non-negotiable invariants

1. A channel owner can see every non-pending-delete DM in that channel.
2. A non-owner can see only DM roots belonging to the server-resolved anonymous
   identity and replies attached to those roots.
3. A client-provided UID is never sufficient authorization.
4. Public-message passcode, moderation, deleted-parent and live-session boundaries
   remain unchanged.
5. Page reads have bounded row counts and bounded D1 variables.
6. The same cursor always produces the same strict before/after partition.
7. A root renders before its replies even when a reply was created much later.
8. No source can be duplicated or skipped when timestamps and IDs collide.

## Cursor contract

The ascending visual tuple is:

1. `visual_root_created_at`
2. `source` (`message` before `dm`)
3. `visual_root_id`
4. `visual_depth` (`0` root, `1` reply)
5. `created_at`
6. `id`

`source` is explicit because rows live in separate tables and table-local IDs must
not be assumed globally unique. Page size defaults to 50 and is capped at 100.

## Rollout stages

### Stage 1 — cursor and authorization contract

- Status: implemented on the feature branch.
- Adds a pure cursor parser, comparator and page-size clamp.
- Adds regression coverage for roots/replies, cross-source ties, malformed cursors
  and page bounds.
- Does not change production reads, rendering or API responses.

### Stage 2 — parallel server reader

- Status: internal reader implemented; it is not routed to an API yet.
- Public-message and authorized-DM parent candidates are fetched in parallel with
  `limit + 1` per source, then merged in Worker memory.
- The final root window is selected before public replies or DM replies are read.
  Reply queries receive only selected root IDs and use bounded placeholder buckets.
- Owner reads use the channel DM index; visitor reads additionally require the
  server-resolved anonymous UID and use the channel/UID/time index.
- Existing `/api/init`, `/api/data?type=messages` and client rendering remain
  unchanged. API exposure belongs to Stage 3 after authorization fixtures expand.

Stage 2 query budget per page:

- two parallel root-candidate reads, each capped at 51 for the normal page size;
- normally zero or one public-reply lookup and zero or one DM-reply lookup;
- page sizes above 50 split root IDs into 50-ID chunks, keeping every reply query
  below the D1 variable limit (at most two chunks per source at the hard maximum);
- at most 102 root candidates sorted in Worker memory;
- exactly 50 or fewer roots expanded into the returned internal page.

Stage 2 intentionally does not hydrate the reports inbox or expose a live route.
Those adapters must be added only after the base owner/visitor visibility matrix is
covered in Stage 3.

### Stage 3 — shadow comparison

- Status: implemented on the feature branch; disabled unless the request carries
  `X-Unified-Timeline-Shadow: 1` and requests the latest normal-channel page.
- The production response remains the legacy public-message response. In parallel,
  the Worker reads the legacy DM window and the new unified page, then compares the
  same bounded 50-root merged window.
- Non-owner comparison runs only when `X-Anonymous-Token` verifies successfully;
  URL parameters and other client-provided UID values are ignored. Owner scope still
  comes only from the trusted app-proxy identity.
- Mismatches record counts, the first mismatch position and source types. Message
  text, DM text, anonymous UIDs and identity tokens are never included.
- Live and reports channels, paginated history requests and unsigned visitors are
  deliberately skipped until their adapters have dedicated coverage.

To exercise this stage from a development client, issue the normal latest-message
request with the shadow header and inspect `X-Unified-Timeline-Shadow` on the
response (`match`, `mismatch`, `identity-required`, `skipped` or `failed`). The app
proxy forwards only the literal opt-in value and signed anonymous token.

### Stage 4 — client integration

- Replace separate `messages` and `dmMessages` history reads with the unified page.
- Preserve realtime event authorization and merge events by `(source, id)`.
- Re-test upward/downward anchor correction, gallery navigation and refresh restore.

### Stage 5 — controlled switch

- Enable for owner test accounts, then signed/anonymous viewers, then all channels.
- Retain a rollback flag until production mismatch and latency metrics are stable.

## Expected bottlenecks and inefficiencies

- A naive `UNION ALL` followed by a global sort may scan both channel histories on
  every page. Stage 2 must select bounded roots through source-specific indexes
  before merging candidates.
- Expanding replies before selecting roots multiplies rows and destabilizes page
  size. Root selection must happen first.
- Owner DM visibility can produce more candidates than visitor visibility. Query
  plans and row reads must be measured for both roles.
- Shadow comparison temporarily adds read cost and must be opt-in and sampled.
- Maintaining legacy and new client state simultaneously would duplicate memory and
  reconciliation work; the client switch should happen at a single adapter boundary.

## Trade-offs

- The cursor is larger than the current `{created_at, id}` cursor, but it removes
  ambiguous cross-table boundaries.
- Source ordering is an implementation rule visible only when two roots have the
  exact same timestamp. Determinism is more important than pretending those roots
  have an undefined order.
- The staged rollout takes longer than a direct query replacement but materially
  reduces the risk of private DM exposure, missing messages and unrecoverable scroll
  jumps.
- An opted-in latest-page read temporarily performs both legacy and unified reads.
  This is intentionally too expensive for default traffic and must remain off until
  a later sampled rollout.
