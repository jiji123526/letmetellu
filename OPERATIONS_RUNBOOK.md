# Production Operations Runbook

This runbook covers the existing `operational_events` health model and retryable
channel-cleanup jobs. Times and database timestamps are UTC.

## Current Health Model

The super-admin dashboard summarizes the last 15 minutes and 24 hours. Current
15-minute thresholds are:

| Status | Trigger |
| --- | --- |
| Critical | `request_failed` 5xx >= 5, unhandled exceptions >= 3, `d1_unavailable` >= 5, or any scheduled-maintenance failure |
| Degraded | Any request 5xx, exception, unrecovered `d1_unavailable`, cleanup failure or realtime fallback, or rate limits >= 25 |
| Context only | Preview upstream failures, forbidden requests and media 404s do not independently change core health |

These are conservative beta thresholds. Do not raise them merely to make a
recurring application failure appear healthy.

### Calibrated Beta Baseline

The first production review on 2026-08-13 covered 672 fifteen-minute windows.
Core 5xx and unhandled-exception counts were nonzero in only five windows, with
p50, p95 and p99 all at zero. The maximum was four events in one window.
Maintenance, cleanup, realtime, D1-unavailable, rate-limit and media-miss
signals were all zero, and there were no pending cleanup jobs.

The existing thresholds were retained:

- one core failure remains degraded because normal windows are quiet;
- three exceptions remain critical because the observed exception bursts were
  real Durable Object incidents, not normal traffic;
- one unrecovered D1 failure remains degraded because room entry can be
  affected, while five in one window is critical because that indicates a
  sustained storage outage rather than a momentary reset;
- five request failures remain critical, just above the observed maximum burst;
- preview upstream failures and expected forbidden requests remain context-only
  signals because they did not indicate a core service outage.

Recalibrate only after traffic volume changes materially or a later seven-day
sample demonstrates a different normal pattern.

## Collect A Baseline

Run the read-only audit from `worker/` after representative traffic:

```bash
npx wrangler d1 execute letsplay-db --remote \
  --command "$(cat scripts/audit-operational-health-baseline.sql)"
```

The first result zero-fills seven days of 15-minute windows and reports the
average, p50, p95, p99 and maximum for each tracked signal. Later results show
daily counts, route concentration and pending cleanup jobs.

Run it at a consistent UTC time once per week during beta. Keep dated output in
the private operator workspace, not Git, because route details and cleanup
errors are production operational data.

Before changing thresholds:

1. Collect at least seven representative days, including the busiest day.
2. Separate core failures from preview upstream failures, expected 403s, media
   misses and deliberate rate limiting.
3. Investigate recurring core errors instead of normalizing them.
4. Compare p95/p99 with the current threshold and check whether affected users
   could enter rooms, send messages or use owner/admin functions.
5. Record the old value, new value, evidence window and rollback condition in
   `MIGRATION_NOTES.md`.

`operational_events` does not contain successful-request volume or latency.
Counts therefore cannot produce a true error rate or latency SLO. Use
Cloudflare/Vercel request analytics for denominators until bounded success and
latency telemetry is added.

## Notification Operations

Run the read-only notification audit from `worker/` after migrations `0062` and
`0063`,
after the first hourly maintenance pass, and when Push delivery appears delayed:

```bash
npx wrangler d1 execute letsplay-db --remote \
  --command "$(cat scripts/audit-notification-operations.sql)"
```

Interpret the results as follows:

- `ready_rows` should normally return to zero. Investigate sustained growth or
  an old `oldest_ready_created_at` before increasing delivery batch limits.
- `expired_delivered_rows` and `expired_dead_rows` may be nonzero between hourly
  maintenance runs but should drain in bounded batches.
- `expired_unreferenced_revoked_subscriptions` should drain only after retained
  outbox references have expired.
- The final result must list all seven ready, terminal, subscription-reference,
  active-subscription and revoked-subscription indexes.

Use `--command` here because Wrangler's remote `--file` import mode reports only
aggregate query and row counts instead of printing each read-only `SELECT`
result.

The audit intentionally does not select Push endpoints, `p256dh`, `auth` or
payload JSON. Keep production audit output in the private operator workspace.

## Response Procedure

### Critical

1. Open the super-admin health card and identify the dominant route and signal.
2. Check whether the first event follows a deployment.
3. Run the recent-event query below and inspect `route_stage` and the bounded
   error text.
4. Reproduce one core path: room entry (`/api/init`), message send and, when
   relevant, owner/admin access.
5. Roll back only when the failure began after a deployment and the previous
   version is known good. Provider incidents should use graceful fallback and
   monitoring rather than an unrelated code rollback.
6. Confirm recovery with two consecutive healthy 15-minute windows and a
   successful core smoke test.

### Degraded

1. Determine whether the signal is isolated, transient or increasing.
2. Check route concentration and cleanup backlog.
3. For one realtime failure, confirm `/api/init` remained unaffected and live
   presence recovers after WebSocket reconnect.
4. For cleanup failure, allow scheduled retry unless attempts or age continue
   increasing.
5. Escalate to critical handling when users cannot complete a core action,
   failures spread across routes, or the critical threshold is reached.

### Unified Timeline Rollback

Global unified pagination covers normal, live and reports history. Investigate or
roll back when users see cross-user DMs, missing/duplicate roots, repeated viewport
jumps, stale live-session content, unauthorized reports metadata, sustained error
rate above 1%, or P95 more than 100 ms over the comparable legacy window.

1. Confirm affected reads emit `unified_timeline_read` or
   `unified_timeline_fanout_warning` with `rollout_mode=global`.
2. Record the current Worker deployment and preserve relevant content-free logs.
3. Delete `UNIFIED_TIMELINE_GLOBAL_ENABLED`.
4. Ensure `UNIFIED_TIMELINE_SAMPLE_PERCENT` and all unified allowlist secrets are
   absent; otherwise their matching traffic remains enabled.
5. Open or refresh one affected channel. An already-open normal tab reloads into
   legacy mode on its next rejected unified request.
6. Verify room entry, older paging, DM isolation, live start/end and reports-owner
   access on legacy reads before closing the incident.

Rollback changes read selection only. It does not require a D1 rollback and should
not revert migration `0048`, whose petition lookup index is safe for both paths.

### Recent Event Detail

```bash
npx wrangler d1 execute letsplay-db --remote --command "
SELECT
  created_at,
  severity,
  route,
  event_type,
  status_code,
  json_extract(detail_json, '$.route_stage') AS route_stage,
  substr(json_extract(detail_json, '$.error'), 1, 300) AS error
FROM operational_events
WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')
ORDER BY created_at DESC
LIMIT 100;
"
```

## Signal Playbooks

### `/api/init` Or Core 5xx

- Group by `route_stage` and error text.
- `/api/init` no longer contacts the Durable Object. Treat any new init error
  mentioning Durable Object presence as evidence of an outdated deployment.
- If the event type is `d1_unavailable`, remember that `/api/init` already
  retried once before surfacing `503`. A recorded init event therefore means the
  retry also failed.
- Tight clusters of `d1_unavailable` rows across `/api/init` and an occasional
  mutation route point to D1 availability, not route logic.
- If failures began after deployment, compare the current and previous Worker
  versions and roll back only the Worker when the frontend contract permits it.
- Recovery means room entry and refresh succeed and the 15-minute count stops
  increasing.

### D1 Unavailable

- Treat an isolated `d1_unavailable` event as degraded unless user reports or
  the health threshold indicate a broader incident.
- `GET /api/init` already retries once before surfacing `503 d1_unavailable`.
  If the event is still recorded, the transient window outlasted that retry.
- Write routes are intentionally not retried. Failed mutations remain unapplied
  and require a user retry after D1 recovers.
- Escalate when the signal spans more than one evaluation window, reaches the
  critical threshold, or continues after a Worker rollback.

### Realtime Unavailable

- Treat an isolated event as degraded, not a full outage.
- Confirm `/api/init` remained unaffected; current chat bootstrap has no Durable
  Object dependency.
- A `503` on `/ws/:channel` or a mutation route with
  `dependency=durable_object` means the Worker recognized a transient Durable
  Object reset. WebSocket clients reconnect automatically; failed mutations
  remain unapplied and require a user retry.
- For `POST /api/messages` at `route_stage=apply_rate_limit`, confirm no message
  row was committed before the failure. The client keeps its idempotency key,
  so retrying after recovery is safe.
- Confirm WebSocket reconnect restores live presence.
- Escalate when fallbacks repeat across channels, continue beyond one alert
  window, or include unknown `unhandled_exception` events.

### Cleanup Failure

```bash
npx wrangler d1 execute letsplay-db --remote --command "
SELECT id, resource_id, attempt_count, next_attempt_at,
       substr(last_error, 1, 300) AS last_error,
       created_at, updated_at
FROM cleanup_jobs
WHERE completed_at IS NULL
ORDER BY created_at ASC
LIMIT 50;
"
```

- Do not manually delete the D1 job or R2 objects without first identifying the
  failed stage.
- Confirm attempts advance and the job eventually receives `completed_at`.
- Escalate when the oldest job exceeds the normal observed recovery window,
  attempts stop advancing, or retained media remains externally accessible.

### Preview Failures

- Preview `502/504` responses are third-party quality signals, not core-health
  failures.
- Check whether failures are concentrated by upstream domain.
- Escalate only when the Worker URL policy, timeout path or all preview requests
  fail independently of upstream targets.

### Rate Limits And Forbidden Requests

- `429` and `403` commonly indicate working abuse controls.
- Check concentration by route and time before changing limits.
- Escalate when legitimate smoke tests are blocked or a sudden distributed
  spike suggests active abuse.

### Media 404

- Confirm whether the message/channel was deleted or cleanup completed.
- Escalate only for referenced current media that should still exist.
- Never restore deleted media solely to reduce the 404 counter.

## Alert Rollout

The initial baseline is calibrated. The Worker evaluates health every five
minutes and delivers transition emails through Resend when
`OPERATIONAL_ALERT_EMAIL` is configured:

- critical state sends on its first evaluation;
- degraded state sends only after two consecutive non-healthy 15-minute windows;
- an existing degraded alert escalates once if the state becomes critical;
- the same incident does not resend on every scheduled evaluation;
- recovery sends only after two consecutive healthy windows;
- preview failures, expected 403s and media misses remain excluded from severity.

Alert emails include bounded counts, up to five dominant routes, and links to
this runbook and the super-admin dashboard. They intentionally exclude raw
error text, user IDs and the configured recipient.

### Enable Alert Delivery

Apply the state migration before deploying the Worker:

```bash
cd worker
npx wrangler d1 migrations apply letsplay-db --remote
npx wrangler secret put OPERATIONAL_ALERT_EMAIL
npx wrangler deploy
```

Enter one monitored operator email address when Wrangler prompts for the
secret. Deploy the frontend after the Worker; the expanded health card should
show **External alerts: On** and a five-minute check interval.

Confirm durable delivery state:

```bash
npx wrangler d1 execute letsplay-db --remote --command "
SELECT notified_status, last_alert_kind, last_alert_at, updated_at
FROM operational_health_alert_state
WHERE alert_key = 'core_health';
"
```

If delivery fails, the state remains unchanged so the next evaluation retries
with the same Resend idempotency key. Failures are recorded as
`operational_alert_delivery_failed`.

### Delivery Verification

Do not manufacture a production incident during normal traffic. In a quiet
maintenance window, a full end-to-end test may insert three clearly labeled
synthetic `unhandled_exception` events, wait up to five minutes for the critical
email, delete those exact synthetic rows, and wait for two healthy windows for
the recovery email. Keep the inserted IDs so only test records are removed.
The dashboard being critical during this test is expected.

After verification, confirm one critical email, one recovery email, no duplicate
email on intervening evaluations, and a final `notified_status = 'healthy'`.

## Account Authentication Monitoring

The expanded platform health card reports these rolling 24-hour authentication
outcomes separately from core service severity:

- verification email sent, verification completed and delivery failed;
- password-reset email sent, reset completed and delivery failed;
- legacy SHA-256 password upgraded, upgrade failed and legacy hashes remaining.

Delivery failures still return `502`, so the existing core `5xx` health and
alert path also sees an actual provider outage. A failed legacy upgrade does
not reject valid login and therefore appears only in the account-security
summary. The events store an opaque user ID for investigation but never store
an email address, password, reset/verification token, password hash, provider
response or exception text.

Run the privacy-bounded audit from `worker/`:

```bash
npx wrangler d1 execute letsplay-db --remote \
  --command "$(cat scripts/audit-auth-monitoring.sql)"
```

### Legacy Password Upgrade Rehearsal

Use a disposable, verified credential account and a unique test password. Do
not alter a real user or an OAuth-only account.

1. Create and verify the disposable account through the production UI. Record
   its opaque user ID and confirm the account owns no data that must be kept.
2. Locally calculate the 64-character lowercase SHA-256 digest of the test
   password. Do not place the cleartext password in SQL or shell history.
3. Update only that exact user ID from its existing `pbkdf2-sha256$...` value
   to the calculated legacy digest. Include `email_verified_at IS NOT NULL`
   and `password_hash LIKE 'pbkdf2-sha256$%'` preconditions so an unexpected
   row cannot be changed.
4. Log in through the normal email-login UI. The login must succeed without a
   password-reset detour.
5. Query only `id` and `substr(password_hash, 1, 14)` for the test user. Confirm
   the prefix is now `pbkdf2-sha256$`, the dashboard reports one successful
   upgrade, no upgrade failure was recorded, and the remaining count decreased.
6. Log out and log in again to prove the PBKDF2 value verifies normally. A
   second upgrade event must not appear.
7. Delete the disposable account through the normal account-deletion flow.

Also rehearse one new-account verification and one password reset with a
non-owner mailbox. Confirm the links arrive, complete once, reject reuse, and
the old password fails after reset while the new password succeeds. Compare
the health-card totals with `audit-auth-monitoring.sql`.

Operational-event recording is best-effort and must never block signup, reset
or login. Each actual send, completion or one-time legacy upgrade adds one
small D1 event write; ordinary PBKDF2 logins add no monitoring write.
