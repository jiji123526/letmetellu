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

## Implemented foundation

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

Nothing currently calls the event parser or writer. Existing report routes
still use `channel_reports`, so adding this code alone changes no runtime path.

## Next implementation steps

1. Add same-transaction canonical report triggers or explicit write batches
   that increment the report source version and append a shard-local domain
   event.
2. Extend the bounded domain-event consumer to dispatch report events to the
   new strict parser and control writer without treating them as invalid
   channel-projection events.
3. Replace same-database projection writes with event-only behavior in the Chat
   shard bootstrap while preserving monolith compatibility.
4. Reconcile and copy frozen canonical report rows into a canary Chat shard.
5. Compare canonical report versions and control projection watermarks.
6. Only after shadow evidence is clean, switch global admin reads to the
   projection and route admin mutations back to the canonical shard.

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
- The schema and writer are deliberately unused until the producer, consumer,
  reconciliation, and rollout gates exist. Applying only part of the sequence
  must not be treated as permission to route reports.

No migration, deployment, or production data movement is authorized by this
document.
