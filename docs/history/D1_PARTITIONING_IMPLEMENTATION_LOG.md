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

## Next implementation step

Migrate one channel-only read path at a time to resolve its database before
opening a D1 read session. Mixed routes must separate control-plane reads from
channel-local reads before they are switched. Durable source events remain
required before notification storage can be physically separated. The resolver
will remain single-database during this phase; virtual-bucket routing is enabled
only in the canary after all channel-local paths use the resolver.
