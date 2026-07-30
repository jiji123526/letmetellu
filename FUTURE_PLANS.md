# Future Plans

This file tracks remaining product and platform work. It is intentionally forward-looking; implemented changes and deployment history belong in [MIGRATION_NOTES.md](./MIGRATION_NOTES.md).

## Recommended Order

If the goal is to ship safely, the next work should stay focused on hardening and operations rather than new surface area.

1. Durable abuse controls beyond the current first pass.
2. Monitoring, alerting and operator visibility.
3. Owner moderation lifecycle polish and regression coverage.
4. Email and credential-path production hardening.
5. Dedicated support threads.

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

## 1:1 Support Plan

Build `1:1` support as a dedicated ticket system, separate from reports and separate from public channel chat.

### MVP shape

- The platform-admin dashboard has two tabs: `Report` and `1:1`.
- `1:1` shows active support tickets only.
- One open ticket per user.
- When the platform admin closes a ticket, it disappears from the user side and from the active admin list.
- Closed tickets stay archived in the database rather than being hard-deleted.

### Recommended constraints

- Logged-in users only for the first version.
- No multi-agent assignment.
- No reopen flow from the user side.
- No anonymous support until there is a stronger bearer-thread access model and better abuse controls.

Logged-in-only is the correct first cut because support access needs stable identity. Anonymous support should not rely on browser-local UID or device signals.

### User flow

1. User opens `1:1 Support`.
2. If the user already has an open ticket, load it.
3. Otherwise create a new ticket.
4. User and platform admin chat in that ticket.
5. Platform admin closes the ticket when the issue is resolved.
6. The closed thread is no longer available from the user side.

### Platform-admin flow

1. Open the dashboard.
2. Select the `1:1` tab.
3. See the active ticket list with user, last message and updated time.
4. Open a ticket and reply in-thread.
5. Close the ticket when done.

### Data model

`support_threads`

- `id`
- `user_id`
- `status` = `open | closed`
- `created_at`
- `updated_at`
- `closed_at`
- `closed_by`

`support_messages`

- `id`
- `thread_id`
- `sender_role` = `user | platform_admin`
- `sender_user_id`
- `text`
- `created_at`

Optional later:

- `subject`
- `last_read_user_at`
- `last_read_admin_at`

### API shape

User-facing routes:

- `GET /api/support/thread`
- `POST /api/support/thread`
- `GET /api/support/messages?thread_id=...`
- `POST /api/support/messages`

Platform-admin routes:

- `GET /api/platform-admin/support/threads`
- `GET /api/platform-admin/support/messages?thread_id=...`
- `POST /api/platform-admin/support/messages`
- `POST /api/platform-admin/support/close`

### UI shape

User side:

- a simple support panel rather than a public channel
- only the current open ticket is visible
- if the ticket is closed, show no thread or a closed-state message

Platform-admin side:

- a left list of active tickets
- a right conversation panel
- a `Close ticket` action at the top

### Safety requirements

Before launch:

- rate-limit ticket creation
- rate-limit support messages
- enforce a message length limit
- keep one open ticket per user
- add a basic audit log for thread creation, admin replies and ticket closure

### Implementation order

1. Add `support_threads` and `support_messages`.
2. Add user routes for create, load and send.
3. Add platform-admin routes for list, reply and close.
4. Build the admin `1:1` tab.
5. Build the user-side support panel.
6. Add close behavior and archive semantics.
7. Add rate limits and audit logging.

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
4. Build a dedicated `/platform/reports` queue and detail view.
5. Add reversible restriction, suspension and restoration actions.
6. Add owner notifications, appeals and recent re-authentication for sensitive actions.

## Not Next

- Full multi-moderator RBAC before the current single-admin flow is fully stable
- A large mixed support-plus-reports inbox built on top of the current owner DM model
- Anonymous support threads before there is a secure bearer-thread access design
