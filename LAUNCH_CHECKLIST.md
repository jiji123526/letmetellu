# Launch Checklist

This checklist is for shipping **yap.** beyond ad hoc internal testing.
It reflects the current architecture: Next.js on Vercel, a Cloudflare Worker
backed by D1/R2/Durable Objects, and passcode-gated anonymous chat rooms.

## Status snapshot — 2026-08-12

### Completed and verified

- [x] The limited-beta production gate and core smoke-test pass were completed on 2026-08-04.
- [x] `yapndot.com` is the canonical production origin and `www.yapndot.com` permanently redirects to it.
- [x] Google login/signup callbacks and Resend delivery use the production domain.
- [x] Email signup verification and password reset were exercised in production during the beta setup.
- [x] The super-admin operational-health view and bounded operational-event retention are deployed.
- [x] Worker hardening coverage currently passes 60 focused tests covering trusted identity, privileged route boundaries, origin checks, upload and preview validation, YouTube URL parsing, live-session ending, message idempotency, reply normalization, rate limiting, support query shape, cleanup reliability and health-state derivation.
- [x] GitHub Actions runs the Worker hardening suite, TypeScript check and Wrangler dry-run on every relevant `main` push and pull request. It performs no production deploy and requires no production secrets.
- [x] Dashboard bootstrap and preference synchronization share one `/api/user` read. A production sample recorded one request at about `163 ms`, channels ready at about `355 ms`, and usable state at about `367 ms`; this is not currently a launch bottleneck.
- [x] New replies are normalized to their top-level message. The production audit found 747 replies with no nested, broken, cross-channel or cyclic relationships.
- [x] Normal history paging and `message-context` now use indexed root/direct-child reads instead of recursive thread traversal.
- [x] YouTube and Instagram use lightweight preview cards rather than client-side widgets or iframes. YouTube cards no longer depend on an external title provider.
- [x] Live-session end requests are session-ID guarded, and reconnecting/background tabs reconcile authoritative state before restoring live presence.
- [x] Operational health separates third-party preview failures and media `404` traffic from core backend `5xx` severity.
- [x] Channel and owned-channel account deletion record retryable Durable Object/R2 cleanup, with bounded scheduled retries and operational-health visibility.
- [x] Audited pre-beta test-account and orphan-channel cleanup was completed with protected records verified afterward.

### Still required before a broad public launch

- [ ] Continue the authorization regression plan in `SECURITY_AUTHORIZATION_MATRIX.md`. The first shared-identity and privileged-route invariant suite now covers forged user headers, server-side owner/role checks, owner-only collection ordering, report moderation, platform support and socket authorization boundaries; cross-object mutations, guided support, report-state and dashboard transitions remain.
- [ ] Collect normal production health baselines, calibrate thresholds and document an operator response procedure; add external alerts for degraded/critical states after calibration.
- [ ] Add explicit monitoring for email verification, password reset and legacy SHA-256-to-PBKDF2 upgrades, then rehearse the legacy credential upgrade path end to end.
- [ ] Complete the nonce-based CSP rollout, or perform and record an explicit public-launch security review accepting the remaining `script-src 'unsafe-inline'` risk.
- [ ] Remove temporary legacy production origins from Worker CORS and OAuth only after rollback readiness no longer depends on them.
- [ ] Deploy migration `0036` and verify a partial channel cleanup is retried and recovered before treating the new cross-store deletion path as production-ready.
- [ ] Expand durable abuse controls and validate direct-API report evidence/targets before materially widening access.

### Operational follow-up, not a current blocker

- [ ] After deploying the 2026-08-13 thread-query change and collecting representative traffic, rerun `worker/scripts/audit-flat-replies.sql` and D1 Insights. Confirm `WITH requested_roots` stops accumulating executions and compare the new primary-key/root and indexed-child query fingerprints against the recorded `2.7k-3.6k` rows-read-per-row baseline.
- [ ] Run `worker/scripts/audit-message-indexes.sql` against production. Confirm normal message paging selects `messages_channel_created_id_idx` before considering removal of the older `messages_channel_idx`; retain both reply indexes because their column orders serve different predicates.
- [ ] After deploying the Durable Object presence fallback, confirm a `realtime_unavailable` event appears as degraded health without producing an `/api/init` `500`, and verify the WebSocket reconnect restores the live presence count.
- [ ] Keep the browser-local dashboard/chat diagnostics during beta. They add no network request or analytics traffic and remain useful for separating API, reconnect and rendering delays.
- [ ] Measure preview-card/media stabilization only if slow-render or navigation reports continue; do not add broad telemetry or precomputed channel activity without evidence.

## Current release verification — 2026-08-12

Complete these checks for the social-preview and live-session changes before treating the current `main` revision as production-verified:

- [ ] Run `cd worker && npm run db:migrate:prod` to create `cleanup_jobs` before the Worker using it is deployed.
- [ ] Deploy the Worker first so YouTube preview cache `v3`, deterministic thumbnail cards, session-aware live ending and updated operational diagnostics are active.
- [ ] Deploy the frontend after the Worker and confirm the production CSP no longer permits unused YouTube, Twitter or Instagram widget origins.
- [ ] Verify standard YouTube watch, `youtu.be`, Shorts and live URLs render static thumbnail cards without iframe/widget requests.
- [ ] Verify an Instagram public URL renders a static card when metadata is available and leaves the original link visible when metadata is unavailable.
- [ ] Verify a stale owner tab cannot end a newer live session.
- [ ] Verify a viewer tab returning from the background exits an ended session or receives the current session prompt before rejoining presence.
- [ ] Confirm preview upstream failures remain visible separately from core `5xx`, while media `404` remains a non-severity secondary signal.
- [ ] Delete a disposable channel with a known media object, confirm the D1 channel disappears, the media is removed, and the cleanup job reaches `completed_at`; also verify the health card exposes any forced cleanup failure.

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
- Do not remove `'unsafe-inline'` during release preparation without testing theme startup, auth, chat dialogs, deferred preview cards and raw-link fallback under the stricter policy.

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

5. Run the Worker hardening suite and verify the deploy bundle:

```bash
npm run test:hardening
npx wrangler deploy --dry-run
```

6. If dependencies changed, rerun the production audit:

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
3. Deleted media disappears from chat/gallery and a new or revalidated request for its old URL returns `404`.
4. Account for the documented browser-cache window when testing a URL that was already loaded before deletion.

### Link previews

1. Normal public URL produces a preview.
2. Standard YouTube watch, `youtu.be`, Shorts and live URLs produce static thumbnail cards with no iframe request.
3. YouTube cards still render when external title/author metadata is unavailable.
4. Public Instagram and X/Twitter URLs use lightweight cards with no platform widget script.
5. Private or metadata-restricted Instagram posts leave the original clickable URL visible.
6. Blocked, non-HTML, oversized, or slow URLs do not crash the Worker.
7. When any preview does not render, the original clickable URL remains visible.
8. Reloading a previously viewed link can restore its bounded browser-cached preview without changing authorization behavior.

### Live mode

1. Start a live session.
2. Join the live session from a viewer tab.
3. Confirm presence updates.
4. End the live session.
5. Confirm live messages/media are cleaned up and the normal room view recovers.
6. Keep a viewer tab hidden through session end, return to it and confirm it reconciles to normal chat before sending live presence.
7. Start a newer session, then attempt to end live from an owner tab holding the previous session and confirm the newer session remains active.
8. End live in one browser tab and confirm another open tab clears its local live state.

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

- core backend `5xx` separately from third-party preview upstream failures;
- preview fetch rejects, timeouts and rate-limit events;
- media `403`, grouped `404` and `500` outcomes, with media `404` excluded from core severity;
- `/api/init` and `/api/messages` failure-stage detail;
- grouped WebSocket failures without per-channel route fragmentation;
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
- no active core backend `500` regressions remain;
- the team accepts the remaining isolate-local rate-limit tradeoffs.

Public launch should wait until:

- regression coverage exists for support/report/dashboard state sync;
- operational-health thresholds are calibrated and operators have either external alerts or an explicit manual response procedure;
- production signup verification, password reset and legacy password upgrades have been rehearsed and are monitored.
- the nonce-based CSP migration has been validated or the remaining `'unsafe-inline'` risk has received an explicit public-launch security review.
