# D1 canary frozen message reconciliation

This operator closes message changes that occurred after the initial channel
copy. It is the only message reconciliation stage allowed to mark a copy job
`complete`. It does not copy DMs, reports, or other later manifest families and
does not authorize routing by itself.

## Mandatory safety state

- Use an isolated canary Worker and a dedicated 32–256 character
  `D1_CANARY_FINALIZE_TOKEN` secret.
- `WRITE_MAINTENANCE_MODE` must be exactly `true`. The Worker rejects every
  ordinary HTTP mutation and skips scheduled work while this flag is active.
- Canary projection dispatch must remain disabled.
- Do not enable maintenance mode, deploy the finalize route, or run these
  commands without an approved production change window. Those actions affect
  production; the code existing on a feature branch does not.
- Keep the source DB unchanged and retain the failed-copy cleanup path.

The main maintenance guard has one exact exception for
`/internal/d1-canary/message-delta`. That route authenticates with the finalize
secret before reading either database. The secret is absent from browser CORS,
frontend proxies, and production `wrangler.toml`.

## Reconciliation model

1. `start` pins the newest current source `(created_at, id)` boundary after
   maintenance is active and clears the destination seen set.
2. `reconcile` upserts roots first, then replies, in batches of at most 40.
   Every upsert and its seen marker commit in the same destination D1 batch.
3. `reconcile` then removes destination messages that were not seen in the
   frozen source. This catches hard deletions as well as refreshing edits,
   reactions, reports, soft-deletion state, media metadata, and newly inserted
   messages.
4. The final prune clears destination message actors and link rows.
5. `rebuild-dependents` recopies current message actors and rebuilds links from
   destination canonical text in existing bounded batches. Message triggers
   refresh gallery and FTS during the upsert pass.
6. `complete` reruns aggregate actor/gallery/link/FTS verification, checks the
   source version and active deletion-undo state again, and only then marks the
   copy job complete.

The destination-only `canary_message_reconciliation_seen` table prevents a
large in-memory ID set and makes missing-source deletion deterministic. It is
cleared after pruning and by failed-copy cleanup.

## Commands

```bash
export D1_CANARY_FINALIZE_TOKEN
CANARY_WORKER_URL=https://isolated-canary-worker.example
CHANNEL_ID=low-risk-channel

curl --fail-with-body \
  "$CANARY_WORKER_URL/internal/d1-canary/message-delta" \
  -H "Content-Type: application/json" \
  -H "X-Canary-Finalize-Token: $D1_CANARY_FINALIZE_TOKEN" \
  --data "{\"action\":\"start\",\"shard\":\"canary-a\",\"channel\":\"$CHANNEL_ID\"}"
```

Repeat `reconcile` until the returned stage is `delta_messages_copied`:

```bash
curl --fail-with-body \
  "$CANARY_WORKER_URL/internal/d1-canary/message-delta" \
  -H "Content-Type: application/json" \
  -H "X-Canary-Finalize-Token: $D1_CANARY_FINALIZE_TOKEN" \
  --data "{\"action\":\"reconcile\",\"shard\":\"canary-a\",\"channel\":\"$CHANNEL_ID\"}"
```

Repeat `rebuild-dependents` until the stage is `delta_links_rebuilt`, then run
`complete` once:

```bash
curl --fail-with-body \
  "$CANARY_WORKER_URL/internal/d1-canary/message-delta" \
  -H "Content-Type: application/json" \
  -H "X-Canary-Finalize-Token: $D1_CANARY_FINALIZE_TOKEN" \
  --data "{\"action\":\"rebuild-dependents\",\"shard\":\"canary-a\",\"channel\":\"$CHANNEL_ID\"}"

curl --fail-with-body \
  "$CANARY_WORKER_URL/internal/d1-canary/message-delta" \
  -H "Content-Type: application/json" \
  -H "X-Canary-Finalize-Token: $D1_CANARY_FINALIZE_TOKEN" \
  --data "{\"action\":\"complete\",\"shard\":\"canary-a\",\"channel\":\"$CHANNEL_ID\"}"
```

Do not disable maintenance merely because `complete` succeeded. DM/report
copy, full manifest verification, routing configuration, smoke tests, and the
rollback decision must be completed in the approved cutover procedure first.

## Tradeoffs

- The frozen pass rereads and upserts every message in the channel. Its cost is
  linear in channel history and unchanged rows still trigger FTS/gallery write
  work. Forty-row batches bound transaction size and D1 statement count at the
  cost of more operator calls.
- A short global write pause is required because messages have no general
  mutation sequence covering edits, reactions, and hard deletions. Adding a
  permanent mutation journal could avoid the full rescan later, but would add
  write amplification and another retention/consistency subsystem.
- Root-first ordering preserves reply foreign keys. The seen table adds one
  destination write per source message, but prevents an unbounded Worker memory
  set and detects hard-deleted source rows safely.
- A complete message stage is not a complete channel cutover. DMs, reports,
  notifications, uploads created before maintenance, and policy deltas retain
  their own explicit gates.
