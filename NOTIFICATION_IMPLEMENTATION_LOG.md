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

## Rate-limited self-test delivery and durable outbox added — 2026-08-22

### Scope and user-visible behavior

- Added a self-test delivery endpoint and a durable D1 outbox. It can send only
  fixed localized `yap.` connection-confirmation copy to one active subscription
  owned by the current authenticated user.
- There is still no visible toggle or automatic permission prompt. The frontend
  helper is ready to register a browser and request its self-test from a future
  explicit settings action, but importing it causes no network or browser work.
- Admin messages and live starts do not enqueue notifications yet. Normal chat,
  message persistence, realtime acknowledgement and live-start latency remain
  unchanged.

### Authentication, authorization and abuse controls

- The Next.js self-test proxy requires an Auth.js session and exact same-origin
  browser mutation. The Worker repeats trusted-user validation and verifies the
  requested subscription ID belongs to that user and is not revoked.
- Request bodies retain the existing 8 KiB limit and accept only a UUID plus
  `ko` or `en`. Callers cannot choose notification title, body, URL or tag.
- Self-tests are limited to three per authenticated user per 24 hours using the
  existing hashed durable rate-limit buckets. The newly inserted outbox ID is
  passed directly to the background processor, so another queued event cannot
  delay the interactive test.
- Subscription endpoints and encryption keys remain absent from responses and
  logs. Push errors retain only a bounded HTTP-class error code.

### Outbox consistency and failure handling

- Migration `0057_notification_delivery_outbox.sql` adds unique event keys,
  user/channel/subscription ownership, status, attempts, next-attempt time,
  leases and error classification. Foreign keys cascade account/channel/delete
  cleanup, and subscription ID rotation cascades queued rows.
- Requests commit the outbox row before returning `202`; delivery runs under
  `ctx.waitUntil`, not in the response latency. The five-minute cron recovers
  transient failures or a Worker interruption.
- Claims use a two-minute conditional lease. A concurrent worker can process a
  row only if it wins the guarded update; expired processing leases can be
  reclaimed.
- HTTP 404/410 permanently revokes a dead browser endpoint. Transport errors,
  408, 429 and 5xx retry at bounded 1-minute, 5-minute and 30-minute delays, with
  at most four attempts. Other 4xx responses become dead immediately.

### Performance, dependencies and trade-offs

- The delivery batch is capped at ten. An empty ready-queue index probe occurs
  only on the five-minute cron, approximately 288 very small D1 reads per day.
  This is acceptable for the initial rollout but should be replaced by a
  queue/alarm wakeup if push volume grows materially.
- Each claimed delivery currently uses a candidate read, guarded claim, joined
  subscription read and a small outcome batch. This prioritizes recoverability
  and secret isolation over minimum D1 operation count.
- Added the mature `web-push` package recommended by Cloudflare and enabled
  `nodejs_compat`. The dry-run Worker bundle grew from about 105 KiB to 166 KiB
  gzip. The code runs only in delivery processing, but compatibility shims widen
  the bundle and should be reconsidered if an equally mature native Web Crypto
  implementation emerges.
- Updating Wrangler from 4.113 to 4.125 removed four high-severity development-
  dependency audit findings. The Worker package audit now reports zero known
  vulnerabilities.
- Delivered/dead outbox retention cleanup is not included yet. The three-per-day
  self-test cap bounds interim growth, but retention must be added before admin
  message fanout.

### Verification and rollout

- Focused notification/schema tests pass 18 cases; the full Worker hardening
  suite passes 310 tests. Worker/frontend TypeScript and the Next.js production
  build pass, and Wrangler successfully bundles `web-push` in a dry run.
- A local D1 accepted migration `0057`. Production migration, implementation
  commit, Worker deploy and a real browser self-test remain required before this
  entry is marked rolled out.

### Next step

1. Apply migration `0057`, deploy the Worker and verify unauthenticated denial.
2. Add a localized explicit opt-in control and run one real browser self-test.
3. Add bounded delivered/dead retention before admin-message fanout.

## Direct VAPID browser foundation added — 2026-08-22

### Scope and user-visible behavior

- Selected direct standards-based VAPID delivery rather than a managed push
  provider. Added an authenticated public-key endpoint, a dedicated Push Service
  Worker and a browser subscription helper.
- This stage still has no visible toggle and never requests permission on page
  load. The helper can be called only by the future explicit settings action, so
  deploying this foundation does not display a browser prompt or create a
  subscription by itself.
- Notification delivery, outbox writes and chat/live hot paths remain unchanged.

### Security and privacy boundaries

- The VAPID public key is returned only through the authenticated Next.js proxy.
  The Worker validates its expected uncompressed P-256 base64url shape and
  returns `503 push_not_configured` when secrets are absent or malformed.
- `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are Worker-only secrets. They are not
  referenced by frontend code, API responses, committed files or logs.
- The Service Worker accepts notification navigation only for same-origin
  `/ch/` paths. External URLs and unrelated same-origin paths fall back to the
  dashboard, preventing a future payload bug from becoming an open redirect.
- Subscription serialization sends only the browser-issued endpoint, `p256dh`,
  `auth`, optional expiry and a bounded device label to the existing protected
  API. The client does not persist this material in local storage.

### Performance and trade-offs

- The public key is fetched only during explicit subscription and is private-
  cached for five minutes. Normal page loads perform no notification request.
- The Service Worker is registered only after permission is granted. This avoids
  adding a worker to users who never opt in, but the first opt-in has a small
  registration/setup delay.
- An existing browser subscription is reused. Rotating VAPID keys later would
  therefore require an explicit resubscription migration; production keys must
  be treated as stable credentials and backed up securely.
- The implementation intentionally defers a delivery library. This keeps an
  immature or Node-compatibility dependency out of the Worker until outbox and
  retry semantics are ready, but a real test notification cannot be sent in
  this stage.

### Verification and rollout

- Added regression checks for authenticated key access, explicit-only browser
  permission, subscription serialization and click-target validation.
- The full Worker hardening suite passes 308 tests. Worker/frontend TypeScript
  checks and the Next.js production build pass; the build includes the new
  authenticated `/api/notifications/vapid-key` route.
- Required production secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
  `VAPID_SUBJECT=mailto:yapndot@gmail.com`. All three are configured on the
  production Worker, and the stable pair has a local mode-600 backup outside
  the repository.
- Worker version `25dd2f3f-da12-419b-96ad-b1b41e395d7f` is deployed. The public
  browser helper and Next.js proxy remain feature-branch-only until merge, so an
  end-to-end authenticated browser subscription is intentionally deferred to
  the opt-in UI/self-test stage.

### Next step

1. Add a tightly rate-limited self-test delivery path using the durable outbox.
2. Add localized explicit opt-in UI only after self-test delivery succeeds.
3. Add admin-message events and then live-start events without awaiting push
   delivery in either authoritative write response.

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
- Preference reads compare the stored and current access bindings. A passcode
  change is returned as `off` with `requiresReconfirmation` until the user
  explicitly opts in again, avoiding an enabled-looking control that cannot
  deliver.
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

- Implementation commit `54c6255` was pushed to
  `codex/web-push-notifications` before rollout.
- Production D1 migration `0056_notification_access_binding.sql` was applied
  successfully; a follow-up listing reports no pending migrations.
- Worker version `57b33831-99b9-4546-972d-7399b291a1fe` was deployed after the
  passcode-reconfirmation follow-up in commit `5be6b9b`. An
  unauthenticated production request to the new preference endpoint returned
  `401` with no data.
- Frontend production remains unchanged until this branch is merged and its API
  proxies deploy. Because the Worker requires the internal proxy secret, the new
  route cannot be used directly by a public browser in the meantime.

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
