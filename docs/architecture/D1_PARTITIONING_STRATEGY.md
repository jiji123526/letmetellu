# D1 Partitioning Strategy

> Status: Proposed; not implemented
>
> Last reviewed: 2026-09-09
>
> Scope: Channel data placement, routing, cross-database consistency, migration,
> and scale-out options for the Worker API

## Executive decision

Do not partition production solely because the paid plan permits 50,000 D1
databases. Partition only after measurements show that one database's write
serialization, queueing, storage growth, maintenance work, or failure domain is
violating a defined service objective.

The recommended path is:

1. Keep the current single D1 while it meets measured service objectives.
2. Introduce explicit control-plane and channel-data access boundaries without
   moving data.
3. Make post-commit effects durable and idempotent before creating a
   cross-database boundary.
4. When measurements justify partitioning, start with a small, bounded pool of
   Chat D1 shards.
5. Keep all strongly consistent data for a channel in its selected Chat shard.
6. Route ordinary channels locally through a stable virtual-bucket map, without
   a control-database lookup.
7. Use explicit overrides only for moved, hot, or unusually large channels.
8. Promote those exceptional channels to dedicated databases when justified.
9. Add a time bucket to message storage only when a single channel's history
   becomes too large or too hot as one partition.
10. Keep global account and exceptional routing state in a control plane.
11. Use shard-local durable events and idempotent consumers for cross-database
   effects.
12. Avoid synchronous scatter-gather across D1 databases on user-facing paths.

The first production experiment should use two Chat D1 databases and a small
allowlist of channels. It should not begin with a broad functional split or
hundreds of databases.

## Why this is not an immediate latency fix

Current production evidence points to long-tail delay on the first authoritative
D1 channel-state access. SQL execution is normally sub-millisecond to
single-digit milliseconds, while binding or queue wait has reached several
seconds even for empty channels. Read replication improves capability-authorized
repeat reads, but a fresh security-sensitive read must still start from current
primary state.

Partitioning can help when the queue is caused by per-database contention. It
cannot be assumed to fix:

- a Cloudflare platform or regional incident;
- first-binding overhead unrelated to database load;
- network distance to a primary;
- a slow Worker path outside D1;
- a hot Durable Object or external dependency.

Routing must not add a mandatory control-D1 or cache lookup before every channel
query. That would add another remote operation to the exact first-entry path
this work is intended to improve. Local hash and capability verification are
acceptable; network-backed routing is an exceptional recovery path.

Before implementation, correlate D1 queue wait and overload errors with write
rate, query duration, database size, and maintenance activity. A two-shard
canary must demonstrate improvement before the design expands.

## Current architecture

The Worker currently has:

- one D1 binding, `DB`;
- D1 Sessions API selection for security-aware read replication;
- one `ChatRoom` Durable Object identity per channel for realtime delivery;
- R2 for media;
- one relational schema containing account, channel, message, moderation,
  support, operational, and notification data;
- scheduled notification delivery and maintenance jobs against the same D1.

Most high-volume records are naturally scoped by `channel_id`:

- `messages` and `messages_fts`;
- `gallery`;
- `dm` and `dm_replies`;
- `message_links`;
- `blocked`, `moderators`, and `banned_words`;
- `config`;
- `channel_moderation` and `channel_petitions`;
- `message_actor_identities`;
- `upload_tickets`;
- pending message deletion state.

This makes `parentChannelId` the natural first partition key. Normal and live
variants must resolve to the same partition unless live data is deliberately
given a separate lifecycle.

## Platform constraints

Cloudflare's documented paid-plan limits and behavior materially affect the
design:

| Constraint | Architectural consequence |
| --- | --- |
| 50,000 D1 databases per account by default | Many small databases are supported, but the account limit is not a routing or operations solution. |
| 10 GB maximum per D1 database | One unbounded hot channel cannot remain in one database forever. |
| Approximately 5,000 resource bindings per Worker script | One Worker cannot directly bind all 50,000 databases using ordinary bindings. |
| Six simultaneous D1 connections per Worker invocation | User-facing scatter-gather across many shards is not viable. |
| One query at a time per D1 database instance | A hot channel can delay unrelated channels placed in the same database. |
| Writes always reach the primary | Read replication does not scale the write path. |
| Up to 1,000 D1 queries per paid Worker invocation | This is a ceiling, not a reason to fan out broadly. |

Cloudflare describes D1 as intended for horizontal scale across smaller
per-user, per-tenant, or per-entity databases. That supports channel-oriented
partitioning, while the binding and connection limits require bounded routing
and no broad fanout.

## Design goals

1. Scale write throughput across independent D1 primaries.
2. Prevent one hot channel from delaying unrelated channels.
3. Keep message authorization and channel-local mutations strongly consistent.
4. Preserve current passcode, moderation, deletion, DM, and live-session
   boundaries.
5. Keep ordinary channel reads and writes on one database.
6. Permit channel movement without changing the public channel identifier.
7. Make every cross-database workflow retryable and idempotent.
8. Retain a rollback path throughout migration.
9. Keep schema version, backlog, and shard health observable.

## Non-goals

- Global serializable transactions across D1 databases.
- Real-time SQL joins across all channels.
- Platform-wide message or gallery search.
- Exact equal distribution by channel count.
- Immediate replacement of D1 with another datastore.
- Moving canonical message storage into Durable Objects before channel-history
  reads and operational tooling are redesigned.
- Partitioning merely to consume an available database quota.

## Data ownership

### Control database

The control plane owns account-global and routing records:

- users and account authentication state;
- deleted-account and verification state;
- global administrators;
- virtual-bucket map versions and exceptional channel overrides;
- channel lifecycle and movement records;
- owner-channel and recent-channel read projections;
- shard schema and migration state;
- platform-wide support and operational summaries.

The control database is authoritative for lifecycle and exceptional placement.
It is not part of the normal channel request path.

### Chat shard

Each channel has exactly one active home Chat D1. Its strongly consistent data
includes:

- canonical channel settings and passcode state;
- messages, threads, search index, and links;
- gallery records;
- DMs and DM replies;
- moderator, block, banned-word, and moderation state;
- upload tickets and channel-local cleanup state;
- message ownership and actor-identity records;
- local placement state and bounded movement tombstones;
- shard-local domain events.

Foreign keys and transactions remain useful inside this boundary.

### Notification database

A separate notification database is optional and should be introduced only when
notification workload or isolation justifies it. It may own:

- push subscriptions;
- notification preferences;
- delivery outbox rows;
- delivery leases, retry state, and terminal retention.

It must not be the first partitioning change. Splitting it before introducing a
durable source event creates a cross-database dual-write gap.

### Read projections

Global and user-wide views must be projections rather than synchronous shard
fanout:

- owner channel list;
- recent channels;
- public profile channel summaries;
- moderation and report queue summaries;
- operational totals;

The canonical record remains in its owning Chat shard. Projection freshness and
repair behavior must be explicit for each view.

The current unified timeline, channel search, and gallery are not cross-channel
views. They remain entirely in the selected channel's Chat shard. The unified
timeline only combines public messages and authorized DMs for one `channel_id`.
Gallery navigation and message search are also filtered by that channel.

## Latency-first routing

Ordinary channels use deterministic local routing:

```text
partition_key = parentChannelId
bucket = stableHash(partition_key) % VIRTUAL_BUCKET_COUNT
shard_id = ACTIVE_BUCKET_MAP[bucket]
```

`VIRTUAL_BUCKET_COUNT` is fixed independently of the number of physical shards.
The bucket map is a versioned Worker deployment artifact, so normal routing
requires no network lookup. Adding a shard moves selected buckets and their data
instead of changing a `hash(channel_id) % shard_count` formula that remaps most
channels.

The hash algorithm, text encoding, seed, bucket count, and map version are
explicit protocol values. They must not depend on a runtime-specific hash whose
output can change after a deployment.

The control database records exceptional placement and lifecycle state:

```sql
CREATE TABLE channel_placement_overrides (
  channel_id TEXT PRIMARY KEY,
  shard_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('active', 'moving', 'deleting', 'deleted')
  ),
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
```

The normal routing sequence is:

1. Normalize the request channel to `parentChannelId`.
2. Apply a verified override from a short-lived channel capability or a small
   deployed override map when available.
3. Otherwise compute the virtual bucket and shard locally.
4. Open a D1 session on the selected shard with the same security-aware
   consistency constraint used today.
5. Validate current placement version, owner, passcode, deletion, and moderation
   state in the Chat shard.

Edge Cache API and the control D1 are recovery paths for an exceptional channel
whose hint is absent or stale. They must not be queried for every ordinary
request. A retired source shard keeps a movement tombstone; if a request follows
the base bucket to that source, the source rejects authoritative reads and
writes and triggers override resolution. It never forwards or accepts a mutation
speculatively.

An override hint grants no access. It only selects the database on which normal
authorization runs. The signed hint should include:

- `channel_id`;
- override `shard_id`;
- placement `version`;
- expiry;
- the existing viewer and sensitivity claims where applicable.

Signature verification proves that a hint was issued by the service, not that
it is current. The selected shard must compare the hint version with its local
active placement record or tombstone. Unknown mappings, stale versions, and
`moving` state fail closed and refresh through the exceptional routing path.

Known ordinary channels continue using local bucket routing during a
control-plane incident. New channel creation, bucket movement, exceptional
channel movement, and deletion should stop.

### Routing latency budget

Measure routing separately from D1 access:

- local partition normalization and bucket selection;
- signed override verification;
- edge override recovery;
- control-D1 recovery;
- first selected-shard binding wait;
- selected-shard SQL execution;
- total route latency.

The normal path should perform only local routing before opening the selected
Chat D1. A canary fails if lower shard queueing does not produce a meaningful
improvement in end-to-end p95 and p99 latency, or if additional cold-binding
cost offsets that improvement.

### Binding implications

For a bounded shard pool, direct Worker bindings are the preferred data path
because they support D1 Sessions API and read replication. Cloudflare currently
documents approximately 5,000 resource bindings per Worker script, not 50,000.

Using the D1 REST API as the normal dynamic query path would add authentication
and network overhead, and D1 Sessions API is not available through that API.
If the design ever needs more databases than a bounded Worker can bind, evaluate
multiple routing Workers, Workers for Platforms capabilities, or a different
storage topology before relying on REST queries in the hot path.

## Placement policy

Do not place channels by count alone. Assign new channels using a weighted
capacity score:

```text
shard_load =
  recent_write_duration
  + recent_write_rate
  + primary_queue_wait
  + active_realtime_sessions
  + storage_growth
  + maintenance_cost
```

The exact weights must come from production calibration. They determine which
virtual buckets should move and which exceptional channels need dedicated
placement. Do not set a fixed channels-per-database target. Channel count may be
recorded as inventory data, but it is not a useful capacity unit when channel
activity varies.

Recommended behavior:

- distribute ordinary channels through virtual buckets;
- stop assigning new channels before a shard approaches its service objective;
- rebalance selected buckets rather than changing the hash modulus;
- override a hot channel to a dedicated D1;
- preserve spare capacity for bursts and maintenance;
- never add a new shard without migration and observability automation.

The placement system should answer "which shard has safe capacity for this
channel?" rather than "which shard has fewer channels?".

## Strong consistency boundary

Any operation whose partial completion would violate channel correctness must
remain entirely in one Chat shard:

- message insertion and idempotency record;
- reply/root validation and insertion;
- reaction mutation;
- message edit or deletion state;
- gallery attachment linkage;
- owner/moderator authorization state;
- passcode and frozen-channel changes;
- channel-local cleanup job creation.

Cross-database records must not be required to decide whether the channel-local
mutation committed.

## Durable cross-database events

The current message route commits the message before notification fanout runs in
`waitUntil`. If execution ends after message commit but before notification
outbox insertion, the notification event itself may be missing.

Before splitting notification storage, add a shard-local source event in the
same D1 batch as the authoritative mutation:

```sql
CREATE TABLE domain_events (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  lease_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_type, aggregate_id)
);
```

Message persistence then contains both statements in one shard-local batch:

```text
INSERT message
INSERT domain event
```

The dispatcher:

1. leases a pending source event;
2. resolves recipients in the notification data owner;
3. inserts delivery rows with a unique key such as
   `(source_event_id, subscription_id)`;
4. marks the source event complete;
5. retries safely if any later step fails.

If delivery rows commit but source acknowledgement fails, a retry performs
no-op inserts on the unique keys and then acknowledges the source event. This
provides at-least-once processing without duplicate delivery rows.

Realtime broadcast and link indexing can use the same source event mechanism if
production evidence shows their current post-commit retry is insufficient.

## Lifecycle workflows

### Channel creation

1. Compute the virtual bucket and selected shard locally.
2. Create a `creating` lifecycle record in the control database.
3. Idempotently create the channel in the selected Chat shard.
4. Create or refresh control-plane projections.
5. Mark the lifecycle record `active`.

Reads must reject or return a bounded retry response while the channel is not
active.

### Channel deletion

1. Mark the lifecycle or override record `deleting` and invalidate routing
   capabilities.
2. Reject new channel mutations.
3. Create a retryable cleanup job in the Chat shard.
4. Delete Chat-shard records and associated R2 objects using existing bounded
   cleanup behavior.
5. Remove notification preferences and global projections idempotently.
6. Mark the lifecycle or override record `deleted`.

Do not remove the source-shard tombstone until stale route hints and rollback
windows have expired.

### Account deletion

Account deletion becomes a fanout workflow because one user may own or
participate in channels on multiple shards. The control plane must record a
durable account-deletion job, enumerate affected channel IDs from a projection,
and dispatch idempotent shard-local cleanup tasks. Completion requires a
reconciliation pass, not one distributed transaction.

## Moving a channel

The first movement implementation should use a short write freeze rather than
dual writes:

1. Create or update an override with state `moving`, increment its version, and
   invalidate route capabilities.
2. Reject new writes with a retryable maintenance response.
3. Copy all channel-local tables to the destination shard.
4. Verify row counts, latest IDs and timestamps, media references, search rows,
   and required invariants.
5. Write an active placement record to the destination and a moved tombstone to
   the source.
6. Mark the control-plane override active and distribute a new signed hint.
7. Resume writes on the destination.
8. Retain the source copy read-only for the rollback window.
9. Delete the source copy through a recorded cleanup job while retaining the
   bounded tombstone.

Dual writing both shards can reduce the freeze but introduces ordering,
deduplication, and divergent-success problems. Add it only when measured channel
traffic makes a brief write freeze unacceptable.

Moving a virtual bucket follows the same freeze, copy, verify, and cutover
pattern for every channel in that bucket. Publish the new bucket-map version
only after destination validation; do not change the map before its data is
ready. Worker deployments are not globally atomic, so old and new map versions
will coexist during rollout. Source tombstones must reject writes from stale
Worker versions until the old deployment and rollback windows have expired.

## Very large channels

A dedicated D1 removes noisy-neighbor effects but does not remove its 10 GB
limit or single-threaded write path. For a channel approaching either boundary,
partition message history by channel and time bucket:

```text
(channel_id, bucket_start, created_at, id)
```

Only the active bucket accepts writes. Older buckets become immutable or nearly
immutable. Recent reads query the active bucket; pagination crosses into older
buckets only when needed.

Time bucketing has two different uses:

- within one database, it bounds indexes, deletion work, and partition scans;
- across databases, it permits archived history to move away from the active
  write database.

Do not introduce cross-database time buckets until one dedicated channel
actually approaches its storage or throughput limit. They complicate search,
thread references, deletion, and pagination.

## Alternatives and tradeoffs

### Continue with one D1

Advantages:

- simplest transactions, joins, migrations, backups, and debugging;
- no routing layer;
- current read-replication and Sessions API behavior remains intact.

Costs:

- one serialized primary write path;
- one database-wide queue and failure domain;
- one 10 GB storage ceiling;
- maintenance and retention share the production database.

Use this while measured capacity and reliability remain acceptable.

### Functional split only

Examples include separate account, chat, support, or notification databases.

Advantages:

- isolates unrelated workloads;
- subsystem ownership and retention can become clearer.

Costs:

- does not scale a hot chat database by itself;
- removes relational joins and foreign keys between subsystems;
- creates dual-write workflows;
- can move complexity before it solves the measured bottleneck.

This is useful for demonstrated workload isolation, not as the default first
step.

### Direct modulo hash shards

Example: `hash(parentChannelId) % N`.

Advantages:

- no directory lookup;
- simple and even placement for similar channels;
- low implementation overhead.

Costs:

- adding a shard remaps many channels;
- difficult to isolate a hot channel;
- movement and rollback require hash overrides;
- shard count becomes embedded in routing behavior.

Do not use direct modulo hashing for the long-lived topology. The recommended
virtual-bucket variant preserves local routing while allowing selected buckets
to move without remapping every channel. Individual hot channels still use
explicit overrides.

### One D1 per channel

Advantages:

- strong isolation;
- maximum cross-channel write parallelism;
- straightforward per-channel deletion and restore;
- matches D1's per-entity scale-out model.

Costs:

- schema migration, provisioning, and observability across many databases;
- approximately 5,000 ordinary bindings per Worker script;
- account-wide channel lists and the centralized reports inbox can no longer use
  direct joins against channel-local tables;
- one hot channel still has a single-threaded 10 GB database;
- global account workflows become distributed.

This may fit a smaller number of high-value isolated tenants, but it is not the
default recommendation for this application.

### SQLite-backed Durable Object per channel

The existing `ChatRoom` identity already routes realtime traffic by channel.
Cloudflare documents SQLite-backed Durable Objects as private, transactional,
strongly consistent storage colocated with object compute. A paid-plan object
has a 10 GB storage limit, and a namespace can contain an unlimited number of
objects. Each object remains single-threaded and has a documented soft limit of
approximately 1,000 requests per second.

Advantages:

- no D1 binding explosion for per-channel instances;
- realtime coordination and storage share one consistency boundary;
- no separate channel-to-database directory is required;
- SQL runs beside the channel actor.

Costs:

- one object remains a hot-channel bottleneck;
- no D1 read-replication path for history reads;
- owner and recent channel lists plus the centralized reports inbox require
  external projections;
- D1's schema, query-insight, import/export, and external tooling are reduced or
  must be rebuilt;
- migration changes the canonical storage model, not only its placement.

This is the strongest alternative when realtime write coordination dominates
and account-wide directory views and centralized reports are projection-based.
The per-channel unified timeline, search, and gallery can remain inside the
object. This is a later-stage option for this codebase, not the first migration.

### Externally managed distributed datastore

Vitess, distributed SQL, or a wide-column datastore can provide routing and
resharding capabilities beyond D1.

Advantages:

- fewer Worker binding concerns;
- established large-scale resharding and operational patterns;
- potentially higher single-dataset scale.

Costs:

- new provider, latency, cost, security, and operational surface;
- major schema and application rewrite;
- loss of Cloudflare-local storage behavior;
- likely unnecessary at current scale.

Revisit this only after D1 or Durable Object limits are demonstrated, not
predicted.

## Case studies

### Cloudflare D1

Cloudflare explicitly positions D1 for horizontal scale across many smaller
per-user, per-tenant, or per-entity databases. It documents that each database
instance is single-threaded and queues concurrent work, with overload errors
when the queue fills. Throughput therefore depends heavily on query duration.

Lessons for this project:

- channel or tenant partitioning matches the product model;
- query optimization remains important after partitioning;
- read replication scales reads but all writes still reach a primary;
- account database quota does not remove Worker binding, routing, migration, or
  connection constraints.

### Slack

Slack originally placed all data for a workspace on one shard. A metadata
cluster mapped workspace IDs to shard IDs, and each shard held thousands of
workspaces. This simplified development because one workspace used one
database.

At scale Slack reported:

- large workspace hotspots;
- underutilized long-tail shards;
- difficulty splitting one large customer;
- full customer outages when a workspace shard failed;
- product complexity when features crossed workspace boundaries.

Slack moved toward Vitess and more flexible keyspaces. Its engineering write-up
specifically describes the desire to shard message data by channel ID instead
of forcing every channel and DM in a workspace onto the same shard.

Lessons for this project:

- co-locating a tenant is valuable until one tenant becomes too large;
- a fixed number of tenants per shard does not prevent hotspots;
- message data can need a finer partition key than account data;
- routing and resharding tooling are part of the database architecture;
- migration requires backfill, dual-read comparison, and controlled cutover.

### Discord

Discord stores messages using a partition based on channel plus a static time
bucket. Chronologically sortable message IDs provide ordering inside that
model. The bucket prevents one channel's complete history from becoming one
unbounded partition.

Discord also describes hot partitions: one heavily accessed channel and bucket
can affect latency beyond that logical partition.

Lessons for this project:

- `channel_id` is the correct locality boundary for message history;
- time must become a secondary boundary for exceptionally large channels;
- partitioning does not eliminate hotspots;
- hot-key detection and promotion remain necessary.

### Durable Objects

Cloudflare positions SQLite-backed Durable Objects as a lower-level
compute-with-storage building block. Each object has private transactional
storage and application logic can execute next to SQLite. Cloudflare contrasts
this with D1's managed database features and external database-style access.

Lessons for this project:

- the existing per-channel `ChatRoom` topology could become a storage topology;
- this avoids thousands of D1 bindings;
- the cost is rebuilding managed database tooling and global projections;
- one channel is still one serialized actor and must be bucketed or redesigned
  if it exceeds one object's capacity.

## Phased implementation plan

### Phase 0: establish evidence

Status: not started.

1. Record per-route D1 SQL duration, total binding duration, rows read/written,
   served region, and primary/replica selection.
2. Correlate overload and `d1_unavailable` events with write rate, cron work,
   storage, and query fingerprints.
3. Define SLOs for fresh channel entry, repeat entry, message send, history
   reads, and mutation error rate.
4. Estimate per-channel storage and write distributions.

Exit gate:

- evidence identifies a per-database capacity or isolation problem that
  partitioning can plausibly improve.

### Phase 1: database access abstraction

Status: in progress on `feature/d1-channel-db-abstraction`.

1. Replace route-level assumptions that every operation uses `env.DB` with
   explicit account, channel, notification, and operations data accessors.
2. Preserve one physical database behind all accessors.
3. Generalize the D1 session helper to accept a selected database.
4. Update test doubles to verify database selection without changing behavior.

Implemented so far:

- added an asynchronous channel database resolver that preserves the current
  single-D1 deployment;
- made normal and live channel IDs resolve to one partition key;
- routed channel-state and socket-authorization channel reads through the
  resolver;
- allowed D1 read sessions to start from a selected channel database;
- routed unified timeline, data collection, and private DM reads through the
  selected channel database boundary;
- added placement-versioned cache scope and a split `init` path that keeps
  canonical authorization state on the selected shard, accepts control
  enrichment only for a matching projected owner, and keeps reports channels
  pinned to control;
- kept control-plane lookups outside channel-scoped database environments.

Exit gate:

- all existing tests pass with one database and no production data movement.

### Phase 2: durable source events

Status: not started.

1. Add shard-local `domain_events`.
2. Write message and event rows in the same D1 batch.
3. Add leases, retries, unique consumer keys, retention, and reconciliation.
4. Route current notification creation through the consumer while leaving
   notification tables in the existing database.

Exit gate:

- forced failure between message commit and notification fanout leaves a
  recoverable pending event and never creates duplicate delivery rows.

### Phase 3: two-shard canary

Status: not started.

1. Add two Chat D1 bindings with identical channel-local schema.
2. Add a small static canary allowlist that routes locally without a control
   lookup.
3. Backfill selected low-risk channels.
4. Shadow-read and compare canonical rows before cutover.
5. Freeze writes briefly, copy the final delta, install a source tombstone, then
   deploy the allowlist cutover and resume on the destination.
6. Verify stale Worker versions cannot write to the source.
7. Retain source rows for rollback.

Exit gate:

- canary channels meet correctness checks and improve end-to-end channel entry
  and message-send p95/p99 latency without increasing error rate;
- resolver, first-binding, SQL, and total route timing show that routing and
  additional cold bindings do not offset reduced database queueing.

### Phase 4: pooled production shards

Status: not started.

1. Automate database creation, schema application, validation, and inventory.
2. Add versioned virtual-bucket routing as a Worker deployment artifact.
3. Add measured bucket rebalancing and exceptional channel overrides.
4. Add shard-level dashboards and alerting.
5. Move additional channels in bounded cohorts.
6. Add hot-channel detection and dedicated-shard promotion.

Exit gate:

- shard creation and movement are routine, observable, reversible operations;
- ordinary channel requests do not query edge cache or the control database for
  routing;
- no user-facing route performs unbounded shard fanout.

### Phase 5: large-channel time buckets

Status: deferred until required.

1. Define bucket size from storage and access measurements.
2. Make cursor contracts bucket-aware without exposing physical shard IDs.
3. Keep the active bucket writable and older buckets immutable.
4. Add cross-bucket search, thread, deletion, and retention tests.
5. Move archived buckets to separate storage only if one dedicated D1 requires
   it.

Exit gate:

- one large channel can grow beyond a single active-history database without
  duplicate, missing, or incorrectly ordered timeline items.

## Testing requirements

The partitioning implementation needs coverage beyond ordinary route tests:

- every channel-local mutation selects exactly one Chat shard;
- normal and live channel IDs resolve to the intended common partition;
- stable hash fixtures always select the same virtual bucket;
- hash protocol changes require an explicit version and migration;
- bucket-map versions select the expected bound D1 without network lookup;
- forged override hints do not bypass authorization;
- stale override versions fail closed at source and destination shards;
- ordinary routing does not access Cache API, KV, or the control D1;
- a control-plane outage does not block ordinary bucket-routed channels;
- source events survive consumer failure;
- duplicate event delivery is idempotent;
- channel creation and deletion recover after every intermediate failure;
- movement preserves messages, replies, DMs, gallery, links, search rows, and
  authorization state;
- cursors join pages correctly before and after movement;
- old routing hints cannot write to a retired source shard;
- scheduled maintenance processes every active shard with bounded concurrency;
- schema migration can resume and report partial failure;
- rollback restores source routing without accepting divergent writes.

## Operational requirements

Before more than two production shards exist, provide:

- a shard inventory with database ID, schema version, state, size, and assigned
  channel count;
- versioned virtual-bucket maps and a record of every moved bucket;
- automated migration application with bounded concurrency;
- read-only audit queries for every schema version;
- per-shard queue, SQL duration, rows read/written, error, and storage metrics;
- domain-event backlog age and retry metrics;
- channel movement and rollback tooling;
- a way to disable writes globally and per shard;
- shard-aware maintenance and notification recovery;
- runbooks for control-plane, shard, and projection failures.

Cron handlers must not open every shard concurrently. Work should be partitioned
across invocations or processed through a durable queue with explicit
concurrency.

## Decision gates

Proceed with Chat D1 partitioning when at least one condition is sustained:

- primary write queue or overload errors violate the message-send SLO;
- one channel measurably degrades unrelated channels;
- database growth approaches the 10 GB limit with insufficient retention relief;
- cleanup or migration work cannot complete inside its operational window;
- per-database failure isolation has become a product requirement.

Do not proceed when:

- the dominant delay is platform-wide first-binding latency;
- routing or additional shard cold-binding cost offsets reduced queueing;
- query duration or missing indexes explain the queue;
- read replication or caching resolves the measured read problem;
- migration and shard operations are not automated;
- global queries still require synchronous access to every shard.

## Recommended next action

Implement Phase 0 only. The present production evidence does not yet prove that
database contention is the cause of the observed first-read tail latency. In
parallel, design Phase 1 so future partitioning does not require another broad
route rewrite. Do not create production shards or split notification tables
until Phase 0 evidence and Phase 2 durable handoff are complete.

## Sources

- Cloudflare D1 limits and horizontal scale guidance:
  <https://developers.cloudflare.com/d1/platform/limits/>
- Cloudflare D1 global read replication and Sessions API:
  <https://developers.cloudflare.com/d1/best-practices/read-replication/>
- Cloudflare SQLite-backed Durable Object storage:
  <https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/>
- Cloudflare Durable Object limits:
  <https://developers.cloudflare.com/durable-objects/platform/limits/>
- Slack, "Scaling Datastores at Slack with Vitess":
  <https://slack.engineering/scaling-datastores-at-slack-with-vitess/>
- Discord, "How Discord Stores Trillions of Messages":
  <https://discord.com/blog/how-discord-stores-trillions-of-messages>

Public source details were reviewed on 2026-09-09. Product limits and platform
behavior must be rechecked before implementation.
