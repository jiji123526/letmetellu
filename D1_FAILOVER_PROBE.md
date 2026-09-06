# D1 Failover Probe

Last updated: 2026-09-06

## Purpose

This branch isolates the intermittent production D1 primary delay without
changing the production Worker, database, media bucket, schedules, or Vercel
deployment. Production measurements showed SQL execution in milliseconds while
the first D1 binding request intermittently waited 5–18 seconds and direct
Wrangler access returned error `7429` (`D1 DB is overloaded`).

## Isolated resources

- Git branch: `codex/d1-failover-probe`
- Worker: `letsplay-api-d1-probe`
- D1: `letsplay-db-probe-20260906` in ENAM
- R2: `letmetellu-media-probe-20260906`
- Worker config: `worker/wrangler.probe.toml`

The probe Worker intentionally has no cron triggers. It cannot drain production
notifications or run production maintenance. Its D1 and R2 bindings point only
to empty probe resources.

## Rollout

1. Apply all repository migrations to the probe D1.
2. Insert one synthetic owner and public channel; do not copy production user
   or message data for the first latency comparison.
3. Copy only `INTERNAL_SECRET` to the probe Worker so the existing Vercel
   server-side proxy can authenticate. Do not copy VAPID or email credentials.
4. Deploy with `npx wrangler deploy --config wrangler.probe.toml`.
5. Set `NEXT_PUBLIC_WORKER_URL` only for the Vercel Preview environment to the
   probe Worker URL and redeploy this branch.
6. Add the exact generated Vercel Preview origin to `ALLOWED_ORIGIN` before
   testing WebSockets. Never use `*` for this probe.

## Decision gate

Run at least 30 sequential channel-init reads and 20 synthetic message writes.
Record end-to-end time, `Server-Timing`, `X-Yap-Worker-Timing`, status, and any
`7429`/`d1_unavailable` failures.

- If the empty probe stays below one second without overloads while production
  remains slow, prepare a separately reviewed export/import cutover.
- If the empty probe also stalls or returns `7429`, do not migrate production
  data; escalate the account/region-wide D1 failure to Cloudflare.
- Do not infer production readiness from one fast request. The current failure
  is intermittent, so compare repeated samples over at least 30 minutes.

## Initial comparison — 2026-09-06

Both Workers ran the same commit and were called directly from the same client
with a fresh anonymous identity on each init request.

- Production `zziks`: 15 init reads included four stalls at 10.84, 16.03,
  15.56, and 15.23 seconds. Each stall was almost entirely the first `channel`
  D1 stage (10.13–15.33 seconds); the bootstrap after it remained below 0.34
  seconds.
- Empty probe `probe-latency`: all 15 init reads completed in 0.24–0.63
  seconds. The `channel` stage stayed between 65 and 300 ms.
- Probe writes: 20 valid synthetic message sends across four rate-limit-safe
  anonymous sessions all returned HTTP 200 in 0.39–0.79 seconds. Persistence
  stayed between 87 and 113 ms. An earlier single-session burst correctly hit
  the application rate limit after five sends and is excluded from latency
  comparison.

This strongly isolates the long stalls to the existing production D1 resource,
not the Worker code, geographic client path, message-page SQL, or normal request
volume. It is still a point-in-time sample. Leave the probe isolated and repeat
the comparison over at least 30 minutes before authorizing production data
migration.

## Trade-offs and cleanup

This probe does not reproduce the 33 MB production dataset, but that is useful
for the first test: it separates database size/query shape from D1 primary
placement and queue health. A fast empty database does not prove that a full
migration will remain fast after import, so a second full-copy test is required
before cutover.

When the investigation ends, delete the probe Worker, D1, and R2 only after
confirming no Vercel Preview environment still references them. The production
resources must never be deleted as part of probe cleanup.
