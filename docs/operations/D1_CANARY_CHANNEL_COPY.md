# D1 Canary Channel Copy

## Current scope

The mutation operator currently supports three commands:

1. `start`: run the full read-only preflight and create one version-pinned copy
   job on the destination canary.
2. `copy-channels`: copy only the canonical parent and optional `_live`
   `channels` rows in one destination D1 batch and advance the job stage.
3. `copy-policy-config`: copy one bounded batch from the current low-volume
   policy/config stage and persist its resume cursor on the destination.

The policy/config command covers moderators, blocks, banned words, channel
moderation, petitions, config, and upload tickets in that fixed dependency
order. It does not yet copy messages, DMs, reports, actor identities, pending
deletion state, gallery, links, search state, or any other manifest table. It
does not freeze writes, route traffic, enable shadow reads, dispatch projection
events, or clean up a failed partial copy.

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

Each successful response reports only the stage, status, batch count,
cumulative count for the current stage, and whether that stage has another
batch. It never returns copied row values.

Never place either secret in a URL or command argument. Supplying it through an
environment-backed header still requires shell-history and process inspection
controls appropriate to the operator host.

## State and idempotency

Bootstrap version 3 adds the bounded cursor fields to
`canary_channel_copy_jobs`. A job stores only:

- channel ID;
- source projection version captured by preflight;
- fixed stage and status;
- current channel/row cursor and an integer progress count;
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
repeated command after `upload_tickets_copied` is an idempotent no-op.

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
- A failed job may retain destination channel rows. There is intentionally no
  automatic cleanup yet because deleting the parent emits a delete projection
  event and requires an audited cleanup contract.
- `projection_source_version` covers canonical channel projection changes, not
  policy/config, message, or DM mutations. The bounded policy copy is therefore
  an initial backfill, not a consistent cutover snapshot. Final reconciliation
  and a short write freeze/delta copy remain mandatory.
- A pre-existing destination row or a concurrent operator call fails closed
  instead of overwriting private policy state. There is still no automated
  partial-copy cleanup.
- One command performs a bounded source read, a destination batch, and source
  version checks. This is acceptable for an offline operator path and never
  runs on normal user traffic, but it is not intended as a bulk message-copy
  mechanism.
- A successful canonical stage is not permission to configure shadow reads or
  routing. Continue only after the remaining manifest stages and verification
  gates exist.
