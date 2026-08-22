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

## Authenticated preference and subscription APIs added — 2026-08-22

### Scope and user-visible behavior

- Added authenticated API contracts for reading/updating one channel's
  notification preference, registering/rotating a browser Push subscription and
  revoking a current user's device.
- Added matching Next.js same-origin session proxies and the Worker route.
- There is still no settings UI, Service Worker registration, permission prompt,
  VAPID key or delivery path. Users see no notification-related UI yet.
- The first rollout accepts only `off` and `important`; the schema's future
  `all` mode remains inaccessible until important-only delivery is stable.

### Authentication and channel authorization

- Next.js requires an Auth.js user ID and forwards it through the existing
  internal-secret identity boundary. The Worker rejects forged or missing
  internal identity and also requires the account to exist in D1.
- A non-owner may enable a public channel only when it is present in that
  account's recent-channel association table. Owners are accepted directly.
- A protected channel additionally requires a currently valid room token bound
  to its current passcode. Migration `0056_notification_access_binding.sql`
  stores that passcode binding on opt-in so future delivery can suppress stale
  access after a passcode change.
- Turning a preference off deletes only that user's preference and remains
  possible after channel access is lost, avoiding a stuck opt-in.

### Subscription privacy and abuse boundaries

- Subscription bodies are limited to 8 KiB at both proxy and Worker layers.
  Endpoints must be HTTPS and endpoint/key/label lengths are bounded.
- Only a coarse browser family is stored. Full user-agent strings are normalized
  in the Worker and discarded.
- API responses return device IDs and coarse summaries only. Push endpoints,
  `p256dh` and `auth` secrets are never returned or logged.
- Registration atomically limits an account to five active endpoints. Presenting
  an existing endpoint rotates its ID and keys and may reassign it to the newly
  authenticated account, which supports browser account switching without
  duplicate delivery.
- Revocation is idempotent and always scoped by both subscription ID and current
  user ID, preventing one account from revoking another account's device.
- Preference and subscription mutations use hashed per-user rate-limit buckets:
  30 changes per category per ten minutes.
- Every browser mutation requires an exact same-origin `Origin` header. Missing
  or cross-origin mutation requests fail closed before reaching the Worker.

### Verification

- Added validation and authorization regression coverage for allowed modes,
  HTTPS/key shape, body bounds, current room access, opt-out recovery, ownership,
  secret redaction, five-device enforcement, rate limits and same-origin proxies.
- Focused notification tests passed 12 tests; the full Worker hardening suite
  passed 304 tests.
- Worker TypeScript, frontend TypeScript and the Next.js production build pass.
- A fresh isolated D1 accepted all 56 migrations. A local SQL smoke test stored
  the access binding, retained exactly five active devices and rejected a sixth.

### Performance, traffic and storage

- Normal chat, dashboard, message-send and live-start paths are unchanged.
- Preference reads perform an indexed account existence probe, one indexed
  channel/association access query, then preference and at-most-five-device
  reads in parallel. These queries run only when notification settings are
  opened later.
- Each mutation spends two small D1 operations on the durable rate-limit bucket
  before its preference/subscription write. This is deliberate abuse protection
  on a low-frequency settings path, not a message hot-path cost.
- `access_binding` adds one nullable text value per opted-in protected channel;
  public-channel and owner preferences store null.

### Risks and trade-offs

- Public-channel association uses the existing recent-channel account table.
  That is sufficient for public data but is not treated as proof for protected
  channels, which require the current room token.
- Exact `Origin` enforcement intentionally prevents CLI or server-to-server
  mutation callers that do not provide a browser origin. No such caller exists
  in the current product.
- Endpoint reassignment is necessary when the same browser changes accounts,
  but it makes the newest authenticated registration authoritative. Endpoint
  and key secrecy therefore remains critical.
- Rate-limit accounting adds D1 writes even for repeated invalid state changes
  after input parsing. Sustained 429 metrics should be reviewed before changing
  the conservative threshold.
- The stored protected-room binding is not used for delivery yet. The outbox
  worker must compare it with the current passcode binding before enqueue/send.

### Deferred work and external resources

1. Add explicit channel opt-in UI and browser support education.
2. Choose direct standards-based VAPID delivery or a managed provider and create
   the required public/private credentials.
3. Register the Service Worker and browser subscription only after explicit user
   action.
4. Add the durable outbox and delivery-time access revalidation before enabling
   real pushes.
5. Add retention for revoked endpoints and decide whether `all` mode should ever
   be exposed.

### Deployment

- Implementation commit and branch push precede rollout.
- Production rollout is pending in this entry: apply migration `0056` first,
  then deploy the backward-compatible Worker route. Frontend production remains
  unchanged until this branch is merged and its API proxies deploy.

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

- Production D1 migration `0055_web_push_subscription_foundation.sql` was
  applied successfully on 2026-08-22. A follow-up migration listing reported no
  pending migrations.
- The remote audit executed all five schema/foreign-key/query-plan checks
  successfully, reading 194 rows and writing 0 rows.
- Worker and frontend behavior are unchanged, so no Worker or frontend deploy
  was performed for this schema-only step.
- The next rollout remains a backward-compatible Worker API deployment before
  any frontend opt-in UI. Commit and remote status are recorded in git history.

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
