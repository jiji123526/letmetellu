# D1 canary channel-report reconciliation

This gate copies frozen canonical channel reports into one prepared Chat
canary and verifies the report event/control-projection boundary. It follows
notification manifest verification and does not enable routing or projection
dispatch.

## Safety requirements

- Global HTTP and scheduled writes remain paused.
- `D1_CANARY_PROJECTION_DISPATCH_ENABLED` remains disabled.
- The dedicated finalize secret is present only in the isolated operator
  environment.
- The copy job is active at `delta_notification_manifest_verified`.
- The source channel projection version is unchanged and no deletion Undo is
  active.
- The destination is fresh Chat-canary bootstrap version `11`.

The operator response contains only counts, stages, and fixed blocker codes.
It never returns reporter identities, device IDs, reasons, details, resolution
notes, or inbox-message IDs.

## Reconcile frozen reports

Repeatedly call the internal message-delta operator with:

```json
{
  "action": "reconcile-channel-reports",
  "shard": "canary-a",
  "channel": "example-channel"
}
```

Each call reads at most 41 source rows and processes at most 40. Before any
insert, an existing destination row with the same report ID is compared field
for field. An exact retry is accepted; a conflict fails the copy instead of
overwriting moderation evidence. Missing rows are inserted with their source
version, causing the event-only Chat-shard trigger to atomically create its
active watermark and durable projection event.

After source scanning, stale destination reports absent from the frozen source
seen set are deleted in batches of at most 40. Continue until:

```json
{
  "stage": "delta_channel_reports_copied",
  "status": "active",
  "hasMore": false
}
```

## Complete and verify

Call:

```json
{
  "action": "complete-channel-reports",
  "shard": "canary-a",
  "channel": "example-channel"
}
```

Completion verifies:

- source and destination report counts match;
- the sum of canonical report source versions matches;
- every source canonical report matches its control projection and active
  source watermark;
- every destination report matches its active destination watermark;
- every destination report has the corresponding versioned durable upsert
  event;
- the Chat shard contains no local report control projection;
- the channel projection version and deletion-Undo safety state remain valid.

Success records `delta_channel_reports_verified`, deletes the temporary seen
set for that channel, and leaves the job active. It does not mark the channel
movable.

## Failure and rollback behavior

- A source-version change or active Undo marks the job failed.
- A conflicting destination report marks the job failed without overwriting
  either copy.
- Integrity mismatch returns fixed blocker codes and leaves evidence intact for
  inspection.
- A failed or explicitly abandoned copy can use the existing cleanup operator.
  Cleanup removes reports, report watermarks, pending report events, and the
  temporary seen set before deleting copied channels.
- A processed event still blocks destructive cleanup.

## Tradeoffs

- Frozen reconciliation adds operator round trips proportional to report
  count, but channel reports are expected to be much smaller than message
  history and each batch is bounded.
- The Worker temporarily handles sensitive report rows to copy and compare
  them. Values never enter operator responses or audit output.
- Count and version totals are not a cryptographic dataset digest. Exact
  conflict comparison, a fresh-empty destination precondition, bounded full
  source traversal, stale-row pruning, and projection/watermark checks provide
  the current canary guarantee. A privacy-preserving digest can be added later
  if production evidence requires it.
- Report visibility in the future global admin inbox is eventually consistent
  after sharding. Canonical report creation and moderation remain strongly
  consistent in the selected Chat shard.

No command in this runbook may be executed against production without a
separate production-change review.

After successful verification, the next gate is the
[isolated report-dispatch exercise](D1_CANARY_REPORT_DISPATCH_EXERCISE.md).
Its first processed event prevents ordinary automated copy cleanup, so it
requires a separate change review rather than following automatically.
