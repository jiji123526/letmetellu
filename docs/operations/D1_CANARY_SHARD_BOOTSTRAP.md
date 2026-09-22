# D1 canary Chat-shard bootstrap

This runbook prepares empty physical databases for the two-shard canary
described in
[D1 partitioning strategy](../architecture/D1_PARTITIONING_STRATEGY.md).
It does not move channels, enable routing, or activate the projection
dispatcher.

## Safety boundary

- Do not run the bootstrap file against `letsplay-db-prod-cutover-20260906-v3`
  or the rollback database `letsplay-db`.
- Do not add canary bindings to production `wrangler.toml` in the same change
  that creates or prepares the databases.
- Do not set `D1_CANARY_PROJECTION_DISPATCH_ENABLED=true` during bootstrap.
- Prepare and audit one canary database before creating the second.
- Stop if Phase 0 evidence and the explicit canary go/no-go gate have not been
  accepted.

The bootstrap SQL fails before changing triggers unless:

- `channels`, channel and report control projections, report projection
  watermarks, and `domain_events` are empty;
- all three channel and all three channel-report projection triggers exist;
  and
- all four domain-event ready, lease, delivered, and dead indexes exist;
- migration `0068` removed the `dm_replies.owner_uid -> users.id`
  cross-plane foreign key; and
- the shard-local `dm_replies -> dm` and `dm_replies -> channels` foreign keys
  remain present; and
- `dm_notification_owners` still has its migrated control-plane user foreign
  key and its two local DM/channel foreign keys before the overlay rebuilds it;
  and
- `message_notification_owners` still has its migrated control-plane user
  foreign key and its two local message/channel foreign keys before the overlay
  rebuilds it.

The script then records the `chat-canary` role and replaces the preparation
triggers with event-only triggers. Canonical channel and channel-report writes
advance their shard-local watermarks and append durable events, but never write
the local copies of `channel_control_projections` or
`channel_report_control_projections`.

## Prepare one database

Choose a new name that cannot be confused with the control database:

```bash
cd /home/jjiwoo/.workspace/letmetellu-d1-channel-db-abstraction/worker

CANARY_DB=letsplay-chat-canary-a
npx wrangler d1 create "$CANARY_DB"
```

Record the returned database ID in the private deployment change, but do not
add it to production bindings yet.

Apply every repository migration through `0070`:

> D1 records migrations by the complete filename, not only by the numeric
> prefix. The repository intentionally contains both
> `0064_blocked_entry_mode.sql` and
> `0064_channel_control_projections.sql`. Do not renumber either file after a
> remote database has recorded it; renaming would make Wrangler treat the same
> schema change as a new pending migration. Confirm the complete pending-name
> list before every apply.

```bash
npx wrangler d1 migrations apply "$CANARY_DB" --remote
```

Immediately rerun `d1 migrations list` and require `No migrations to apply`
before applying the Chat-shard overlay.

Apply the one-time Chat-shard overlay:

```bash
npx wrangler d1 execute "$CANARY_DB" --remote \
  --file scripts/bootstrap-canary-chat-shard.sql
```

Run the read-only audit:

```bash
npx wrangler d1 execute "$CANARY_DB" --remote \
  --file scripts/audit-canary-chat-shard.sql
```

## Required empty-shard audit result

- `PRAGMA quick_check` returns `ok`.
- `PRAGMA foreign_key_check` returns no rows.
- `dm_replies` lists foreign keys only to `channels` and `dm`, not `users`.
- `chat_shard_metadata` reports role `chat-canary` and bootstrap version `11`.
- `dm_notification_owners` retains foreign keys to local `dm` and `channels`
  but no longer references the control-plane `users` table.
- `message_notification_owners` retains foreign keys to local `messages` and
  `channels` but no longer references the control-plane `users` table.
- `canary_channel_copy_jobs`, its bounded cursor, message-snapshot/progress
  columns, its status/update index, and the cleanup audit table/index are
  present and empty. The message and DM reconciliation seen tables are also
  present and empty, together with the notification and channel-report
  reconciliation seen tables.
- All listed tables and indexes are present.
- Each of the six channel and channel-report projection triggers reports:
  - `emits_domain_events = 1`;
  - `advances_watermark = 1`;
  - `writes_local_projection = 0`.
- `local_projection_rows = 0`.
- `local_report_projection_rows = 0` and
  `local_report_watermark_rows = 0`.
- `active_channels_missing_watermark = 0`.
- No domain-event backlog is present before channel copy testing.

If any condition fails, do not repair the database in place. Preserve the
output, delete only the newly created canary database after review, and repeat
from a fresh database.

## Second database and next gate

Repeat the same process with a distinct name such as
`letsplay-chat-canary-b`. After both empty shards pass:

1. add their IDs only to an isolated canary Worker configuration;
2. keep dispatcher and channel routing disabled;
3. configure and run the
   [read-only reconciliation operator](./D1_CANARY_PROJECTION_RECONCILIATION.md);
4. implement a static shadow-read allowlist;
5. select low-risk channels only after the copy and rollback procedure is
   reviewed.

Physical creation alone does not authorize channel migration or production
deployment from the feature branch.
