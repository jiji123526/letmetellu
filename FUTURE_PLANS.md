# Future Plans

Since the reporting flow is already in place, the next direction should be
moderation hardening and operations, not more surface features.

## Recommended Order

1. **Abuse controls**  
   Add durable server-side limits for reports, messages, uploads, and preview
   fetches. The biggest remaining gap is that some limits are still
   memory-local or too soft.

2. **Moderation audit trail**  
   Store every freeze, unfreeze, delete, resolve, dismiss, and petition
   decision in an append-only log. Once moderation affects real users,
   traceability matters more than new UI.

3. **Owner moderation lifecycle**  
   Tighten the full flow for warned or frozen channel owners: `warning` ->
   `freeze` -> `petition` -> `accept/reject` -> `unfreeze/delete`. This is
   where product quality will matter most.

4. **Security headers and dependency cleanup**  
   Add CSP, `nosniff`, referrer policy, frame policy, and HSTS, then do
   dependency upgrades safely. This is straightforward risk reduction before a
   wider launch.

5. **Operational visibility**  
   Add basic metrics and alerts for report volume, moderation actions,
   `403`/`429`/`5xx` rates, upload failures, and WebSocket auth failures.

## Not Yet

- Full multi-moderator RBAC
- A large separate super-admin console
- A mixed global support inbox inside the current report flow

These are worth doing only after the current single-admin moderation flow is
stable.

## If The Goal Is To Ship Soon

- Durable quotas and rate limits
- Audit log
- Security headers
- Moderation edge-case testing

## If The Goal Is To Grow The Product

After the hardening work above, the next feature is more likely separate
support threads, not more reporting UI.

## 1:1 Support Plan

Build `1:1` support as a dedicated ticket system, separate from reports and
separate from channel chat.

### MVP Shape

- The platform-admin dashboard has two tabs: `Report` and `1:1`.
- `1:1` shows active support tickets only.
- One open ticket per user.
- When the platform admin closes a ticket, it disappears from the user side
  and from the active admin list.
- Closed tickets stay archived in the database rather than being hard-deleted.

### Recommended Constraints

- Logged-in users only for the first version.
- No multi-agent assignment.
- No reopen flow from the user side.
- No anonymous support until there is a bearer-thread access model and stronger
  abuse controls.

Logged-in-only is the correct first cut because support access needs stable
identity. Anonymous support should not rely on browser-local UID or device
signals.

### User Flow

1. User opens `1:1 Support`.
2. If the user already has an open ticket, load it.
3. Otherwise create a new ticket.
4. User and platform admin chat in that ticket.
5. Platform admin closes the ticket when the issue is resolved.
6. The closed thread is no longer available from the user side.

### Platform-Admin Flow

1. Open the dashboard.
2. Select the `1:1` tab.
3. See the active ticket list with user, last message and updated time.
4. Open a ticket and reply in-thread.
5. Close the ticket when done.

### Data Model

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

### API Shape

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

### UI Shape

User side:

- a simple support panel rather than a public channel
- only the current open ticket is visible
- if the ticket is closed, show no thread or a closed-state message

Platform-admin side:

- a left list of active tickets
- a right conversation panel
- a `Close ticket` action at the top

### Safety Requirements

Before launch:

- rate-limit ticket creation
- rate-limit support messages
- enforce a message length limit
- keep one open ticket per user
- add a basic audit log for thread creation, admin replies and ticket closure

### Implementation Order

1. Add `support_threads` and `support_messages`.
2. Add user routes for create, load and send.
3. Add platform-admin routes for list, reply and close.
4. Build the admin `1:1` tab.
5. Build the user-side support panel.
6. Add close behavior and archive semantics.
7. Add rate limits and audit logging.
