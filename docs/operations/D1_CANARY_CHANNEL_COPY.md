# D1 Canary Channel Copy

## Current scope

The mutation operator currently supports two commands:

1. `start`: run the full read-only preflight and create one version-pinned copy
   job on the destination canary.
2. `copy-channels`: copy only the canonical parent and optional `_live`
   `channels` rows in one destination D1 batch and advance the job stage.

It does not yet copy messages, DMs, moderation state, config, upload tickets,
gallery, links, search state, or any other manifest table. It does not freeze
writes, route traffic, enable shadow reads, dispatch projection events, or
clean up a failed partial copy.

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

Never place either secret in a URL or command argument. Supplying it through an
environment-backed header still requires shell-history and process inspection
controls appropriate to the operator host.

## State and idempotency

Bootstrap version 2 adds `canary_channel_copy_jobs`. A job stores only:

- channel ID;
- source projection version captured by preflight;
- fixed stage and status;
- creation and update timestamps.

Repeated `start` before data copy returns the same matching job. Repeated
`copy-channels` after a completed canonical stage returns success without
inserting duplicate channel rows.

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
  message or DM mutations. Later stages need their own cursor/count validation
  and a final write freeze.
- A successful canonical stage is not permission to configure shadow reads or
  routing. Continue only after the remaining manifest stages and verification
  gates exist.
