# D1 canary notification ownership manifest

This gate reconciles the last channel-local notification routing table and
proves that account-global notification state was not copied into a Chat
shard. It runs only after frozen DM verification and does not authorize
routing or mark the copy job complete.

## Ownership decision

Chat-shard canonical state:

- `message_notification_owners`: resolves the authenticated owner of a message
  when a reply is written;
- `dm_notification_owners`: resolves the authenticated owner of a private DM.

Control-only state:

- `notification_preferences`;
- `push_subscriptions`;
- `notification_outbox`;
- `user_recent_channels`;
- `cleanup_jobs`.

The two channel-local tables retain opaque account IDs but do not enforce a
foreign key to `users`, because that table is authoritative in control D1.
They retain their local message/DM and channel foreign keys. Notification
preference lookup, subscription fanout, delivery retry, account recents, and
cross-resource cleanup orchestration remain outside ordinary Chat-shard reads.

`channel_reports` is not part of this notification manifest. A channel report
is channel-local evidence but also feeds a platform-wide moderation inbox. It
needs a durable event and control projection before its ownership can be split
safely; blindly copying it would create two writable report authorities.

## Safety requirements

All requirements from the frozen message and DM runbooks remain mandatory:

- global HTTP and scheduled writes are paused;
- projection dispatch is disabled;
- the dedicated finalize secret is present;
- the source projection version is unchanged;
- no pending admin-deletion Undo row exists;
- the destination is a bootstrap-version-11 empty Chat canary.

The route returns only counts, progress, and fixed blocker codes. It never
returns message IDs, user IDs, endpoints, notification payloads, or report
content.

## Operator sequence

After `complete-dm` returns `stage: delta_dm_verified`, repeatedly call:

```json
{
  "action": "reconcile-notification-owners",
  "shard": "canary-a",
  "channel": "example-channel"
}
```

Each call processes at most 40 owner rows. Source rows are upserted using the
stable `(created_at, message_id)` cursor, and destination rows absent from the
frozen source are pruned in bounded batches. Continue until the response is:

```json
{
  "stage": "delta_message_notification_owners_copied",
  "status": "active",
  "hasMore": false
}
```

Then call:

```json
{
  "action": "complete-notification-manifest",
  "shard": "canary-a",
  "channel": "example-channel"
}
```

Completion checks:

- source and destination message-owner counts match;
- every destination owner row references a local message;
- no channel-associated preference, outbox, recent-channel, or cleanup-job row
  exists in the Chat shard;
- the source version and Undo safety state still match.

Success records `stage: delta_notification_manifest_verified` while leaving
`status: active`. Continue with
[channel-report reconciliation](./D1_CANARY_CHANNEL_REPORT_RECONCILIATION.md).
Upload-ticket final state, policy delta, final integrity audit, smoke testing,
routing, and rollback gates still remain.

## Tradeoffs

- Frozen reconciliation is linear in authenticated message-owner rows and adds
  operator round trips, but avoids an always-on cross-database dual write.
- Removing the `users` foreign key permits an opaque stale account ID inside a
  Chat shard. Local message/channel integrity remains enforced, and the control
  notification consumer must continue validating account existence.
- Count and orphan checks do not compare each user ID independently. The
  bounded upsert reads every frozen source row, and final count equality catches
  missing or extra rows; a later audit can add privacy-preserving hashes if
  evidence shows a need.
- Keeping preferences and outbox in control avoids duplicating browser secrets
  and delivery leases, but future notification production must cross the
  boundary through durable shard events rather than a synchronous dual write.

No command in this runbook may be executed against production without a
separate production-change review.
