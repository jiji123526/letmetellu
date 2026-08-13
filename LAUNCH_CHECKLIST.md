# Launch Checklist

This checklist is for shipping **yap.** beyond ad hoc internal testing.
It reflects the current architecture: Next.js on Vercel, a Cloudflare Worker
backed by D1/R2/Durable Objects, and passcode-gated anonymous chat rooms.

## Status snapshot — 2026-08-13

### Completed and verified

- [x] The limited-beta production gate and core smoke-test pass were completed on 2026-08-04.
- [x] `yapndot.com` is the canonical production origin and `www.yapndot.com` permanently redirects to it.
- [x] Google login/signup callbacks and Resend delivery use the production domain.
- [x] Email signup verification and password reset were exercised in production during the beta setup.
- [x] The super-admin operational-health view and bounded operational-event retention are deployed.
- [x] Worker hardening coverage includes focused tests for trusted identity, privileged route boundaries, report-state synchronization, origin checks, upload and preview validation, live-session ending, message idempotency, reply normalization, rate limiting, support query shape, cleanup reliability and health-state derivation.
- [x] GitHub Actions runs the Worker hardening suite, TypeScript check and Wrangler dry-run on every relevant `main` push and pull request. It performs no production deploy and requires no production secrets.
- [x] Dashboard bootstrap and preference synchronization share one `/api/user` read. A production sample recorded one request at about `163 ms`, channels ready at about `355 ms`, and usable state at about `367 ms`; this is not currently a launch bottleneck.
- [x] New replies are normalized to their top-level message. The 2026-08-13 production audit found 1,057 replies across 6,855 messages with no nested, broken, cross-channel, cyclic or over-depth relationships; maximum observed depth was one.
- [x] Normal history paging uses indexed root/direct-child reads. `message-context` uses bounded recursion only to resolve a legacy target to its root, then loads the surrounding root window through the same indexed expansion path.
- [x] YouTube and Instagram use lightweight preview cards rather than client-side widgets or iframes. YouTube cards no longer depend on an external title provider.
- [x] Live-session end requests are session-ID guarded, and reconnecting/background tabs reconcile authoritative state before restoring live presence.
- [x] Operational health separates third-party preview failures and media `404` traffic from core backend `5xx` severity.
- [x] Channel and owned-channel account deletion record retryable Durable Object/R2 cleanup, with bounded scheduled retries and operational-health visibility.
- [x] All D1 migrations through `0038_support_open_lifecycle_invariants.sql` are applied in production.
- [x] Cross-store channel cleanup was verified end to end, including D1 deletion, R2 media removal, cleanup-job completion and operational-health visibility.
- [x] Message history was verified with root-owned pagination: replies remain under their parent, adjacent parent windows do not disappear, and replies to unmounted historical parents do not reappear as latest messages.
- [x] Audited pre-beta test-account and orphan-channel cleanup was completed with protected records verified afterward.
- [x] Locked-room passcode rotation and deletion were verified across open viewer tabs; stale access returned to the gate or not-found state.
- [x] Hidden and disconnected live tabs were verified to reject ended-session actions, avoid restoring stale presence and retain normal-room access.
- [x] The production guided-support lifecycle audit found zero users with duplicate open sessions or tickets before migration `0038`.
- [x] Migration `0038` and its race-recovering guided-support Worker changes are deployed.
- [x] Cross-tab logout and account deletion were deployed and verified to remove owner controls and reconnect chat without stale WebSocket privileges.
- [x] Fresh protected-media requests and direct capabilities reject stale room access and deleted parent channels before reading R2; bounded private browser-cache reuse is explicitly documented.
- [x] The first seven-day operational-health baseline was reviewed across 672 fifteen-minute windows. Normal p50/p95/p99 counts were zero, the existing thresholds were retained, and the operator response runbook is complete.

### Still required before a broad public launch

- [ ] Continue the authorization regression plan in `SECURITY_AUTHORIZATION_MATRIX.md`. Shared identity, privileged routes, cross-object mutations, room/live lifecycle, guided-support invariants, authoritative ticket/report synchronization, cross-tab socket revocation and media-access revocation are covered; deployed support/report transitions remain.
- [ ] Apply migration `0039`, configure `OPERATIONAL_ALERT_EMAIL`, deploy Worker/frontend alert delivery, and verify one critical/recovery cycle without duplicate email. The implementation and response runbook are complete.
- [ ] Add explicit monitoring for email verification, password reset and legacy SHA-256-to-PBKDF2 upgrades, then rehearse the legacy credential upgrade path end to end.
- [ ] Complete the nonce-based CSP rollout, or perform and record an explicit public-launch security review accepting the remaining `script-src 'unsafe-inline'` risk.
- [ ] Remove temporary legacy production origins from Worker CORS and OAuth only after rollback readiness no longer depends on them.
- [ ] Expand durable abuse controls and validate direct-API report evidence/targets before materially widening access.

### Operational follow-up, not a current blocker

- [x] Reran `worker/scripts/audit-flat-replies.sql` against production after the 2026-08-13 rollout: 6,855 messages and 1,057 replies were all flat and valid, with zero broken, cross-channel, nested, cyclic or over-depth relationships.
- [x] Verified production query plans for root paging and reply operations. Root windows use `messages_channel_root_created_id_idx`; deleted-state child expansion uses `messages_channel_deleted_reply_idx`; thread deletion uses `messages_channel_reply_deleted_idx`. Both reply indexes remain justified, and no query/schema fix is required.
- [ ] In D1 Insights, confirm the retired `WITH requested_roots` fingerprint stops accumulating post-deployment executions and compare new root/child rows-read-per-row against the recorded `2.7k-3.6k` baseline.
- [ ] Audit remaining chronological query shapes before considering removal of `messages_channel_idx`; root-owned paging no longer provides evidence for removing it because that path now uses the dedicated `0037` index.
- [x] Correlated six historical `/api/init` `500`s into two pre-fallback Durable Object reset incidents and confirmed there are no recorded `/api/init` failures after the first fallback deployment at `2026-08-13T15:38:12.056Z`.
- [ ] When a genuine post-deployment Durable Object failure occurs, confirm `realtime_unavailable` produces degraded health without an `/api/init` `500`; independently verify WebSocket reconnect restores the live presence count.
- [ ] Keep the browser-local dashboard/chat diagnostics during beta. They add no network request or analytics traffic and remain useful for separating API, reconnect and rendering delays.
- [ ] After the conditional chat chunks deploy, perform one cache-disabled channel load and open search, edit, context menu, settings, gallery, links, report and owner-admin overlays once.
- [ ] Measure preview-card/media stabilization only if slow-render or navigation reports continue; do not add broad telemetry or precomputed channel activity without evidence.

## Current release verification — completed 2026-08-13

The social-preview, live-session, cleanup and root-owned message-history changes were production-verified:

- [x] Applied all production D1 migrations through `0037_message_root_pagination.sql`.
- [x] Deployed the Worker before the frontend so preview cache `v3`, deterministic thumbnail cards, session-aware live ending, root-owned message pagination and updated operational diagnostics are active.
- [x] Deployed the frontend and confirmed the production CSP no longer permits unused YouTube, Twitter or Instagram widget origins.
- [x] Verified standard YouTube watch, `youtu.be`, Shorts and live URLs render static thumbnail cards without iframe/widget requests.
- [x] Verified an Instagram public URL renders a static card when metadata is available and leaves the original link visible when metadata is unavailable.
- [x] Verified a stale owner tab cannot end a newer live session.
- [x] Verified a viewer tab returning from the background exits an ended session or receives the current session prompt before rejoining presence.
- [x] Confirmed preview upstream failures remain visible separately from core `5xx`, while media `404` remains a non-severity secondary signal.
- [x] Deleted a disposable channel with a known media object and confirmed D1 deletion, media removal, cleanup-job completion and health-card failure visibility.
- [x] Verified older/newer scrolling follows parent-message order, complete reply groups remain attached to their roots, and search/gallery navigation centers the correct parent window.

## Public-launch blockers

Do not treat the app as public-launch ready until these are complete:

1. Regression coverage for state-heavy flows
- Existing Worker hardening and query-shape tests are useful but do not exercise the complete browser-visible state transitions.
- Guided support reset/escalation and one-open-ticket Worker invariants are covered. Complete deployed browser checks for support ticket visibility and reports inbox filtering.
- Add regression coverage for user-side ticket close/delete sync and super-admin dashboard ticket updates.

2. Monitoring and operator alerting
- The health dashboard, repeatable seven-day baseline audit, initial production calibration, response runbook and deduplicated email-alert implementation are complete.
- Apply migration `0039`, configure the recipient secret, deploy, and test one critical/recovery cycle. Preview failures, expected forbidden requests and media misses remain outside core paging.
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
3. Open support in two tabs and start the flow concurrently; both tabs must converge on the same open guided session.
4. Escalate concurrently from both tabs; exactly one open ticket must appear for the super admin.
5. Confirm the user cannot submit a second ticket while one is still open.
6. Close the ticket as the user and confirm the super-admin dashboard updates without retaining a stale open item.
7. Close a ticket as the super admin and confirm the user receives and can acknowledge the closed state.
8. Rerun `worker/scripts/audit-support-lifecycle.sql` and confirm both invariants still report zero duplicate users and zero excess records.
9. Open the reports inbox and confirm `Open`, `Warned`, and `Frozen` filters work.
10. Confirm the restricted-channel summary matches the currently warned/frozen channels.

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
