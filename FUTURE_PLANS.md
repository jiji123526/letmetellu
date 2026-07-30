# Future Plans

This file tracks remaining product and platform work. Implemented behavior and deployment history belong in [MIGRATION_NOTES.md](./MIGRATION_NOTES.md).

## Recommended Order

If the goal is to ship safely, the next work should stay focused on hardening and operations rather than new surface area.

1. Durable abuse controls beyond the current first pass.
2. Monitoring, alerting and operator visibility.
3. Owner moderation lifecycle polish and regression coverage.
4. Email and credential-path production hardening.
5. Guided support follow-up and operator tooling.

## Remaining Ship Work

### Abuse controls

- Expand durable rate limits to broader cross-channel abuse patterns, not just per-route throttles.
- Add stronger report-target and evidence validation for direct API callers.
- Keep tightening upload validation toward stricter decoded-type checks.
- If the platform later exposes safe DNS or IP verification primitives, strengthen preview destination validation beyond hostname rules.

### Monitoring and alerts

- Add dashboards or alerts for `403`, `429` and `5xx` rates.
- Track moderation action volume, report volume and petition outcomes.
- Track upload failures, preview failures and WebSocket auth failures.
- Add explicit monitoring for email verification, password reset and legacy password-hash upgrade behavior.

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
- Users do not get a support history view; the ticket disappears from their side when the super admin closes it.
- A replied-to ticket can surface as a temporary channel-like item in the user dashboard, then disappears again when closed.
- Users can also dismiss that temporary support item themselves, which closes the active ticket on the super-admin side instead of keeping a separate user-only hide state.
- Guest ticket previews are mirrored in local storage for dashboard reopen convenience, while Worker authorization still relies on signed anonymous identity cookies.
- The super admin dashboard shows `Report` and `Tickets` sections instead of a mixed inbox.
- Reports still stay in the private reports inbox channel; only guided-support escalations become tickets.
- The super-admin dashboard fetch is now bounded to open tickets plus a recent closed-ticket window, and the user dashboard preview uses a lightweight support-preview read instead of loading full support state.

### Next support work

- Expand the decision tree coverage for real user issues and keep the locale strings centralized rather than growing inline logic.
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

Current production has a narrow moderation model: one manually bootstrapped reports-inbox owner can review reports, warn owners, freeze or delete channels and resolve owner petitions. The larger delegated moderation system still does not exist.

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

### Likely data model

- `platform_admins`
- `channel_reports`
- `platform_audit_logs`

Reporter network and device signals should stay HMAC-hashed; raw IP addresses and fingerprints should not be retained.

### Delivery phases

1. Finalize report categories, enforcement states and retention policy.
2. Add role, report and platform-audit migrations.
3. Implement shared platform-role checks and append-only audit helpers.
4. Keep the current reports-inbox workflow stable before adding a separate report console, if one is still needed later.
5. Add reversible restriction, suspension and restoration actions.
6. Add owner notifications, appeals and recent re-authentication for sensitive actions.

## Not Next

- Full multi-moderator RBAC before the current single-admin flow is fully stable.
- A large mixed support-plus-reports inbox built on top of the current owner DM model.
- Shareable or raw-ID anonymous support thread access outside the current signed-identity boundary.
