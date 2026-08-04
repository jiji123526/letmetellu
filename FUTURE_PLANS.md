# Future Plans

This file tracks remaining product and platform work. Implemented behavior and deployment history belong in [MIGRATION_NOTES.md](./MIGRATION_NOTES.md).

## Recommended Order

If the goal is to ship safely, the next work should stay focused on hardening and operations rather than new surface area.

1. Regression coverage for the recent chat refactors plus support, reports and dashboard state transitions.
2. Monitoring, alerting and operator visibility for the optimized Worker and dashboard paths.
3. Production email and credential-path hardening.
4. Retryable deletion, cleanup and retention workflows.
5. Durable abuse controls beyond the current first pass.
6. Operator efficiency improvements for support and moderation.
7. Larger performance redesigns only after measurement, starting with precomputed channel activity if `/api/user` remains a proven hotspot.

## Remaining Ship Work

### Abuse controls

- Expand durable rate limits to broader cross-channel abuse patterns, not just per-route throttles.
- Add stronger report-target and evidence validation for direct API callers.
- Upload access and existing ticket-quota checks now run before request-body consumption. If operational metrics show repeated authorized requests that fail before ticket creation, add a separate low-cost upload-attempt limiter rather than lowering successful-upload quotas.
- Basic JPEG, PNG, GIF and WebP signatures are now checked before R2 writes. Consider full image decoding or malware scanning only if production abuse or a future image-processing pipeline justifies the extra CPU and implementation cost.
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

- A super-admin-only operational-health endpoint now exposes bounded 15-minute and 24-hour summaries plus problem-route rollups without raw event details.
- Add dashboards or alerts for `403`, `429` and `5xx` rates.
- The operator dashboard now displays the bounded health summary with conservative polling. Introduce alert delivery only after normal production baselines are known.
- Track moderation action volume, report volume and petition outcomes.
- Track upload failures, preview failures and WebSocket auth failures.
- Add explicit monitoring for email verification, password reset and legacy password-hash upgrade behavior.
- Measure `/api/user`, platform-support dashboard and support-thread latency before pursuing another query redesign.
- Track scheduled upload-cleanup duration, deleted-ticket count and R2 deletion failures so the recent cleanup changes are operationally visible.

### Cleanup and deletion reliability

- Move channel, account and cross-store media deletion toward idempotent, retryable cleanup jobs instead of relying indefinitely on one request completing every D1, Durable Object and R2 step.
- Preserve the current synchronous user experience initially, but record durable cleanup progress so partial channel or media deletion can resume safely after a timeout or transient failure.
- Define retention and deletion policy for closed support sessions, support tickets, reports, petitions, moderation audit logs and operational events before enabling broader automated cleanup.
- Add dry-run counts, bounded batches and failure monitoring before expanding destructive scheduled maintenance.

### Precomputed channel activity

- The highest-upside remaining dashboard performance change is to stop deriving owned-channel activity from `messages` and live-config rows on every `/api/user` read.
- Do not start this migration until latency and D1 query measurements show that the optimized `/api/user` query is still a material bottleneck.
- The likely shape is a dedicated `channel_activity` table keyed by `channel_id`, or equivalent derived fields on `channels`, that stores precomputed `last_activity_at`, `last_message_at`, and live-state fields.
- This should be treated as a data-consistency project, not a small hot-path tweak. All message creation, latest-message deletion/moderation, live start, live end, live expiry, channel creation, and channel deletion paths would need to keep the derived state correct.
- Prefer a separate table over immediately extending `channels` so rollout, backfill, dual-write, and shadow comparison are easier to control.
- Safe rollout order: add schema, backfill from existing `messages` and live config, dual-write on mutations, compare derived reads against the current read-time query, switch `/api/user` to the precomputed source, then remove the old aggregation path after confidence is high.
- The main risk is stale or incorrect dashboard ordering or live badges if any write path misses an update, so this should only be done with focused regression coverage and temporary comparison logging.

### Frontend maintainability

- Treat the broad `ChatView` extraction phase as complete enough to pause. The component now delegates its major state, mutation, realtime, history, shell and layer domains.
- Add targeted regression coverage around message selectors, action rules, history navigation, realtime synchronization and the extracted layer-stack contracts before further structural changes.
- The next maintainability candidates are domain-splitting `src/lib/api.ts` and reducing the state/orchestration surface in `src/app/dashboard/page.tsx`; take one domain at a time rather than starting another broad rewrite.
- Reduce `ContextMenu` and overlay prop surfaces only when a concrete feature or testability problem justifies it.
- Continue mobile and accessibility testing for widgets, dialogs, support flows and dashboard gestures before adding another large chat UI surface.

### Email and account hardening

- Move Resend out of sandbox mode with a verified sending domain.
- Validate the legacy SHA-256 to PBKDF2 upgrade path end to end in production-like conditions.
- Continue normal dependency upgrades without using `npm audit fix --force`.

## Guided Support Follow-up

The first guided support version now exists as a separate flow from reports and from public channel chat.

Current shape:

- Guests and logged-in users open support from the dashboard help button, not from a separate inbox page.
- The default user experience is a chatbot-style decision tree with self-resolve paths.
- Escalation creates at most one open support ticket per signed actor.
- Users can reopen the guided flow while an active ticket exists, but the UI does not allow them to submit another ticket until that ticket closes.
- Closing the guided support panel abandons the in-progress guided session so reopening starts from the beginning.
- Users do not get a support history view; the ticket disappears from their side when the super admin closes it.
- A replied-to ticket can surface as a temporary channel-like item in the user dashboard, then disappears again when closed.
- Users can also dismiss that temporary support item themselves, which closes the active ticket on the super-admin side instead of keeping a separate user-only hide state.
- Guest ticket previews are mirrored in local storage for dashboard reopen convenience, while Worker authorization still relies on signed anonymous identity cookies.
- Manual locale selection now overrides device language for support-adjacent surfaces, and the legal pages now render only the active locale instead of a bilingual combined view.
- The super admin dashboard shows `Report` and `Tickets` sections instead of a mixed inbox.
- Reports still stay in the private reports inbox channel; only guided-support escalations become tickets.
- The reports inbox now includes simple `Open`, `Warned`, and `Frozen` filters plus a restricted-channel summary block for follow-up work.
- The super-admin dashboard fetch is now bounded to open tickets plus a recent closed-ticket window, and the user dashboard preview uses a lightweight support-preview read instead of loading full support state.

### Next support work

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
