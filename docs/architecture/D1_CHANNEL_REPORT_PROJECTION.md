# D1 channel-report control projection

## Purpose

Channel reports must remain strongly consistent with the channel that accepted
them, while the platform administrator needs one bounded global inbox without
querying every Chat shard. The target ownership is therefore:

- `channel_reports`: canonical in the selected Chat shard;
- `channel_report_control_projections`: non-authoritative operational copy in
  control D1;
- `channel_report_projection_watermarks`: control-side ordering and deletion
  tombstone state;
- report moderation writes: routed to the canonical Chat shard first;
- global counts and inbox reads: served from the control projection after the
  rollout gate is enabled.

The projection contains the report fields needed by the administrator plus a
snapshot of channel name and owner. This prevents an admin dashboard read from
performing synchronous scatter-gather across Chat shards. It intentionally has
no foreign keys to account or channel tables because those records are owned by
different databases after partitioning.

## Implemented producer and consumer path

Migration `0069_channel_report_control_projections.sql`:

- adds a monotonic `projection_source_version` to canonical reports;
- creates the control projection and useful bounded-inbox indexes;
- creates a separate watermark table whose deleted state survives projection
  deletion;
- backfills existing monolith reports at source version 1.

`channel-report-projection.ts` defines a strict internal event contract and an
idempotent control writer. It rejects unknown keys, invalid report states,
oversized content, mismatched aggregate types, invalid channel IDs, and invalid
timestamps. A higher delete watermark prevents a delayed older upsert from
resurrecting a removed report.

Migration `0070_channel_report_projection_events.sql` makes report mutations
atomic with their projection effects in the monolith: insert, update, and
delete advance a deletion-preserving watermark, maintain the same-database
control projection, and append a versioned `channel_report` domain event in the
same SQLite transaction. The bounded shared projection consumer now dispatches
those report events through the strict parser and idempotent writer.

Fresh Chat-shard bootstrap version `11` replaces the monolith-compatible
report triggers with event-only variants. A shard therefore advances its local
watermark and event ledger without retaining the control projection. The
dispatcher remains default-off and no shard routing is enabled, so existing
report routes still use canonical `channel_reports` in the current database.

## Isolated dispatcher gate

The code now includes a hidden one-shot operator that claims at most ten events
for one explicit canary shard, one channel, and only the `channel_report`
aggregate. It requires write maintenance and refuses to run while the normal
scheduled dispatcher is enabled. SQLite integration coverage exercises report
insert, moderation update, deletion, retry, dead-letter, version ordering, and
cross-channel/aggregate isolation.

The operator is not configured or deployed in production. Its remote exercise
is a separate irreversible gate because the first processed event makes the
ordinary destination cleanup fail closed. See the
[report-dispatch exercise runbook](../operations/D1_CANARY_REPORT_DISPATCH_EXERCISE.md).

## Next implementation steps

1. With separate approval, run the isolated dispatcher exercise against a
   frozen canary and capture metadata-only evidence.
2. Only after shadow evidence is clean, switch global admin reads to the
   projection and route admin mutations back to the canonical shard.

Frozen canonical report copy and comparison are implemented behind the same
maintenance-only operator boundary as message and DM reconciliation. Batches
are capped at 40, exact destination conflicts fail closed, and completion
compares canonical counts/versions, control projection state, shard watermarks,
and required durable events.

## Tradeoffs and risks

- The control projection duplicates report text and reporter identifiers. This
  is necessary for a shard-independent admin inbox, but it increases sensitive
  data surface and requires the same access, retention, and deletion controls
  as the canonical report.
- Backfill temporarily increases storage and write volume in the monolith. It
  is bounded by report count, not message count, and must be measured before
  applying migration `0069` remotely.
- Channel name and owner are snapshots. Later channel metadata changes need a
  refresh event or the admin UI may show an older label; authorization must
  never rely on these projected snapshot fields.
- Cross-database delivery is eventually consistent. A newly submitted report
  may appear in the global inbox slightly later, while duplicate-report checks
  and canonical moderation remain shard-local and strongly consistent.
- The event path is wired but remains inactive without an explicitly enabled,
  allowlisted scheduled dispatcher. The one-shot route is separately secreted,
  maintenance-only, and channel-scoped. Applying only part of the sequence must
  not be treated as permission to route reports.

No migration, deployment, or production data movement is authorized by this
document.
