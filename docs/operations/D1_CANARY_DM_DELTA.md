# D1 canary frozen DM reconciliation

This stage copies the channel's private DM roots, owner replies, actor identity
records, and DM notification ownership while ordinary writes are frozen. It is
deliberately part of finalization rather than the online initial backfill, so
there is no gap between a pre-copy snapshot and the final source state.

## Safety and privacy boundary

- Begin only after message `complete` returns
  `stage: delta_dm_roots_upserting` and `status: active`.
- Keep `WRITE_MAINTENANCE_MODE=true` and canary projection dispatch disabled.
- Use only the dedicated `D1_CANARY_FINALIZE_TOKEN`; browser, user, platform
  admin, copy, cleanup, and read-only operator credentials do not authorize it.
- Responses contain stage names, counts, booleans, and fixed blocker codes.
  They never return DM text, nicknames, sender IDs, device hashes, owner IDs,
  media paths, or notification user IDs.
- Do not deploy, enable maintenance, mutate a remote D1 database, or route
  traffic without an approved production change window.

## Bounded order

Every `reconcile-dm` call reads at most 41 rows and writes at most 40 canonical
or dependent rows:

1. Upsert DM roots in `(created_at, id)` order.
2. Upsert owner replies only after all roots exist.
3. Delete destination replies absent from the frozen source seen set.
4. Delete destination roots absent from the frozen source seen set.
5. Clear and recopy `record_type = 'dm'` actor identities.
6. Clear and recopy `dm_notification_owners`.
7. Enter `delta_dm_dependents_copied`, ready for explicit verification.

Canonical upserts include idempotency IDs, anonymous/authenticated identity,
text and media metadata, pending-delete state, and `activity_at`. Root and reply
seen markers commit in the same destination batch as their canonical rows.
The destination-only seen set is cleared by successful completion and by the
audited failed-copy cleanup path.

The final verification compares source and destination counts for roots,
replies, DM actors, and notification owners. It also rejects orphaned
dependents and verifies each destination root's `activity_at` equals the latest
of its creation time and reply times. Active server-backed deletion Undo or a
changed source channel version fails closed.

## Commands

Repeat until the stage is `delta_dm_dependents_copied`:

```bash
curl --fail-with-body \
  "$CANARY_WORKER_URL/internal/d1-canary/message-delta" \
  -H "Content-Type: application/json" \
  -H "X-Canary-Finalize-Token: $D1_CANARY_FINALIZE_TOKEN" \
  --data "{\"action\":\"reconcile-dm\",\"shard\":\"canary-a\",\"channel\":\"$CHANNEL_ID\"}"
```

Then verify and complete:

```bash
curl --fail-with-body \
  "$CANARY_WORKER_URL/internal/d1-canary/message-delta" \
  -H "Content-Type: application/json" \
  -H "X-Canary-Finalize-Token: $D1_CANARY_FINALIZE_TOKEN" \
  --data "{\"action\":\"complete-dm\",\"shard\":\"canary-a\",\"channel\":\"$CHANNEL_ID\"}"
```

`stage: delta_dm_verified` with `status: active` means the implemented
canonical, policy, message, and DM families agree at this frozen point. The job
deliberately remains active because report state, remaining
notification/control ownership, final manifest audit, smoke testing, and
rollback gates remain.

## Tradeoffs

- Frozen-only DM copy extends the write-maintenance window linearly with DM
  history. In exchange, it avoids a permanent mutation journal and eliminates
  the race between an online DM snapshot and final cutover.
- Forty-row batches and parent-first ordering reduce D1 transaction pressure
  and preserve foreign keys, but require more operator round trips.
- `dm_notification_owners.user_id` is account identity. The Chat-shard overlay
  removes only its impossible cross-database foreign key; it retains local
  foreign keys to `dm` and `channels` and preserves the opaque user ID used for
  notification routing. User existence remains authoritative in control D1.
- Notification outbox deliveries and subscriptions are control-plane state and
  are not copied by this stage.
