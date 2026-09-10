# D1 Canary Channel Copy Preflight

## Purpose

The copy preflight inventories one low-risk parent channel before any data is
written to a canary Chat shard. It is read-only. A clean result does not copy
data, activate shadow reads, enable projection dispatch, or change routing.

The route is unavailable unless the isolated Worker has:

- the selected `CHAT_DB_CANARY_A` or `CHAT_DB_CANARY_B` binding;
- the same dedicated `D1_CANARY_OPERATOR_TOKEN` used by reconciliation; and
- a canary database bootstrapped after migrations through `0068`.

It is not authorized by browser identity, platform-admin UI state, or
`INTERNAL_SECRET`.

## Request

Keep the secret in an environment variable and send it as a header:

```bash
export D1_CANARY_OPERATOR_TOKEN
CANARY_WORKER_URL=https://isolated-canary-worker.example
CHANNEL_ID=low-risk-channel

curl --fail-with-body --get \
  "$CANARY_WORKER_URL/internal/d1-canary/copy-preflight" \
  -H "X-Canary-Operator-Token: $D1_CANARY_OPERATOR_TOKEN" \
  --data-urlencode "shard=canary-a" \
  --data-urlencode "channel=$CHANNEL_ID"
```

Do not put the token in the URL, shell history, source, browser proxy, or
production Wrangler variables.

## Manifest

The preflight counts the parent and `_live` scope for:

- canonical channels, moderators, messages, blocks, DMs, and DM replies;
- gallery and message-link projections;
- channel config and banned words;
- upload tickets;
- channel reports, moderation, and petitions;
- actor-identity records;
- pending admin-delete undo records.

Notification preferences, subscriptions, outbox rows, account rows, control
projections, source domain events, and cleanup-job history are not copy
payloads. Gallery, FTS, and some link state will need explicit derived-state
handling in the bounded copy implementation rather than blind duplication.

## Result

`200` means:

- the source parent exists;
- the destination has valid canary metadata;
- every manifest table is empty for the selected channel;
- no incomplete channel cleanup, pending admin undo, or pending upload exists.

`409` returns one or more fixed blocker codes:

- `source_channel_missing`;
- `destination_not_bootstrapped`;
- `destination_not_empty`;
- `source_cleanup_active`;
- `source_undo_active`;
- `source_upload_pending`.

`400` covers malformed IDs, unknown shards, and the reports channel. `404`
hides the route when the dedicated secret is absent or wrong. `503` covers a
missing, aliased, or unavailable canary binding.

The response contains table counts and the source projection version, but no
message text, DM text, owner ID, passcode, event payload, or media URL. Counts
are still private operational metadata and must not be exposed through a
browser route.

## Cost and limitations

- Source checks and counts use one read-only D1 batch; destination metadata and
  counts use one read-only D1 batch. The two databases are read concurrently.
- Counts are a point-in-time observation. They do not freeze writes and cannot
  prove that messages remain unchanged after the response.
- A clean preflight authorizes only the next reviewed copy step. Final delta
  copy still requires a write freeze and source-version/count reconciliation.
- Existing destination rows fail closed rather than being overwritten. Cleanup
  after a partial copy must be an explicit, separately authorized operation.
