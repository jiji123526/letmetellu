# D1 Canary Channel Copy

## Current scope

The copy mutation operator currently supports five commands:

1. `start`: run the full read-only preflight and create one version-pinned copy
   job on the destination canary.
2. `copy-channels`: copy only the canonical parent and optional `_live`
   `channels` rows in one destination D1 batch and advance the job stage.
3. `copy-policy-config`: copy one bounded batch from the current low-volume
   policy/config stage and persist its resume cursor on the destination.
4. `copy-messages`: pin one source-history boundary, copy at most 50 canonical
   messages, and persist the source cursor in the same destination batch.
5. `copy-message-dependents`: copy at most 100 message actor identities or
   rebuild at most 100 link-index rows from copied canonical message text.

The policy/config command covers moderators, blocks, banned words, channel
moderation, petitions, config, and upload tickets in that fixed dependency
order. The message commands now copy canonical rows, then message actor
identities, and rebuild link rows from copied message text. They do not yet
copy DMs, reports, pending deletion state, or any other remaining manifest
table. Gallery and FTS rows are produced by destination message triggers and
checked by a separate read-only verification route. The operator
does not freeze writes, route traffic, enable shadow reads, dispatch projection
events. A separate cleanup operator can abandon and remove a failed partial
copy under a stricter authorization boundary.

Do not use this operator on a remote database until all later manifest stages
and explicit partial-copy cleanup are implemented and reviewed.

## Security boundary

The mutation route requires a dedicated `D1_CANARY_COPY_TOKEN` between 32 and
256 characters, presented only as `X-Canary-Copy-Token`.

- The read-only operator token does not authorize copy mutations.
- `INTERNAL_SECRET`, browser identity, channel ownership, and platform-admin UI
  state do not authorize copy mutations.
- The header is not in browser CORS allowances and no frontend proxy exists.
- Production `wrangler.toml` contains neither this secret nor canary bindings.
- Request bodies are limited to 1 KB and must contain exactly `action`,
  `shard`, and `channel`.
- The reports channel and malformed channel or shard IDs are rejected.
- Any environment with canary projection dispatch enabled is rejected before
  database access.

The destination receives canonical private channel settings, including the
passcode hash, notice, and channel asset paths. Treat canary database access as
production-sensitive. These values are never returned or logged by the
operator.

## Commands

Use only an isolated canary Worker after a clean preflight:

```bash
export D1_CANARY_COPY_TOKEN
CANARY_WORKER_URL=https://isolated-canary-worker.example
CHANNEL_ID=low-risk-channel

curl --fail-with-body \
  "$CANARY_WORKER_URL/internal/d1-canary/copy" \
  -H "Content-Type: application/json" \
  -H "X-Canary-Copy-Token: $D1_CANARY_COPY_TOKEN" \
  --data "{\"action\":\"start\",\"shard\":\"canary-a\",\"channel\":\"$CHANNEL_ID\"}"
```

Only after `start` returns `stage: prepared`, the canonical stage is:

```bash
curl --fail-with-body \
  "$CANARY_WORKER_URL/internal/d1-canary/copy" \
  -H "Content-Type: application/json" \
  -H "X-Canary-Copy-Token: $D1_CANARY_COPY_TOKEN" \
  --data "{\"action\":\"copy-channels\",\"shard\":\"canary-a\",\"channel\":\"$CHANNEL_ID\"}"
```

After the canonical command returns `stage: channels_copied`, repeat the
policy/config command until it returns `stage: upload_tickets_copied` and
`hasMore: false`:

```bash
curl --fail-with-body \
  "$CANARY_WORKER_URL/internal/d1-canary/copy" \
  -H "Content-Type: application/json" \
  -H "X-Canary-Copy-Token: $D1_CANARY_COPY_TOKEN" \
  --data "{\"action\":\"copy-policy-config\",\"shard\":\"canary-a\",\"channel\":\"$CHANNEL_ID\"}"
```

After `upload_tickets_copied`, repeat the message command until it returns
`stage: messages_copied` and `hasMore: false`:

```bash
curl --fail-with-body \
  "$CANARY_WORKER_URL/internal/d1-canary/copy" \
  -H "Content-Type: application/json" \
  -H "X-Canary-Copy-Token: $D1_CANARY_COPY_TOKEN" \
  --data "{\"action\":\"copy-messages\",\"shard\":\"canary-a\",\"channel\":\"$CHANNEL_ID\"}"
```

After `messages_copied`, repeat the dependent command until it returns
`stage: message_links_rebuilt` and `hasMore: false`:

```bash
curl --fail-with-body \
  "$CANARY_WORKER_URL/internal/d1-canary/copy" \
  -H "Content-Type: application/json" \
  -H "X-Canary-Copy-Token: $D1_CANARY_COPY_TOKEN" \
  --data "{\"action\":\"copy-message-dependents\",\"shard\":\"canary-a\",\"channel\":\"$CHANNEL_ID\"}"
```

Use the distinct read-only operator token to verify actor counts and derived
state after the dependent stage:

```bash
curl --fail-with-body \
  "$CANARY_WORKER_URL/internal/d1-canary/copy-verify?shard=canary-a&channel=$CHANNEL_ID" \
  -H "X-Canary-Operator-Token: $D1_CANARY_OPERATOR_TOKEN"
```

Each successful response reports only the stage, status, batch count,
cumulative count for the current stage, and whether that stage has another
batch. It never returns copied row values.

Never place either secret in a URL or command argument. Supplying it through an
environment-backed header still requires shell-history and process inspection
controls appropriate to the operator host.

## State and idempotency

Bootstrap version 6 adds the dependent stages and cleanup audit to the existing message snapshot
and timestamp cursor fields in
`canary_channel_copy_jobs`. A job stores only:

- channel ID;
- source projection version captured by preflight;
- fixed stage and status;
- current channel/timestamp/row cursor and an integer progress count;
- the immutable upper `(created_at, id)` boundary for the initial message pass;
- creation and update timestamps.

Repeated `start` before data copy returns the same matching job. Repeated
`copy-channels` after a completed canonical stage returns success without
inserting duplicate channel rows.

`copy-policy-config` selects no more than 101 source rows, writes at most 100,
and uses the extra row only to report `hasMore`. The cursor is the deterministic
`(channel_id, stage-specific primary key)` pair. Row inserts and cursor/stage
advancement share one destination D1 batch, so a successful call is resumable
without rereading earlier batches. The stage order and explicit column
contracts are:

1. `moderators(channel_id, uid, role, created_at)`;
2. `blocked(id, uid, reason, fingerprint, channel_id, created_at, device_id)`;
3. `banned_words(id, word, channel_id, expires, created_at)`;
4. `channel_moderation(channel_id, status, warning_sent_at,
   warned_report_count, suspension_notice_sent_at, suspension_reason,
   frozen_at, frozen_by, petition_status, current_petition_id, updated_at)`;
5. `channel_petitions(id, channel_id, owner_uid, text, status, created_at,
   resolved_at, resolved_by, resolution_note, inbox_message_id)`;
6. `config(id, text, channel_id, updated_at)`;
7. `upload_tickets(id, key, channel_id, uid, auth_uid, purpose, ip_hash,
   status, attached_record_id, attached_record_type, created_at, expires_at)`.

Advancing into the next stage clears the cursor and its progress counter. A
repeated policy command after `upload_tickets_copied` is an idempotent no-op.

The first `copy-messages` call pins the newest existing `(created_at, id)` from
the parent and optional live channel. Messages created after that boundary are
not allowed to extend the initial pass indefinitely. Root messages are copied
first in `(created_at, id)` order; only after every root is committed does the
job copy replies in the same order. This preserves the current root-only reply
foreign-key dependency. Each call reads at most 51 rows and writes at most 50
message rows plus one cursor update. The message inserts and cursor advancement
share one destination batch, making an ambiguous retry safe.

`copy-message-dependents` first selects only `record_type = 'message'` actor
rows whose canonical messages fall inside the pinned snapshot. After all actor
rows are committed, it scans the destination messages and rebuilds
`message_links` using the same `http://`, `https://`, and `www.` contract as
normal message writes. It never trusts or copies the source link table. Both
sub-stages use at most 101 selected rows, at most 100 inserted rows, and the
same atomic cursor advancement contract.

The GET-only `copy-verify` route compares source/destination actor counts and
checks destination gallery, link, and FTS relationships. It returns aggregate
counts and fixed blocker codes only; no message text, actor identity, device
hash, link URL, or media path is selected into the response.

The canonical stage requires the current source row version to equal the job
version before writing. Parent/live inserts and job-stage advancement share one
destination D1 batch. A second source-version read runs afterward; if it
detects a change, the job is marked failed and routing remains unchanged.

## Failure behavior and limitations

- Cross-D1 reads and writes cannot be one transaction. Source data can change
  immediately after the post-copy check. This stage is initial backfill only,
  not a cutover snapshot.
- Inserting the parent row creates a pending canary projection event through
  the shard trigger. Keep dispatcher activation disabled until copy and
  reconciliation procedures explicitly permit it.
- A failed job retains destination rows until an operator uses the separately
  authorized abandon/cleanup protocol below. Cleanup is never automatic.
- `projection_source_version` covers canonical channel projection changes, not
  policy/config, message, or DM mutations. The bounded policy copy is therefore
  an initial backfill, not a consistent cutover snapshot. Final reconciliation
  and a short write freeze/delta copy remain mandatory.
- The pinned message boundary excludes ordinary later inserts, but it does not
  capture edits, reactions, reports, soft deletion, or a same-timestamp late
  insert that sorts below the boundary. A later delta/reconciliation contract
  and final write freeze remain mandatory before routing.
- Active server-backed admin deletion undo fails and permanently marks the copy
  job failed. It is safer to restart from a clean destination than to copy a
  transient mixture of previous and pending deletion states.
- Destination message triggers build FTS and gallery rows as canonical messages
  arrive. Actor rows and link rows now have bounded stages, while a clean
  read-only verification is still only a point-in-time prerequisite—not a
  completed cutover gate.
- A pre-existing destination row or a concurrent operator call fails closed
  instead of overwriting private policy state.
- One command performs bounded source reads, a destination batch, and source
  safety checks. This is acceptable for an offline operator path and never runs
  on normal user traffic. Fifty-row message batches deliberately favor bounded
  D1 write and trigger cost over maximum copy throughput.
- A successful canonical stage is not permission to configure shadow reads or
  routing. Continue only after the remaining manifest stages and verification
  gates exist.

## Failed partial-copy cleanup

Cleanup uses a third secret, `D1_CANARY_CLEANUP_TOKEN`, sent only in the
`X-Canary-Cleanup-Token` header to the hidden POST-only
`/internal/d1-canary/copy-cleanup` route. The copy and read-only operator
tokens do not authorize it. The secret is intentionally absent from production
configuration and browser CORS allowances.

An active copy must first be explicitly abandoned using the exact source
projection version returned by preflight:

```bash
export D1_CANARY_CLEANUP_TOKEN
SOURCE_PROJECTION_VERSION=123

curl --fail-with-body \
  "$CANARY_WORKER_URL/internal/d1-canary/copy-cleanup" \
  -H "Content-Type: application/json" \
  -H "X-Canary-Cleanup-Token: $D1_CANARY_CLEANUP_TOKEN" \
  --data "{\"action\":\"abandon\",\"shard\":\"canary-a\",\"channel\":\"$CHANNEL_ID\",\"sourceProjectionVersion\":$SOURCE_PROJECTION_VERSION}"
```

Only a failed or explicitly abandoned job can then be cleaned:

```bash
curl --fail-with-body \
  "$CANARY_WORKER_URL/internal/d1-canary/copy-cleanup" \
  -H "Content-Type: application/json" \
  -H "X-Canary-Cleanup-Token: $D1_CANARY_CLEANUP_TOKEN" \
  --data "{\"action\":\"cleanup\",\"shard\":\"canary-a\",\"channel\":\"$CHANNEL_ID\",\"sourceProjectionVersion\":$SOURCE_PROJECTION_VERSION}"
```

Cleanup rejects active projection dispatch, a channel present in the shadow
allowlist, an invalid shadow configuration, any locally written control
projection, any already processed projection event, and any channel data from
later unsupported copy stages. The supported partial-copy rows, the channel
rows, the delete event emitted by the channel trigger, its local watermark,
and the copy job are removed in one destination D1 batch. A non-sensitive
audit row is retained, making an ambiguous retry idempotent without retaining
private copied content.

This operation deletes only the isolated destination copy. It never mutates
the source/control database. Do not deploy the route, create its secret, or run
either command without a separate production-change review.
