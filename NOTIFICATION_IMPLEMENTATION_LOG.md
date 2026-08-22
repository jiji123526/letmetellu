# Notification Implementation Log

This is the chronological implementation record for the authenticated-user Web
Push project defined in [NOTIFICATION_PLAN.md](./NOTIFICATION_PLAN.md).

## Logging rule

Every notification change must add a new entry immediately below this rule, so
the newest update is always at the top. Do not append new work to the bottom.

Each entry must record:

- scope and user-visible behavior;
- frontend, Worker, Durable Object, D1 and Service Worker changes;
- authentication and authorization boundaries;
- tests and manual verification completed;
- performance, traffic, storage and privacy impact;
- known risks, trade-offs and possible failure modes;
- deferred work and cleanup required later;
- migrations, secrets and deployment order;
- commit and rollout status.

Do not mark a phase complete while required migrations, secrets, deployment or
production verification remain outstanding. Shipped behavior must also be
summarized in [MIGRATION_NOTES.md](./MIGRATION_NOTES.md).

---

## Notification implementation branch and audit log created — 2026-08-22

### Scope

- Created the dedicated `codex/web-push-notifications` branch from `main` at
  commit `e10aa28`.
- Adopted [NOTIFICATION_PLAN.md](./NOTIFICATION_PLAN.md) as the product and
  architecture source of truth.
- Added this newest-first implementation log before changing application,
  Worker, Service Worker or database behavior.

### Current product boundary

- Only authenticated email/password or Google users are eligible.
- The project is Web Push only: no dashboard unread dots, read cursors, counts
  or in-app notification feed.
- Push remains explicit opt-in and defaults to off.
- **Important** includes authoritative channel-admin messages and live-session
  starts for eligible non-admin channel users.
- Live-session messages are not pushed individually.

### Verification

- Confirmed the branch starts from a clean `main` worktree.
- No runtime code, schema, secret or deployed behavior changed in this entry.

### Risks and concerns

- Web Push support and permission recovery vary by browser; iOS generally needs
  an installed Home Screen web app.
- Push endpoint/key material is sensitive and must not appear in logs, client
  analytics or support responses.
- Recipient eligibility must be checked again at delivery time because channel
  access, blocks, passcodes and preferences can change after event creation.
- Notification delivery must remain outside message and live-start response
  latency. A direct synchronous fan-out implementation is not acceptable.
- Active-channel suppression cannot rely only on WebSocket connection state,
  because a connected background tab is not necessarily visible.

### Deferred work

1. Confirm standards-based VAPID delivery versus a managed provider.
2. Add the subscription/preference schema in a reversible migration.
3. Add authenticated API contracts and server-side authorization coverage.
4. Add Service Worker registration and explicit channel opt-in UI.
5. Add durable outbox processing before real recipient fan-out.
6. Add important admin-message delivery, then live-start delivery as a separate
   measured phase.
7. Update privacy disclosures before enabling production subscriptions.

### Deployment

- No deployment is required for this documentation-only entry.
- Commit and remote branch status are recorded when this entry is committed and
  pushed.

