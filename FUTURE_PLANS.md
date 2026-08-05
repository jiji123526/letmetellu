# Future Plans

This file tracks remaining product and platform work. Implemented behavior and deployment history belong in [MIGRATION_NOTES.md](./MIGRATION_NOTES.md).

## Recommended Order

If the goal is to ship safely, the next work should stay focused on hardening and operations rather than new surface area.

1. Complete custom-domain, authentication, email and realtime smoke tests, then remove transition origins.
2. Add regression coverage for the recent chat refactors plus support, reports and dashboard state transitions.
3. Calibrate the existing operational-health view from production baselines, then add alert delivery and response procedures.
4. Add explicit monitoring for production email and legacy credential-upgrade paths.
5. Move deletion, cleanup and retention toward retryable, observable workflows.
6. Expand durable abuse controls beyond the current first pass.
7. Pursue larger performance redesigns only after measurement, starting with precomputed channel activity if `/api/user` remains a proven hotspot.

## Remaining Ship Work

### Custom domain cutover

- The apex deployment, HTTPS security headers, permanent `www` redirect, provider-specific Google callbacks and production authentication/realtime smoke tests are complete for limited beta.
- Retain the matching legacy Vercel OAuth callbacks only during rollback readiness.
- After smoke tests and rollback readiness are complete, narrow production Worker CORS to `https://yapndot.com`. Remove the legacy Vercel hostname, remove `www` after its permanent apex redirect is confirmed, and move localhost to development-only Wrangler configuration.
- Plan a separate CSP hardening change to remove `script-src 'unsafe-inline'`. Treat the current setting as an accepted limited-beta defense-in-depth gap, not as evidence of a known exploitable XSS. First replace the inline theme bootstrap with request-scoped nonce handling, remove the generic arbitrary-HTML contract from `ConfirmDialog`, and preserve only the exact script/frame origins needed by supported widgets.
- Roll out the stricter CSP in report-only or focused preview validation first, then verify dark-mode startup, authentication, dashboard, chat, dialogs, X/Twitter and Instagram widgets, and the final production response headers before enforcement. Do not remove `'unsafe-inline'` as a header-only change.

### Abuse controls

- Expand durable rate limits to broader cross-channel abuse patterns, not just per-route throttles.
- Add stronger report-target and evidence validation for direct API callers.
- Add a separate low-cost upload-attempt limiter only if metrics show repeated authorized requests failing before ticket creation; do not lower successful-upload quotas preemptively.
- Consider full image decoding or malware scanning only if production abuse or a future image-processing pipeline justifies the additional CPU and implementation cost.
- If the platform later exposes safe DNS or IP verification primitives, strengthen preview destination validation beyond hostname rules.

### Rewarded media credits

- If the product adds "watch an ad to unlock 5 media sends", treat it as a server-enforced media-credit system rather than a frontend-only toggle.
- Define the unit clearly before implementation. The safest definition is `5` image attachments, not `5` message composer opens or one-time upload permission.
- Persist credits durably in D1 against the signed actor identity used for chat writes: authenticated user ID when logged in, otherwise the anonymous UID plus device-bound identity path already used by chat enforcement.
- Verify rewarded-ad completion on the server before granting credits. Do not trust a client callback alone, and do not ship the feature until a web-capable rewarded-ad provider and verification flow are confirmed.
- Enforce credit consumption in the Worker when a message or DM image attachment is successfully committed, not only when a blob upload starts. Uploads can fail or remain unattached, while message and DM attachment already pass through durable upload-ticket validation.
- Start with normal channel messages only. Leave DMs, live chat and any moderation/report-only channels out of scope until the base reward and deduction path is stable.
- Add explicit product limits before launch: stacking policy, expiry window, daily cap, behavior when a queued multi-image send exceeds remaining credits, and whether failed sends should refund the unused credit.
- Add audit and monitoring for reward grants, reward verification failures, credit consumption, suspicious repeat claims and upload/send mismatch rates before exposing the feature broadly.

### Monitoring and alerts

- Establish normal production baselines for the existing super-admin health card, then calibrate its `5xx`, exception and `429` thresholds.
- Track WebSocket disconnect, reconnect-attempt and authorization-failure counts so the jittered exponential reconnect policy can be calibrated from production recovery behavior.
- Add external alert delivery for degraded or critical health only after threshold calibration, with a documented operator response and escalation path.
- Add bounded summaries for moderation action volume, report volume, petition outcomes and support queue age; the underlying audit records already exist, but these trends are not yet presented.
- Add explicit operational-event coverage for upload failures, preview failures and WebSocket authorization/origin failures.
- Add explicit monitoring for email verification, password reset and legacy password-hash upgrade behavior.
- Measure `/api/user`, platform-support dashboard and support-thread latency before pursuing another query redesign.
- Track scheduled-maintenance duration, per-table deletion counts and R2 deletion failures so the existing bounded cleanup work is operationally visible.

### Measured performance follow-up

- The current 2026-08-05 frontend baseline from Next route bundle stats is still too heavy for the simplest routes: `/` at about `591 KB`, `/support` at about `634 KB`, `/privacy` and `/terms` at about `667 KB`, `/dashboard` at about `714 KB`, and `/ch/[slug]` at about `849 KB` of first-load uncompressed JS.
- Treat that route-bundle snapshot, plus request counts for dashboard refresh and chat reconnect paths, as the baseline for the next optimization pass. Re-measure after each phase instead of stacking another broad rewrite.
- Start with bundle and request-churn reductions that do not require a schema migration. Keep larger derived-data redesigns conditional on measured backend hotspots that remain after the cheaper changes ship.

#### Phase 1: global bundle reduction

- Completed on 2026-08-05: the root layout no longer mounts the full provider shell for every route, and `/privacy` plus `/terms` now render on the server from request locale instead of waiting on a client hydration gate.
- Remaining Phase 1 work: split `src/lib/api.ts` by domain and lazy-load mock-only helpers instead of shipping support, mock and dashboard helpers into unrelated route bundles.
- Re-run route-bundle measurement after the API split with focus on `/dashboard` and `/ch/[slug]`, because the static legal-page win is already landed while the interactive routes remain the larger bundle problem.

#### Phase 2: dashboard refresh consolidation

- Replace the overlapping dashboard timers plus focus and visibility listeners with one stale-time-aware foreground polling path.
- Keep the current in-flight dedupe, but move refresh policy into one place so support preview, admin dashboard and operational-health refreshes cannot fan out from multiple effects on the same focus event.
- Add lightweight measurement for dashboard refresh count and network fan-out before and after the consolidation so the change is validated with real request reductions, not just cleaner code.
- Do not expand dashboard surface area until the current refresh model is simplified and measured.

#### Phase 3: chat init and reconnect shaping

- Reduce full `fetchInit` reloads on reconnect, live-session transitions and passcode/access changes when a narrower refresh or realtime payload can keep state accurate.
- Revisit secondary reads such as owner-channel-count lookups so they do not rerun on unrelated channel-state changes.
- Keep the current correctness bias for passcode, moderation and live-state transitions, but separate "must refetch full init" cases from "message snapshot or targeted field refresh is enough" cases.
- Measure reconnect request count, post-reconnect settle time and visibility-resume behavior before and after this pass.

#### Phase 4: support dashboard query tuning

- Replace the current per-thread correlated support subqueries with joined rollups or CTEs for last message, sender, unread and reply-state fields.
- Add composite indexes that match the platform-support dashboard scans and message-rollup access patterns, then benchmark open-ticket and recent-closed-ticket reads before and after.
- Keep the existing dashboard behavior stable while tuning query shape first; do not jump to a broader support schema redesign unless latency remains materially high after query and index work.
- Re-check operational-health summaries and platform-support latency after rollout so the next backend bottleneck is identified from measurement rather than assumption.

#### Phase 5: conditional derived activity redesign

- If `/api/user` still remains a proven hotspot after the earlier frontend, polling and support-query work, continue with the precomputed channel-activity plan below.
- Do not skip directly to derived channel activity while the cheaper bundle, refresh-policy and query-shape reductions are still available.

### Cleanup and deletion reliability

- Move channel, account and cross-store media deletion toward idempotent, retryable cleanup jobs instead of relying indefinitely on one request completing every D1, Durable Object and R2 step.
- Preserve the current synchronous user experience initially, but record durable cleanup progress so partial channel or media deletion can resume safely after a timeout or transient failure.
- Existing scheduled retention covers operational events, moderation/support audit logs, message actor identities, rate-limit rows and expired upload tickets. Define policy for closed support sessions and tickets, reports and petitions before extending automated cleanup to those product records.
- Add dry-run counts, bounded batches and failure monitoring before expanding destructive scheduled maintenance.
- The 2026-08-04 pre-beta cleanup removed seven legacy credential test accounts, their four owned channels and six additional orphan channels through an exact-ID, precondition-checked one-time maintenance run. The temporary route was removed immediately afterward; all Google accounts, the platform `reports` channel, `whaaa` and the new verified credential account were confirmed preserved.

### Precomputed channel activity

- The highest-upside remaining dashboard performance change is to stop deriving owned-channel activity from `messages` and live-config rows on every `/api/user` read.
- The intermediate 2026-08-05 optimization added an indexed latest-visible-message lookup, replacing the full per-owner message aggregation. Measure that rollout before pursuing this larger redesign.
- Do not start this migration until latency and D1 query measurements show that the optimized `/api/user` query is still a material bottleneck.
- The likely shape is a dedicated `channel_activity` table keyed by `channel_id`, or equivalent derived fields on `channels`, that stores precomputed `last_activity_at`, `last_message_at`, and live-state fields.
- This should be treated as a data-consistency project, not a small hot-path tweak. All message creation, latest-message deletion/moderation, live start, live end, live expiry, channel creation, and channel deletion paths would need to keep the derived state correct.
- Prefer a separate table over immediately extending `channels` so rollout, backfill, dual-write, and shadow comparison are easier to control.
- Safe rollout order: add schema, backfill from existing `messages` and live config, dual-write on mutations, compare derived reads against the current read-time query, switch `/api/user` to the precomputed source, then remove the old aggregation path after confidence is high.
- The main risk is stale or incorrect dashboard ordering or live badges if any write path misses an update, so this should only be done with focused regression coverage and temporary comparison logging.

### Frontend maintainability

- Add targeted regression coverage around message selectors, action rules, history navigation, realtime synchronization and the extracted layer-stack contracts before further structural changes.
- The next maintainability candidates are domain-splitting `src/lib/api.ts` and reducing the state/orchestration surface in `src/app/dashboard/page.tsx`; take one domain at a time rather than starting another broad rewrite.
- Reduce `ContextMenu` and overlay prop surfaces only when a concrete feature or testability problem justifies it.
- Continue mobile and accessibility testing for widgets, dialogs, support flows and dashboard gestures before adding another large chat UI surface.

### Email and account hardening

- Monitor Resend delivery, bounce and failure behavior during beta.
- Rehearse signup verification and password reset with a non-owner mailbox from the canonical production domain.
- Validate the legacy SHA-256 to PBKDF2 upgrade path end to end in production-like conditions.
- The beta dependency pass is currently clean under both production-only and full `npm audit`; repeat the audit before broader releases and continue normal upgrades without `npm audit fix --force`.

## Guided Support Follow-up

The implemented guided-support and operator-dashboard shape is recorded in [MIGRATION_NOTES.md](./MIGRATION_NOTES.md). Remaining work:

- Add focused regression tests for guided-session reset, active-ticket visibility, report filters and dashboard sync between user and super-admin views.
- Expand the decision tree coverage for real user issues and keep all new user-facing support copy in the centralized locale files rather than growing inline logic again.
- Add operator macros or close-reason presets for common support replies once the current flow stabilizes.
- Add explicit pagination or archive filtering for older closed tickets if the operator audit workflow outgrows the current recent-closed window.
- Decide whether support audit logs need an operator-visible review UI or should remain backend-only for incident tracing.
- Decide the retention window for closed support sessions and tickets, then automate cleanup if the audit policy allows it.

### Constraints to keep

- No second open ticket while one is already active for the same signed actor.
- No user-visible closed-ticket archive.
- No separate user-only "hide ticket" state that diverges from the actual support-thread status.
- No mixed report-plus-support inbox.
- No paid or plan-gated support path.

## Platform Moderation Direction

Current production has a narrow moderation model: one manually bootstrapped reports-inbox owner can review reports, warn owners, freeze or delete channels and resolve owner petitions. Durable reports, moderation state, petitions and moderation audit logs already exist; delegated platform roles still do not.

### Principles

- Platform moderation remains separate from channel ownership.
- The browser never submits its own trusted role.
- Vercel can authenticate the session, but the Worker makes the final authorization decision.
- Sensitive platform actions should live under a dedicated `/api/platform-admin/*` namespace.

### Proposed roles

| Role | Scope |
| --- | --- |
| `reviewer` | View reports and evidence, add internal review notes |
| `moderator` | Resolve reports, warn owners, restrict, suspend and restore channels |
| `super_admin` | Grant and revoke operator roles, perform destructive or system-level actions |

### Existing foundation

- `channel_reports`
- `channel_moderation`
- `channel_petitions`
- `moderation_audit_logs`

### Future additions

- Add `platform_admins` only if the product actually needs delegated reviewer and moderator roles.
- Extend the existing moderation audit model instead of creating a second overlapping platform-audit system unless non-moderation operator actions require a separate boundary.

Reporter network and device signals should stay HMAC-hashed; raw IP addresses and fingerprints should not be retained.

### Delivery phases

1. Add regression coverage and retention policy for the existing report, warning, freeze, deletion, restoration and petition flows.
2. Decide whether the current single-super-admin model is still insufficient before adding role infrastructure.
3. If delegation is needed, add `platform_admins`, shared role checks and a migration path from reports-inbox ownership.
4. Add operator assignment and audit-review UI without replacing the existing reports-inbox workflow prematurely.
5. Require recent authentication for destructive or system-level actions.
6. Add a separate report console only if measured operator workflow problems justify it.

## Not Next

- Full multi-moderator RBAC before the current single-admin flow is fully stable.
- A large mixed support-plus-reports inbox built on top of the current owner DM model.
- Shareable or raw-ID anonymous support thread access outside the current signed-identity boundary.
- Another broad `ChatView` extraction pass without a concrete feature, defect or testability reason.
- Precomputed channel activity without production measurements, a backfill, dual writes and shadow comparison.
