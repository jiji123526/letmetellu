# D1 canary projection reconciliation

This runbook executes the bounded, read-only comparison between one canary Chat
shard and the control database. It does not read domain-event payloads and
cannot repair either database.

## Security boundary

- Use only an isolated canary Worker configuration with an explicit canary D1
  binding.
- Store `D1_CANARY_OPERATOR_TOKEN` as a Wrangler secret, never as a `[vars]`
  value, shell history entry, browser value, or repository file.
- Use a randomly generated token between 32 and 256 characters.
- Do not add a Next.js or browser proxy for the internal route.
- The production Worker returns `404` while the secret is absent.
- The operator header is intentionally absent from the browser CORS allowlist.
- Rotate the secret after the canary exercise or immediately after suspected
  exposure.

The route accepts only `GET`, compares at most 100 source rows per request,
selects exactly one canary binding, returns `Cache-Control: no-store`, and does
not expose owner IDs or source metadata values.

## Configure an isolated Worker

After both databases pass
[the empty-shard bootstrap audit](./D1_CANARY_SHARD_BOOTSTRAP.md), add only the
required canary binding to an isolated Wrangler configuration. Do not enable
channel routing in that change.

Set the secret interactively:

```bash
cd /home/jjiwoo/.workspace/letmetellu-d1-channel-db-abstraction/worker
npx wrangler secret put D1_CANARY_OPERATOR_TOKEN \
  --config <isolated-canary-wrangler.toml>
```

Do not place the entered value in a command argument.

## Run one page

Load the secret into the local environment without printing it, then call the
isolated Worker:

```bash
read -s D1_CANARY_OPERATOR_TOKEN
export D1_CANARY_OPERATOR_TOKEN

curl -sS --get \
  'https://<isolated-canary-worker>/internal/d1-canary/reconcile' \
  -H "X-Canary-Operator-Token: ${D1_CANARY_OPERATOR_TOKEN}" \
  --data-urlencode 'shard=canary-a' \
  --data-urlencode 'limit=100' |
  jq
```

Continue with the exact `nextCursor` returned by the previous page:

```bash
curl -sS --get \
  'https://<isolated-canary-worker>/internal/d1-canary/reconcile' \
  -H "X-Canary-Operator-Token: ${D1_CANARY_OPERATOR_TOKEN}" \
  --data-urlencode 'shard=canary-a' \
  --data-urlencode 'limit=100' \
  --data-urlencode 'cursor=<nextCursor>' |
  jq
```

Stop when `nextCursor` is `null`. Never run pages concurrently for the same
shard during an audit; a serial walk makes the captured cursor sequence and
database load predictable.

## Result interpretation

An acceptable page has `issues: []`. Issue reasons are:

- `missing_control_watermark`: no applied-event watermark exists in control.
- `watermark_mismatch`: source and control versions or lifecycle states differ.
- `missing_active_projection`: the watermark agrees but the active projection
  row is absent.
- `active_projection_mismatch`: owner/profile projection metadata or its source
  version differs.
- `deleted_projection_present`: a projection remains after the matching delete
  watermark.

The response intentionally includes only channel ID, reason, and source/control
versions. Preserve the output as an audit artifact. Do not automatically repair
issues and do not advance channel routing while any issue remains unexplained.

## Failure behavior

- `404`: the operator secret is absent or incorrect.
- `400`: shard, cursor, or limit is invalid.
- `405`: a non-GET method was attempted.
- `503`: the selected canary binding is absent or aliases the control database.

After reconciliation completes, remove or rotate the operator secret. This
route is not a health endpoint and must not be polled continuously.
