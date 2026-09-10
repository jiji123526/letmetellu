# D1 Partitioning Implementation Log

This log records incremental work toward the proposed
[D1 partitioning strategy](../architecture/D1_PARTITIONING_STRATEGY.md).
Production still uses one D1 database. No shard databases, virtual-bucket map,
placement overrides, data migration, or cutover have been created.

## 2026-09-09: implementation branch started

Branch: `feature/d1-channel-db-abstraction`

### Strategy baseline

Commit: `c488400` (`docs: refine D1 partitioning rollout`)

- Removed fixed channels-per-database placement as a design target.
- Confirmed the rollout order: retain one D1, establish access boundaries,
  make cross-database effects durable, and shard only after measured need.
- Defined load-aware pooled shards with dedicated promotion for hot channels as
  the target topology.

### Channel database resolution boundary

Commit: `bc62ad7` (`Add channel database resolution boundary`)

- Added `resolveChannelDatabase()` as the single channel placement seam.
- The resolver is asynchronous so exceptional override recovery can perform
  edge or control-plane I/O without changing all callers again; ordinary
  virtual-bucket routing remains synchronous local work inside that boundary.
- Resolution returns the normalized partition key, logical shard ID, and D1
  binding.
- The current implementation always returns `env.DB` and shard `primary`.
- Added tests proving normal and live variants resolve to the same partition.

Verification:

- targeted Node tests passed;
- Worker TypeScript compilation passed.

### First channel-local route

Commit: `653be05` (`Route channel state through database resolver`)

- Routed channel state, live state, and channel moderation reads through the
  resolved channel database.
- Added `withDatabase()` to preserve non-database Worker bindings when existing
  helpers receive a channel-scoped environment.
- Added source-boundary tests preventing direct `env.DB` reads from returning to
  this route.

Verification:

- database routing, channel state, and init optimization tests passed;
- Worker TypeScript compilation passed.

### Socket authorization

Commit: `81b0494` (`Resolve socket authorization channel database`)

- Routed channel existence, ownership, and passcode reads through the channel
  database resolver.
- Kept platform-administrator lookup on the control database boundary.
- Added tests for the channel/control ownership split.

Verification:

- routing, authorization boundary, and read-path tests passed;
- Worker TypeScript compilation passed.

### Selected-database read sessions

Commit: `f9ef912` (`Support selected databases in D1 read sessions`)

- Extended the D1 Sessions helper to accept a resolved database binding.
- Preserved the existing consistency constraints for primary-first and
  unconstrained-first sessions.
- Ensured local and test bindings without `withSession()` retain the selected
  channel database rather than falling back to the control database.

Verification:

- D1 session, database access, and init optimization tests passed;
- Worker TypeScript compilation passed.

### Branch verification

After the four implementation commits:

- all 69 Worker hardening test files passed;
- `npx tsc --noEmit` passed in `worker/`;
- documentation links and whitespace checks passed.

### Latency-first routing decision

The target routing design was refined after reviewing the migration's primary
goal: reducing service latency.

- Ordinary channels will use a stable local hash and versioned virtual-bucket
  map embedded in the Worker deployment.
- The hash algorithm, seed, encoding, bucket count, and map version will be
  treated as a stable routing protocol with fixed test vectors.
- Normal channel requests will not query Cache API, KV, or the control D1 to
  discover a shard.
- Signed hints and edge/control lookups are reserved for moved or hot-channel
  overrides and stale-route recovery.
- Source shards will retain bounded movement tombstones so stale clients fail
  closed instead of writing to retired data.
- Tombstones will also protect non-atomic Worker deployments while old and new
  bucket-map versions coexist at the edge.
- The two-shard canary will use a static local allowlist before the general
  virtual-bucket implementation.
- Canary success requires improved end-to-end p95/p99 latency; lower SQL or
  queue timing alone is insufficient.

## 2026-09-10: unified timeline read boundary

- Routed `GET /api/unified-timeline` through `resolveChannelDatabase()` before
  opening its D1 read session.
- Channel existence, passcode, viewer, timeline, live-session, and report
  timeline data continue to use one session on the selected channel database.
- Platform-administrator and user-locale lookups remain on the control database.
  Shard placement is not an authorization decision and cannot grant access.
- Production behavior is unchanged because the resolver still selects
  `env.DB` and shard `primary` for every channel.
- The resolver currently adds only a local asynchronous function call. Report
  timelines may perform their locale lookup outside the channel read session;
  this preserves the control-plane boundary at the cost of a small additional
  primary-database read path.

Verification:

- all 69 Worker hardening test files passed;
- `npx tsc --noEmit` passed in `worker/`;
- routing tests assert that channel reads use the selected database while
  platform-administrator and locale reads use the control environment.

### Data collection read boundary

- Routed `GET /api/data` through `resolveChannelDatabase()` before opening its
  D1 read session.
- Messages, context, reply parents, blocked users, gallery, DMs, links, search,
  banned words, and unified-timeline shadow reads use the selected channel
  database.
- Platform-administrator and user-locale lookups remain on the control
  database. Operational shadow mismatch and failure events also remain on the
  control database so incident history is not fragmented across shards.
- Authorization still validates channel existence, ownership, passcode, and
  private collection access after routing. Selecting a shard grants no access.
- Production behavior remains single-database because the resolver still
  returns `env.DB`.

Tradeoffs:

- Normal collection reads add only the current local resolver call.
- Report locale and platform-administrator checks may use a separate
  control-database operation. This favors a single authoritative identity and
  authorization source over avoiding an uncommon extra read.
- `GET /api/init` remains unmigrated pending a separate audit of its shared
  in-flight cache keys and cross-shard isolation.

### Private DM read boundary

- Routed only the `GET /api/dm` branch through `resolveChannelDatabase()` and a
  primary-first D1 read session.
- Channel existence, passcode state, and private DM threads use the selected
  channel database.
- The protected reports-owner identity remains a control-database lookup.
- `POST`, `PUT`, and `DELETE` remain on the existing database path. Moving
  those mutations before shard-local durable events exist could commit channel
  data while losing notification or cleanup side effects.
- Production behavior remains single-database because the resolver still
  returns `env.DB`.

### Init route audit

`GET /api/init` was audited but not migrated:

- its channel query joins account-global `users`, reads the reports-channel
  owner, and counts an owner's other channels;
- those account-wide values require control-plane projections after sharding
  and cannot be computed by querying one Chat shard;
- its shared in-flight cache keys include channel and consistency constraint
  but not effective shard ID, so they are not safe across placement changes;
- report hydration currently receives the control environment even though its
  canonical message data will be channel-local.

The route must first split channel-local state from control projections, include
effective shard and placement version in shared cache keys, and keep report
hydration on the selected channel database. Adding only the resolver would risk
incomplete profile data and stale cross-shard cache reuse.

### Init fail-closed routing boundary

- Extended resolved channel placement with an explicit `placementVersion` and a
  standard `shardId:placementVersion` cache scope.
- `GET /api/init` now resolves placement before opening its D1 read session.
- Shared channel and config in-flight cache keys include the resolved database
  scope, consistency constraint, and channel identity.
- Platform-administrator verification uses the control environment rather than
  the channel-scoped read environment.
- Until the mixed channel/control query is split, `init` returns
  `503 channel_init_shard_not_ready` if resolution selects a database other
  than the control database. It never falls back to reading that channel from
  the wrong database.

Current behavior and tradeoffs:

- Production remains on `primary` placement version `1`, so query count,
  response shape, and physical database selection are unchanged.
- The resolver adds only local asynchronous work in the current implementation.
- A future canary channel cannot use `init` until control projections and
  channel-local reads are separated. This is intentional fail-closed behavior.
- Placement version `1` is a contract placeholder, not movement protection.
  Override versions, signed hints, and shard-local tombstone validation remain
  required before physical channel movement.

### Init split-database read path

- Preserved the existing single-query `init` channel lookup whenever the
  resolver selects the control database. The decision is based on the original
  selected binding before D1 wraps it in a Session object.
- Added a split path for ordinary channels on a different Chat shard. Canonical
  channel, passcode, and moderation state comes from the selected shard while
  owner display metadata and account-wide channel eligibility come from the
  control database.
- The shard and control reads run in parallel. Control enrichment is merged only
  when its projected owner matches the canonical shard owner; mismatches degrade
  to no owner name and zero related-channel eligibility.
- Reports-owner identity remains control-plane data and is not used to decide
  channel ownership.
- Existing version-1 channel snapshots do not carry placement version. They are
  ignored on non-control shards, forcing a current primary-first authorization
  read until a placement-aware capability format exists.
- Live-session expiry cleanup now receives the selected channel database rather
  than implicitly writing to the control database.
- Reports channels remain pinned to the control database. `init` returns
  `503 reports_channel_shard_not_ready` if one is accidentally routed to a Chat
  shard because report and petition hydration has not been separated.

Tradeoffs and prerequisites:

- The current control `channels` row acts as a transitional projection. Canary
  migration must retain it and define how owner/profile projection changes are
  refreshed.
- Missing or owner-mismatched projections cannot grant access, but may
  temporarily hide owner display metadata or related-channel UI.
- Physical shard requests perform one Chat-shard read and one control read.
  This is bounded parallel fanout, but canary p95/p99 must prove that it does not
  offset the queueing improvement.
- The primary production path retains its existing query count.

Verification:

- all 70 Worker hardening test files passed;
- `npx tsc --noEmit` passed in `worker/`;
- projection tests prove stale control ownership cannot replace canonical shard
  ownership or expose its owner enrichment;
- routing tests cover the same-database fast path, selected-shard session,
  reports-channel guard, control admin lookup, and selected-shard live cleanup.

### Placement-aware read capabilities

- Snapshot capabilities now use version `3` and access-only capabilities use
  version `4`.
- Both formats include signed parent partition key, logical shard ID, and
  placement version claims.
- `init`, data collection, and unified timeline routes resolve the channel
  database first and pass that result into the common capability verifier.
- A capability is accepted only when its channel, viewer identity, shard, and
  placement version all match. A mismatch falls back to the authoritative
  primary-first channel check instead of replica-first access.
- Legacy version `1` and `2` capabilities remain valid only for primary
  placement version `1`, covering the short deployment overlap without allowing
  them onto a future Chat shard.
- Issuance rejects a placement whose parent partition does not match the
  requested normal or live channel.

Security and tradeoffs:

- Placement claims are routing constraints, not authorization and not proof
  that placement is current. The selected shard must still validate local
  placement state or a movement tombstone before canary cutover.
- The signed payload becomes slightly larger and exposes logical shard identity
  to the browser. It does not expose a database credential or D1 database ID.
- A placement change invalidates outstanding read capabilities immediately.
  The next request performs an authoritative check and receives a refreshed
  capability, adding one expected latency spike during movement.
- Existing snapshot tokens remain subject to their short 30-second or two-minute
  expiry for non-placement channel metadata changes.

### Explicit control channel projection

- Added `channel_control_projections` with only channel ID, owner ID, profile
  visibility, creation time, projection version, and projection timestamp.
- Passcode, moderation, deletion authority, and other access state are
  deliberately excluded. The projection cannot authorize a channel request.
- Existing normal channels are backfilled by migration. Live-channel rows are
  excluded because normal and live variants share one parent placement and
  account-wide views do not list live rows independently.
- While production remains on one D1, insert, relevant update, and delete
  triggers maintain the projection in the same SQLite transaction as
  `channels`.
- The split-database `init` path reads owner/profile enrichment from the
  explicit projection instead of treating the full control `channels` table as
  an implicit projection.
- Added bounded audit SQL for missing, mismatched, and orphaned rows plus an
  idempotent repair script.

Validation:

- isolated SQLite execution confirmed migration, insert/update/delete triggers,
  projection version increments, mismatch detection, and repair;
- all 71 Worker hardening test files passed;
- `npx tsc --noEmit` passed in `worker/`.

Tradeoffs and limits:

- Projection storage and its owner/profile index add modest control-D1 storage.
- Migration backfill writes one row per existing non-live channel and therefore
  creates bounded one-time control-D1 write load. Apply the migration before any
  canary routing and outside a known overload window.
- Channel creation, owner transfer, profile visibility changes, and deletion
  perform an additional trigger write. Unrelated channel updates do not fire
  the update trigger.
- `projection_version` currently orders control-DB trigger updates only. It is
  not yet a globally authoritative source sequence.
- The audit and repair scripts compare against control `channels` and are valid
  only before physical shard ownership, or while that transitional row is
  synchronously refreshed. They cannot detect or repair divergence from a Chat
  shard.
- The repair script deletes orphaned projection rows. Run the audit first and
  do not use this repair script after physical shard ownership begins.
- Before canary, shard-local durable events need an idempotent projection
  consumer with monotonic source versioning and bounded reconciliation.

### Shard-local channel projection events

- Added a generic shard-local `domain_events` ledger with pending, processing,
  delivered, and dead states; retry timestamps; leases; attempt counts; bounded
  JSON payloads; and idempotency by channel, event type, aggregate, and source
  version.
- Added monotonic `projection_source_version` to canonical channel rows and
  `source_version` to control projections.
- Replaced the preparation triggers so normal-channel creation,
  owner/profile changes, and deletion update the local projection and append a
  source event in the same SQLite transaction.
- Live rows do not generate independent projection events.
- Projection event payloads contain only owner ID, profile visibility, creation
  time, and active/deleted state. They exclude passcodes, moderation data,
  messages, media, and message text.
- Added a bounded event-backlog audit that reports status, event type, invalid
  payload counts, and at most 100 unresolved event headers without selecting
  payload content.
- Updated pre-canary projection audit and repair SQL to compare source versions.

Validation:

- isolated SQLite execution confirmed source versions `1`, `2`, and `3` for
  create, update, and delete; matching event order; projection version updates;
  and no live-row event;
- schema/security tests passed;
- all 72 Worker hardening test files passed;
- `npx tsc --noEmit` passed in `worker/`.

Tradeoffs and deployment gate:

- Relevant channel mutations now perform an internal source-version update,
  projection upsert/delete, and event insert. These are low-frequency control
  operations but add D1 write amplification.
- Two event indexes add further write and storage cost.
- No consumer, acknowledgement, retry runner, or retention cleanup exists yet.
  Applying migration `0065` now would create a growing pending backlog.
- Do not apply `0065` to production until the tested consumer and retention
  path are connected to an explicit shard dispatcher and operational rollout.
- A future Chat shard using the same schema would also maintain an unused local
  projection copy. Canary shard bootstrap must replace the preparation triggers
  with event-only triggers.

### Persistent channel projection versions

- Added `channel_projection_versions`, keyed independently from canonical
  channel rows, after confirming that deleted channel addresses are allowed to
  be recreated with a new `instance_id`.
- Create, projection update, and delete events now advance that persistent
  version. Recreating a deleted address therefore receives a version newer than
  its delete event instead of resetting to version 1.
- The same minimal table can serve as the applied-event watermark in the
  control database. Its `active` or `deleted` state lets a future consumer
  reject stale upserts that arrive after deletion.
- Live rows remain excluded because their lifecycle belongs to the parent
  channel and they must not create an independent control projection.

Tradeoff:

- Every projected channel mutation performs one additional indexed watermark
  write. This cost is required to support channel-address reuse safely; keeping
  the version only on the deletable canonical row is not correct.

### Idempotent control projection consumer

- Added a bounded consumer that accepts separate source and control D1
  databases, leases at most ten ready or expired events, and recovers abandoned
  leases.
- Event payloads are treated as untrusted input. The consumer validates the
  event ID, channel and aggregate identity, event type, positive safe-integer
  version, owner ID, profile flag, timestamp, and payload size before writing.
- Control writes atomically advance `channel_projection_versions` and apply the
  corresponding projection mutation only when the event still owns that exact
  active or deleted watermark.
- The source event is acknowledged only after the control batch commits.
  Control failures return the event to a bounded retry schedule and store only
  a fixed error code, not raw exceptions or payload content.
- The consumer is not connected to cron or request handling yet. Deploying the
  Worker without migrations `0065` and `0066` therefore does not query missing
  tables or alter production behavior.

Tradeoffs:

- Cross-D1 writes cannot be one transaction. The consumer intentionally uses
  at-least-once delivery; a control commit followed by a failed source
  acknowledgement causes a harmless version-guarded replay.
- Events are processed serially within each small batch. This limits concurrent
  pressure on the single-threaded control D1 at the cost of lower dispatcher
  throughput.
- Strict validation can dead-letter a legacy or manually inserted event that
  does not match the contract. Auditing and bounded reconciliation remain
  required before activation.

### Domain-event terminal retention

- Added partial indexes for delivered and dead event age scans.
- Added an inactive cleanup helper that deletes at most 2,000 rows per status
  per invocation, retaining delivered events for 30 days and dead events for
  90 days.
- Pending and processing events are outside both cleanup queries regardless of
  age. `channel_projection_versions` is also excluded because its delete
  watermarks must survive event retention and channel-address reuse.
- Retention is not wired into current hourly maintenance yet, so deploying code
  before migrations does not query absent domain-event tables.

Tradeoff:

- Long-lived watermarks consume one small row for every channel address ever
  used on that shard. Removing them would require a separate guarantee that no
  stale event or old channel incarnation can reappear.

### Read-only cross-database projection reconciliation

- Added a cursor-based comparison of at most 100 source channel watermarks
  against control watermarks and projections.
- The check detects missing or stale control watermarks, missing or mismatched
  active projections, and projections left behind after deletion.
- It performs one bounded source query and one bounded control query. It does
  not read domain-event payloads, passcodes, moderation records, messages, or
  media, and diagnostics expose only channel IDs, reason codes, and versions.
- Reconciliation is read-only. Automatic repair remains intentionally absent
  until canary operations define explicit authorization, audit, and rollback
  controls.

## Next implementation step

Define explicit shard bindings and an opt-in dispatcher path for the two-shard
canary, then add audited operator tooling around reconciliation. Message or DM
mutations and virtual-bucket routing remain disabled until these safeguards and
canary tooling are ready.
