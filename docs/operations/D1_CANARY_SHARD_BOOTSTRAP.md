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

- `channels`, `channel_control_projections`, and `domain_events` are empty;
- all three repository projection triggers exist; and
- all four domain-event ready, lease, delivered, and dead indexes exist.

The script then records the `chat-canary` role and replaces the preparation
triggers with event-only triggers. Canonical channel writes advance the
shard-local watermark and append a durable event, but never write the local
copy of `channel_control_projections`.

## Prepare one database

Choose a new name that cannot be confused with the control database:

```bash
cd /home/jjiwoo/.workspace/letmetellu-d1-channel-db-abstraction/worker

CANARY_DB=letsplay-chat-canary-a
npx wrangler d1 create "$CANARY_DB"
```

Record the returned database ID in the private deployment change, but do not
add it to production bindings yet.

Apply every repository migration through `0067`:

```bash
npx wrangler d1 migrations apply "$CANARY_DB" --remote
```

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
- `chat_shard_metadata` reports role `chat-canary` and bootstrap version `1`.
- All eight listed tables and indexes are present.
- Each of the three projection triggers reports:
  - `emits_domain_events = 1`;
  - `advances_watermark = 1`;
  - `writes_local_projection = 0`.
- `local_projection_rows = 0`.
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
