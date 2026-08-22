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

## Authenticated Web Push schema foundation added — 2026-08-22

### Scope and behavior

- Added D1 migration `0055_web_push_subscription_foundation.sql` with
  channel-scoped notification preferences and user-owned browser subscriptions.
- Added a focused schema regression test and an operational query-plan audit.
- This step has no user-visible behavior. It does not request notification
  permission, register a Service Worker, expose an API or send a notification.

### D1 design

- `notification_preferences` uses `(user_id, channel_id)` as its primary key,
  defaults to `off`, and accepts only `off`, `important` or `all`.
- Preference rows cascade when their authenticated user or channel is deleted.
- A partial `(channel_id, mode, user_id)` index bounds future recipient lookup
  to opted-in rows instead of scanning disabled preferences.
- `push_subscriptions` stores one unique Push API endpoint plus its `p256dh` and
  `auth` keys, ownership, optional expiry/device metadata, delivery timestamps,
  failure count and revocation timestamp.
- A partial `(user_id, updated_at DESC)` index covers active-device lookup while
  excluding revoked subscriptions.
- Delivery/outbox tables are deliberately deferred until subscription APIs and
  their authorization boundary are complete.

### Authentication, authorization and privacy

- Both tables require an existing account through `users(id)`; there is no
  anonymous visitor or browser-local identity column.
- Preferences are channel-scoped through `channels(id)`, but foreign keys alone
  do not prove that a user may subscribe to that channel. Every future API must
  validate the authenticated account, channel relationship and ownership of the
  subscription being changed.
- Push endpoints and their `p256dh`/`auth` values are sensitive credentials.
  Future request, error and analytics logs must redact them completely.

### Verification

- The focused Node schema test checks account/channel foreign keys, preference
  modes, primary/unique constraints, failure-count validation, partial indexes
  and the deliberate absence of an outbox.
- The D1 audit script lists installed objects and foreign keys and uses
  `EXPLAIN QUERY PLAN` for future recipient and active-device lookups.
- Isolated local migration, the focused test and the complete Worker hardening
  suite are recorded when this change is committed.

### Performance, storage and trade-offs

- This adds no query or write to message send, live start or channel reads yet.
  Rows are created only when a later API explicitly saves a preference or
  browser subscription.
- The two partial indexes add modest storage and preference/subscription write
  cost in exchange for bounded delivery-time lookups.
- A unique endpoint prevents duplicate delivery to the same browser endpoint,
  but account changes must later reassign or rotate that row atomically.
- Revocation preserves diagnostic state and avoids immediate destructive
  deletion, but stale revoked rows will eventually need a retention policy.
- `quiet_hours_json` is nullable groundwork only. Its shape and timezone rules
  must be validated by the future API before the field is used.
- Cascades require D1 foreign-key enforcement. The isolated migration audit
  verifies their declared shape; deletion regression coverage remains required
  before production rollout.

### Deferred work

1. Define and test the authoritative meaning of a user being associated with a
   channel for notification eligibility.
2. Add authenticated preference and subscription APIs with endpoint/key
   redaction, device caps and ownership checks.
3. Add explicit opt-in UI and Service Worker subscription registration.
4. Add a durable outbox and asynchronous delivery only after the API boundary is
   stable.

### Deployment

- Branch implementation only: the production D1 migration has not been applied.
- Worker and frontend behavior are unchanged and no Worker deployment is needed
  for this schema-only branch step.
- Production rollout order remains migration first, then the compatible Worker,
  then frontend opt-in UI. Commit and remote status are recorded in git history.

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
