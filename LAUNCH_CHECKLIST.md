# Launch Checklist

This checklist is for shipping **yap.** beyond ad hoc internal testing.
It reflects the current architecture: Next.js on Vercel, a Cloudflare Worker
backed by D1/R2/Durable Objects, and passcode-gated anonymous chat rooms.

## Status snapshot — 2026-08-09

### Completed and verified

- [x] The limited-beta production gate and core smoke-test pass were completed on 2026-08-04.
- [x] `yapndot.com` is the canonical production origin and `www.yapndot.com` permanently redirects to it.
- [x] Google login/signup callbacks and Resend delivery use the production domain.
- [x] Email signup verification and password reset were exercised in production during the beta setup.
- [x] The super-admin operational-health view and bounded operational-event retention are deployed.
- [x] Worker hardening coverage currently passes 44 focused tests covering trusted identity, privileged route boundaries, origin checks, upload and preview validation, message idempotency, reply normalization, rate limiting, support query shape and health-state derivation.
- [x] GitHub Actions runs the Worker hardening suite, TypeScript check and Wrangler dry-run on every relevant `main` push and pull request. It performs no production deploy and requires no production secrets.
- [x] Dashboard bootstrap and preference synchronization share one `/api/user` read. A production sample recorded one request at about `163 ms`, channels ready at about `355 ms`, and usable state at about `367 ms`; this is not currently a launch bottleneck.
- [x] New replies are normalized to their top-level message. The production audit found 747 replies with no nested, broken, cross-channel or cyclic relationships.
- [x] Normal history paging and `message-context` now use indexed root/direct-child reads instead of recursive thread traversal.
- [x] Audited pre-beta test-account and orphan-channel cleanup was completed with protected records verified afterward.

### Still required before a broad public launch

- [ ] Continue the authorization regression plan in `SECURITY_AUTHORIZATION_MATRIX.md`. The first shared-identity and privileged-route invariant suite now covers forged user headers, server-side owner/role checks, owner-only collection ordering, report moderation, platform support and socket authorization boundaries; cross-object mutations, guided support, report-state and dashboard transitions remain.
- [ ] Collect normal production health baselines, calibrate thresholds and document an operator response procedure; add external alerts for degraded/critical states after calibration.
- [ ] Add explicit monitoring for email verification, password reset and legacy SHA-256-to-PBKDF2 upgrades, then rehearse the legacy credential upgrade path end to end.
- [ ] Complete the nonce-based CSP rollout, or perform and record an explicit public-launch security review accepting the remaining `script-src 'unsafe-inline'` risk.
- [ ] Remove temporary legacy production origins from Worker CORS and OAuth only after rollback readiness no longer depends on them.
- [ ] Move cross-store channel/account/media deletion toward retryable, observable cleanup so partial D1/R2/Durable Object failures can recover.
- [ ] Expand durable abuse controls and validate direct-API report evidence/targets before materially widening access.

### Operational follow-up, not a current blocker

- [ ] After representative traffic, rerun `worker/scripts/audit-flat-replies.sql` and D1 Insights. Confirm the former recursive query stops accumulating executions and compare the replacement query's rows read and duration.
- [ ] Keep the browser-local dashboard/chat diagnostics during beta. They add no network request or analytics traffic and remain useful for separating API, reconnect and rendering delays.
- [ ] Measure widget/media stabilization only if slow-render or navigation reports continue; do not add broad telemetry or precomputed channel activity without evidence.

## Public-launch blockers

Do not treat the app as public-launch ready until these are complete:

1. Regression coverage for state-heavy flows
- Existing Worker hardening and query-shape tests are useful but do not exercise the complete browser-visible state transitions.
- Add automated tests for guided support reset/escalation, support ticket visibility and reports inbox filtering.
- Add regression coverage for user-side ticket close/delete sync and super-admin dashboard ticket updates.

2. Monitoring and operator alerting
- The health dashboard and local performance diagnostics exist; baseline calibration and external alert delivery do not.
- Calibrate the existing super-admin operational-health dashboard against production baselines, then add alert delivery for degraded or critical states.
- Add bounded operator summaries for moderation/support audit trends.
- Confirm a concrete review path for `403`, `429`, `5xx`, moderation actions and support queue age.

3. Production email hardening
- Resend production delivery is enabled through `yap. <noreply@send.yapndot.com>`.
- Signup verification and password reset have been exercised. Rehearse and monitor the legacy password-hash upgrade path separately, including a non-owner recipient address where email delivery is involved.

4. Custom production domain
- `yapndot.com` is attached to Vercel and frontend/Auth.js/Worker origins use `https://yapndot.com`.
- `www.yapndot.com` permanently redirects to the apex domain instead of serving a second independent app origin.
- Google OAuth includes `https://yapndot.com` as an authorized JavaScript origin and both `/api/auth/callback/google-login` and `/api/auth/callback/google-signup` redirect URIs.
- Login cookies, email verification links, password-reset links and Worker CORS were smoke-tested on the custom domain.
- Temporary legacy origins remain only for rollback readiness and must be removed before broad public launch.

## Current limited-beta gate

The limited-beta gate was completed on 2026-08-04:

1. End-to-end email signup and password-reset testing completed.
2. Google signup and Google login from `yapndot.com` completed.
3. `www.yapndot.com` returns a permanent Vercel redirect to the apex hostname.
4. Core chat, locked-channel, live, support and moderation smoke tests completed.
5. The super-admin health card is available; keep `wrangler tail` available for the first beta sessions.
6. Audited pre-beta test-data cleanup completed with the protected keep set verified afterward.

Accepted limited-beta security trade-off:

- The production CSP still permits `script-src 'unsafe-inline'`. No active XSS is known, but this weakens CSP as a fallback containment layer if a separate injection bug exists. Keep normal input/rendering protections in place, monitor browser errors, and complete the nonce/dialog-contract migration before a broad public launch.
- Do not remove `'unsafe-inline'` during release preparation without testing theme startup, auth, chat dialogs and external widgets under the stricter policy.

## Pre-deploy checks

The `Worker security and type checks` GitHub status check mirrors the Worker
commands below for every relevant pull request and `main` push. Until the
`main` branch is protected, a failed check reports the regression but does
not prevent a direct push or a simultaneous Vercel deployment.

1. Confirm the working tree contains only the intended release changes.
2. Review `README.md`, `MIGRATION_NOTES.md`, and this file if behavior changed.
3. Run the frontend production build:

```bash
npm run build
```

4. Run the Worker typecheck:

```bash
cd worker
npx tsc --noEmit
```

5. If dependencies changed, rerun the production audit:

```bash
npm audit --omit=dev
```

Do not use `npm audit fix --force` on this project. Resolve Next.js-related
dependency issues through normal version upgrades and full retesting.

## Deployment order

Use the narrowest deployment needed for the change:

- Worker-only change: deploy the Worker only.
- Frontend-only change: deploy the frontend only.
- Schema + Worker change: apply D1 migrations first, then deploy the Worker.
- Mixed Worker + frontend change: deploy the Worker first, then the frontend.

When D1 schema changes are involved:

```bash
cd worker
npm run db:migrate:prod
npm run deploy
```

Then deploy/publish the frontend.

## Production smoke tests

Run these after deployment.

### Core chat

1. Anonymous viewer joins a public channel.
2. Send a normal text message.
3. Send an image.
4. React to a message.
5. Delete a message.

### Locked channel

1. Anonymous viewer opens a passcode-protected channel.
2. Confirm the passcode overlay appears with the current hint.
3. Enter the passcode and confirm messages and images load.
4. Open a protected image and confirm the URL is same-origin `/api/media/...`
   with no `?token=...`.
5. Open the same image URL in an unauthorized session/incognito and confirm it
   fails instead of rendering.

### Passcode change flow

1. Keep a non-owner viewer connected to a locked channel.
2. As owner, change the passcode and hint.
3. Confirm the connected viewer is forced back to the passcode overlay.
4. Confirm the updated hint appears immediately without a full page refresh.
5. Re-enter the new passcode and confirm access is restored.

### Channel assets

1. Locked-channel profile image still appears in the channel list.
2. Background/profile changes made by the owner appear correctly.
3. Deleted media no longer renders in chat/gallery.

### Link previews

1. Normal public URL produces a preview.
2. YouTube URL produces a preview.
3. X/Twitter URL produces a preview.
4. Blocked, non-HTML, oversized, or slow URLs do not crash the Worker.
5. When a preview does not render, the original clickable URL remains visible.

### Live mode

1. Start a live session.
2. Join the live session from a viewer tab.
3. Confirm presence updates.
4. End the live session.
5. Confirm live messages/media are cleaned up and the normal room view recovers.

### Account flows

1. Login works.
2. Signup email verification works.
3. Password reset request and reset completion work.
4. Logout works.

### Support and moderation

1. Open the dashboard help menu as a guest and as a logged-in user.
2. Start guided `1:1` support, close it mid-flow and confirm reopening starts from the first step.
3. Escalate a support ticket and confirm it appears immediately for the super admin.
4. Confirm the user cannot submit a second ticket while one is still open.
5. Confirm deleting the temporary user support item closes the thread on the super-admin side.
6. Open the reports inbox and confirm `Open`, `Warned`, and `Frozen` filters work.
7. Confirm the restricted-channel summary matches the currently warned/frozen channels.

## Observability checks

Before wider rollout, verify that you can inspect:

- preview fetch rejects, timeouts, and rate-limit events;
- media `403`, `404`, and `500` outcomes;
- room-auth failures and passcode verification failures;
- upload ticket validation failures;
- report submissions and moderation actions.

Useful commands:

```bash
cd worker
unset CLOUDFLARE_ACCOUNT_ID
npx wrangler tail
```

## Rollback readiness

Before releasing:

1. Know the last good frontend commit.
2. Know the last good Worker deploy.
3. Avoid bundling unrelated features into the release.
4. Write one short release note covering:
- auth changes
- media access changes
- preview behavior changes
- migrations, if any

## Beta vs public launch

Internal or limited beta can proceed after:

- successful production smoke tests;
- monitoring/logging is available;
- no active `500` regressions remain;
- the team accepts the remaining isolate-local rate-limit tradeoffs.

Public launch should wait until:

- regression coverage exists for support/report/dashboard state sync;
- operational-health thresholds are calibrated and operators have either external alerts or an explicit manual response procedure;
- production signup verification, password reset and legacy password upgrades have been rehearsed and are monitored.
- the nonce-based CSP migration has been validated or the remaining `'unsafe-inline'` risk has received an explicit public-launch security review.
