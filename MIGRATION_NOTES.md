# Migration Notes

This file records both the original CSS-to-TSX porting constraints and the database/platform changes made during the rebuild.

## D1 migration runbook

D1 migrations are ordered files in `worker/migrations`. Wrangler records applied migrations, so do not rename or edit a migration after it has reached production. Add a new numbered migration instead.

### Apply locally

```bash
cd worker
npm install
npm run db:migrate
```

### Apply to production

```bash
cd worker
npm run db:migrate:prod
```

For code that reads a new table or column, deploy in this order:

1. apply the production D1 migration;
2. deploy the Worker;
3. build and deploy the Next.js frontend.

This order keeps the old application compatible while the schema is changing and avoids runtime `no such table` or `no such column` failures.

### Current migration inventory

#### `0001_initial_schema.sql`

Creates the base multi-tenant schema:

- `channels`
- `messages`
- `blocked`
- `dm`
- `gallery`
- `config`
- `moderators`
- `messages_fts` and its synchronization triggers

It also creates the first channel, message, block and gallery indexes. Live sessions reuse this schema through a temporary `${channelId}_live` channel row.

#### `0002_banned_words.sql`

Adds per-channel banned words with optional expiry and a channel lookup index.

#### `0003_users.sql`

Adds registered users and the unique email index used for OAuth/account ownership.

#### `0004_user_password.sql`

Adds the nullable `users.password_hash` column.

This migration changes only the schema; it does not transform existing password values. Existing credential rows were originally stored as unsalted SHA-256. The current Worker recognizes that legacy format and attempts to replace it with salted PBKDF2 after successful verification. The production upgrade path still needs dedicated end-to-end monitoring and password-reset support.

#### `0005_hot_path_indexes.sql`

Adds indexes used by initialization and moderation:

- message reply/deletion lookup;
- blocked UID lookup;
- blocked fingerprint lookup;
- DM channel/time ordering.

These indexes increase write count slightly but prevent large row scans on common reads.

#### `0006_passcode_hint.sql`

Adds nullable `channels.passcode_hint`. The hint is display-only and must never contain the passcode itself.

#### `0007_user_recent_channels.sql`

Adds account-synced dashboard state:

- `(user_id, channel_id)` composite primary key;
- last visit timestamp;
- pinned state;
- the user's personal bubble color for that channel.

The table intentionally does not store passcodes or room tokens. Channel deletion explicitly removes matching recent records. Logged-in clients migrate existing browser recents in small batches; guest recents remain in browser storage.

The initial implementation returned 20 records. That application-level limit has since been removed; batching remains in place for migration and guest validation so D1 bound-parameter limits are not exceeded.

#### `0008_email_verification.sql`

Adds `users.email_verified_at`, verification tokens and hashed signup request records.

- Existing users are backfilled as verified so deployment does not lock them out.
- New credential accounts are created with `email_verified_at = NULL`.
- Raw email verification tokens are never stored; only their SHA-256 hashes are persisted.
- Tokens expire after 30 minutes and are invalidated after use or resend.
- Signup throttling stores hashed email/IP identifiers rather than raw IP addresses.
- Failed logins are throttled independently by hashed email and IP identifiers; nonexistent accounts still perform a dummy PBKDF2 verification to reduce timing-based enumeration.
- The Resend sandbox sends only to `EMAIL_TEST_RECIPIENT`.

Apply this migration before deploying the Worker version that reads `email_verified_at`.

#### `0009_channel_instance_id.sql`

Adds a random `channels.instance_id` and backfills existing channels. The client compares this value with its browser record so recreating a deleted channel at the same address does not inherit the previous channel's colors or other channel-scoped local state.

#### `0010_user_font_size.sql`

Adds nullable `users.font_size`. Logged-in users synchronize their preferred chat font size through the account; guest users continue to store it only in the current browser.

#### `0011_channel_profile_visibility.sql`

Adds `channels.show_on_profile` with a private (`0`) default. Owners may publish individual channels from channel settings. Public owner-channel lookup returns only explicitly published channels and the profile selector is enabled only when at least two channels are visible.

#### `0012_default_channels_private.sql`

Sets all existing non-live channels to private on owner profiles. This is intentionally separate from the column migration so the privacy default and existing-data policy remain explicit.

#### `0013_password_reset_tokens.sql`

Adds hashed, single-use password-reset tokens with expiry, use time and a user/time index.

- Raw reset tokens are delivered by email and never stored in D1.
- Requests return a generic success response to reduce account enumeration.
- Email and IP-based throttles reuse hashed request identifiers.
- Successful reset invalidates the token and stores a salted PBKDF2 password.

Apply `0013` before deploying the Worker routes that request or consume password-reset tokens.

#### `0014_channel_background.sql`

Adds channel-owned chat background settings:

- `background_type`: `default`, `color` or `image`;
- `background_color`: an optional six-digit hex color;
- `background_image`: an optional owner-uploaded R2 media URL;
- `background_overlay`: a `0`–`60` percent dark overlay used for readability;
- `background_blur`: an optional light blur applied only to the background image.

The background is limited to the scrollable chat field, while the header and
composer retain their translucent surfaces. The owner UI accepts JPEG, PNG and
WebP images up to 5 MB. It uploads only when the owner saves, and replacing or
resetting a saved background removes the previous R2 object. With blur disabled,
the original image is rendered unchanged apart from the independently selected
dark overlay. Apply `0014` before deploying Worker or frontend code that saves
these fields.

#### `0015_deleted_accounts.sql`

Adds a `deleted_accounts` tombstone table keyed by an HMAC of the normalized
email address.

- The table was introduced for a temporary "deleted accounts cannot be reused"
  policy.
- Current application code no longer enforces that policy, so the table is now
  legacy state and may remain empty or unused in new deployments.
- Do not rename or delete the migration file after production use; existing
  environments may already have it recorded in Wrangler's migration history.

#### `0016_upload_tickets.sql`

Adds durable upload tracking for chat and DM media:

- `upload_tickets` records the uploaded R2 key, target channel, uploader
  identity, IP hash, purpose and expiry.
- Pending message and DM uploads expire automatically and are deleted from R2
  on the next upload cleanup pass if they were never attached.
- Worker routes now use the table for per-channel durable upload quotas and to
  prove that a message or DM image was created by the same anonymous or owner
  identity that is attaching it.

Apply `0016` before deploying the Worker version that enforces upload tickets
for message or DM image attachments.

### Operational checks

After a migration:

```bash
cd worker
npx wrangler d1 migrations list letsplay-db --remote
```

Then verify:

- the Worker deploy completed successfully;
- the frontend production build passes;
- both owner and anonymous channel initialization still work;
- channel deletion cleans up rows introduced by newer migrations;
- no secrets or database exports are staged in Git.

### Media serve incident — 2026-07-29

Uploaded media reads briefly failed with Worker `500` responses even though the
required schema (`0014_channel_background.sql` and `0016_upload_tickets.sql`)
was already present in production.

Root cause:

- `handleMediaServe()` used one compound `UNION` query to resolve a media key
  against `messages`, `gallery`, `dm`, `channels.profile_image`,
  `channels.background_image` and `config`.
- Production D1 rejected that query shape with
  `D1_ERROR: too many terms in compound SELECT: SQLITE_ERROR`.
- The Worker fetch handler caught that exception and returned the generic
  `{"error":"internal_error"}` `500`.

Fix:

- Replace the compound lookup with ordered per-source lookups executed via one
  `env.DB.batch()` call in `worker/src/routes/upload.ts`.
- Keep the existing room-token, owner and upload-ticket checks unchanged.
- Deploy the Worker only; this fix does not require a new D1 migration or a
  frontend deployment.

If `/api/media/*` starts returning `500` again, confirm the cause with
`npx wrangler tail` before assuming the database is missing a migration.

### Media auth, preview isolation and passcode refresh — 2026-07-29

Follow-up hardening on the same deployment line changed three user-visible
paths without adding a new migration:

- Passcode-protected media now remains on the same-origin Next.js
  `/api/media/*` route. The browser no longer receives a room-access token in
  the media URL query string; the proxy forwards room access to the Worker in
  the `X-Room-Token` header instead.
- The preview Worker route now accepts only absolute `http:`/`https:` URLs,
  blocks obvious local/private/internal hostnames, follows redirects manually
  with per-hop validation, enforces a short timeout, requires HTML-compatible
  content and caps the body size before OG parsing. The current caller rate
  limit is still isolate-local memory, so it is best-effort rather than
  durable.
- When room access is revoked or expires, the chat view now re-fetches the
  gated `init` payload before showing the passcode overlay. This ensures the
  latest `passcodeHint` appears immediately instead of only after a full page
  refresh.

Deployment notes:

- the preview-route hardening and media-read D1 fix are Worker deploys;
- the tokenless same-origin media proxy and passcode-hint refresh are frontend
  deploys;
- no new D1 migration is required for any of these changes.

### Passcode hardening and anonymous block persistence — 2026-07-29

This deployment line hardened two previously reviewed abuse paths without
adding a new D1 migration.

Passcode changes:

- New and rotated channel passcodes now store salted PBKDF2 verifiers instead
  of plain SHA-256 digests.
- Signed room tokens no longer embed `passcode_hash`, so a leaked token no
  longer exposes an offline-crackable verifier.
- Successful unlock of a legacy SHA-256-protected room upgrades that room to
  the PBKDF2 format in place.
- Existing room tokens issued before this change become invalid, so users may
  need to enter a room passcode once after deployment.

Anonymous blocking changes:

- Anonymous and device identity now live in HttpOnly cookies rather than
  browser-local storage readable by client JavaScript.
- Anonymous chat, DM, report and reaction writes now flow through same-origin
  Next.js proxy routes so the browser can send those cookies without exposing
  them to application code.
- Block persistence now uses a server-issued device token instead of a
  client-generated fingerprint or empty-string placeholder.
- Clearing localStorage alone no longer resets a blocked anonymous identity.
- Remaining limitation: clearing cookies or changing to a different
  browser/profile still creates a fresh anonymous identity.

Deployment notes:

- passcode hardening is a Worker deploy;
- anonymous block persistence requires both Worker and frontend deploys because
  anonymous write paths now proxy through Next.js;
- no new D1 migration is required for either change.

---

# CSS → TSX Style Migration Notes

When porting styles from the vanilla CSS prototype to React/Tailwind components, these differences cause visual mismatches.

## Tailwind base styles inflate element height

Tailwind preflight sets a body line height and makes buttons inherit it. The original browser-button line height was closer to `1.2`, so equivalent Tailwind buttons can appear taller.

Use `lineHeight: 1` where padding, rather than text line height, defines the control height.

## Font-size inheritance

The prototype applied `var(--bubble-font-size, 17px)` globally. The Next.js version must either preserve that value on `body` or explicitly apply it to scalable components.

## Auto-sizing menus

Avoid an arbitrary `min-width` on short context menus. Korean labels are often compact and a forced width introduces excess whitespace.

## Scalable bubble padding

Dimensions that follow the user's font-size setting should use the shared variable:

```tsx
padding: "calc(var(--bubble-font-size) * 0.588) calc(var(--bubble-font-size) * 0.824)"
```

Media bubbles, embedded widgets and loading bubbles intentionally use their own wrappers. Text or edited labels inside a media bubble should receive text padding explicitly rather than changing the image dimensions.

## Port checklist

1. Preserve the existing icon geometry and stroke widths.
2. Set explicit line height for compact controls.
3. Avoid fixed minimum widths unless the reference UI uses one.
4. Use `calc(var(--bubble-font-size) * ratio)` for scalable dimensions.
5. Use shared color variables such as `--hairline`, `--meta`, `--gray-text` and `--bubble-sent`.
6. Test both Korean and English labels.
7. Test the smallest supported mobile width.
8. Check loading, empty, error and long-content states.

---

## Platform progress log

### Foundation — 2026-07-23

- Rebuilt the prototype with Next.js 16 and Tailwind.
- Added Cloudflare Worker, D1, R2 and a channel-scoped Durable Object.
- Added persistent messages, WebSocket broadcasts and presence.
- Added Auth.js, channel ownership, dashboard and onboarding.
- Added server-side message validation and owner-action proxies.

### Chat, media and live mode — 2026-07-24

- Added R2 uploads, gallery, DMs, reactions, reports and FTS5 search.
- Added multiple-image sending and media loading states.
- Added native X/Twitter and Instagram widgets plus link previews.
- Added temporary live channels, live presence, emoji presets and automatic cleanup.
- Replaced event-wide refetches with payload-based local patches for normal realtime events.
- Added cursor pagination and on-demand gallery/link loading.

### Security and performance hardening

- Restricted CORS and protected internal Worker routes.
- Prevented client-side admin spoofing.
- Added owner-authenticated WebSockets for private DMs.
- Added passcode-bound room tokens and brute-force limiting.
- Added upload validation, hot-path indexes and banned-word caching.
- Added immediate broadcasts for rules, blocking, petitions, DMs, freezes and notices.
- Split large chat rendering work into memoized message, embed and reaction components.

### Dashboard and account synchronization — 2026-07-25

- Made the iMessage-style dashboard the main entry point.
- Added owned/joined section labels, swipe actions, pinning, batch edit/delete and channel deletion dialogs.
- Added guest and first-owner onboarding dialogs.
- Moved login into a dashboard dialog and kept `/login` as a redirect entry point.
- Added exact channel-address lookup while limiting name search to owned/joined channels.
- Added account-synced recent channels, pin state and personal channel colors through `0007_user_recent_channels.sql`.
- Kept guest recent channels and colors browser-local and documented that behavior in onboarding.
- Removed the recent-channel count limit.
- Enforced a maximum of five owned channels per account in a conditional Worker insert.
- Added channel passcode hints and immediate dashboard/channel-setting refresh behavior.
- Made channel deletion remove all users' recent references and notify connected anonymous users.

### Authentication transition

- Added Resend sandbox email signup for one configured test recipient.
- Added a confirmation page that consumes tokens only after an explicit POST.
- Added 30-minute, single-use verification tokens and signup throttling.
- Kept all pre-migration users verified to prevent a deployment lockout.
- Kept Google OAuth as the supported signup path.
- Retained login support for existing credential accounts.
- Added a salted PBKDF2 format and legacy SHA-256 verification/upgrade code.
- Added dashboard-based password-reset request UI and localized reset pages.
- Added generic responses and hashed email/IP throttling for password-reset requests.
- Do not introduce a platform-wide administrator account for UI testing; use a scoped QA account and test channels.

### Channel identity, profiles and preferences

- Added channel incarnation IDs so a deleted address can be safely reused without inheriting stale browser settings.
- Added cropped profile-image upload; temporary `blob:` previews are never persisted as channel profile URLs.
- Made owner-profile channel visibility opt-in and private by default.
- Added account-synced font size for logged-in users while retaining browser-local guest preferences.
- Fixed system dark-mode changes so dashboard and channel UI follow them without requiring a reload.

### Date grouping and historical navigation

- Chat, gallery and link panels share one date parser for D1 UTC timestamps.
- Date boundaries use the viewer's browser timezone rather than fixed KST.
- Korean dates use `YYYY. M. D`; English dates use `Mon D, YYYY`.
- Gallery loads 50 image records per page; links load 30 link-bearing messages per page. Deleted source messages are filtered at the data boundary.
- Selecting an unloaded gallery/link source uses its message ID to fetch the target, 25 surrounding messages on each side and a distant reply parent when needed.
- Historical context is isolated from the latest-message window. Scrolling upward or downward loads 50 messages using `(created_at, id)` cursors, preventing collisions when multiple messages share a timestamp.
- Realtime messages received while reading history are counted rather than appended, preserving the reader's position. The **Latest messages** control reloads the newest window.

Trade-offs of historical context mode:

- Returning to latest requires one additional server request.
- The initial context request performs multiple bounded D1 reads: target lookup, older/newer windows and an optional reply-parent lookup.
- New realtime message contents are intentionally hidden until the user returns to latest; only the pending count is shown.
- Continued two-way scrolling grows the in-memory React message list in 50-message pages. It avoids unbounded request loops but does not virtualize an extremely long reading session.
- Failed access tokens, deleted targets and network errors cannot resolve the requested message.

### Security audit — 2026-07-26

This audit started as a list of open findings. Status notes below were updated
after the 2026-07-29 hardening work so the remaining gaps are clear.

#### P0 — signed anonymous identity and block persistence

This item is no longer open.

- Anonymous write paths now derive identity from Worker-issued tokens rather
  than trusting client-supplied `uid`.
- The newer implementation stores anonymous and device identity in HttpOnly
  cookies and forwards them only through same-origin Next.js proxy routes.
- Clearing localStorage alone no longer bypasses owner blocks, and reaction
  writes now enforce the same block boundary.

Remaining limitation:

- Clearing cookies or switching to a different browser/profile still creates a
  fresh anonymous identity. Fingerprints and IP HMACs may supplement abuse
  review, but they still must not be treated as proof of ownership.

#### P1 — upload and media lifecycle

Most of this item was implemented on 2026-07-29:

- Public chat and DM uploads now require signed anonymous or owner identity,
  durable per-channel quotas and a matching upload ticket.
- Pending uploads are tracked durably and cleaned up if they expire unattached.
- Message, DM, live-cleanup and channel-deletion paths remove their attached R2
  objects.
- Passcode-room media is now served through an authenticated same-origin proxy
  rather than a permanent public URL carrying the room token.

Remaining gap:

- File validation should continue moving toward stricter decoded-type checks so
  hostile polyglot uploads do not rely only on request metadata or optimistic
  image handling.

#### P1 — server-side messaging policy

Most of this item is now implemented:

- DM submission reads the parent channel's DM toggle and rejects disabled
  submissions.
- DM and edit routes enforce length, block, banned-word and freeze policy at
  the Worker boundary.
- Message and DM image fields must resolve to a valid upload-ticket-backed
  object for the same channel and identity.

Remaining gap:

- Reports still need a dedicated model or stricter server validation:
  existing-target checks, reporter/target uniqueness, cooldowns, daily quota
  and authoritative server-side status.

#### P1 — preview fetch isolation

The preview endpoint must:

- accept only absolute `http:` and `https:` URLs;
- reject credentials, localhost, loopback, link-local, private and internal
  destinations;
- resolve DNS and repeat destination checks after every redirect;
- use a short timeout and bounded redirect count;
- stop reading after a small HTML response limit;
- require an HTML-compatible content type;
- apply durable caller/IP rate limits and cache successful results.

The first six controls above were implemented on 2026-07-29. Remaining gaps:

- caller rate limiting is still isolate-local rather than durable;
- destination blocking is hostname-based and does not perform independent DNS
  or post-resolution private-IP validation.

An allowlist for supported native providers is still safer than unrestricted
arbitrary-site previewing.

#### P2 — headers and dependencies

Add and test CSP, `X-Content-Type-Options: nosniff`, Referrer Policy,
Permissions Policy, frame restrictions and HSTS. CSP must account for the
Twitter and Instagram scripts/frames already used by the client.

The production dependency audit reported:

- three high findings and one moderate finding;
- Next.js `16.2.11`;
- nested PostCSS `8.4.31`;
- Sharp `0.34.5`;
- a transitive NextAuth report through Next.js.

At audit time npm reported Next.js `16.2.12`, PostCSS `8.5.23` and Sharp
`0.35.3` as current releases. Do not accept the audit tool's incompatible
Next.js `9.3.3` force-fix. Upgrade through normal dependency changes, verify
Next compatibility with fixed transitive versions, run a production build and
repeat `npm audit --omit=dev`.

#### Remediation order and verification

1. Report policy and durable deduplication; add direct-API tests with the UI
   bypassed.
2. Durable rate limiting, including preview callers, plus redirect and
   oversized-body fixtures.
3. Response security headers.
4. Dependency upgrades, followed by widget tests.

Every remediation should be deployed Worker-first when the frontend depends on
new enforcement or token issuance. Keep backward compatibility bounded and
remove it after clients have updated.

### Operational metrics and retention policy

This section defines the minimum observability and data-lifecycle policy to
implement before public launch. Operational metrics should answer whether the
service is healthy without recording private chat content.

#### Core operational metrics

Record counters, latency distributions and failures by route and deployed
version:

- request count and success, `4xx`, `429` and `5xx` rates;
- average and p95 response latency;
- message send success/failure and server rejection reason;
- upload count, bytes, success/failure and pending-object count;
- email delivery request, provider success/failure, verification completion
  and expired-token count;
- WebSocket open, authenticated, rejected, closed and reconnect count;
- active authorized connections and channel live-viewer count;
- D1 query error and slow-operation count;
- R2 stored bytes, delivered bytes, deleted objects and cleanup failures;
- login failure, room-token failure, blocked request, report submission and
  rate-limit count.

Start with service-wide and route-level dimensions. Channel/user dimensions
must use an HMAC-pseudonymous identifier and should be added only when they are
needed for abuse investigation. Do not create unbounded metric labels from raw
channel IDs, UIDs, URLs or error messages.

Average latency alone is insufficient. Track p95 latency so a smaller group of
very slow requests remains visible. Each log or metric event should include a
request ID, timestamp, route, status/error code, duration and deployed version
where available.

#### Log privacy rules

Logs must never contain:

- message, DM, petition or report description text;
- passwords or password hashes;
- room, email-verification, reset or admin WebSocket tokens;
- `INTERNAL_SECRET`, Resend keys, OAuth secrets or cookies;
- full request headers or bodies;
- raw email addresses, IP addresses, fingerprints or user-agent-derived
  fingerprints;
- arbitrary link-preview response bodies.

When correlation is necessary, use a purpose-specific HMAC secret and store
only the resulting pseudonymous ID. Hashing a low-entropy value such as an
email or IP without a secret is not sufficient protection against guessing.

#### Initial alert thresholds

Begin with a small set of actionable alerts:

- `5xx` rate above 3% for five minutes;
- five consecutive email-provider failures;
- any repeated D1 migration or query failure;
- upload bytes or object count materially above the recent baseline;
- sudden WebSocket authentication/reconnect growth;
- repeated owner-authorization failures;
- cleanup backlog or R2 deletion failures older than 24 hours.

Thresholds must be tuned after real traffic is observed. Avoid alerts for
normal `403` and `404` traffic unless their rate changes sharply.

#### Recommended retention matrix

| Data | Recommended initial retention | Deletion behavior |
| --- | --- | --- |
| Normal messages | While the channel exists | User/admin deletion removes content and R2 media immediately; retain only a minimal reply placeholder when required |
| Live messages and DMs | Until the live session ends | Delete messages, DMs, gallery rows, config and R2 objects at session end; retry partial failures |
| Normal-channel DMs | 90 days | Delete automatically in bounded batches; allow earlier owner deletion |
| Pending/unattached uploads | 1 hour | Delete R2 object if no message or DM attachment was committed |
| Deleted-message media | No retention | Delete the R2 object during the same logical deletion workflow |
| Open reports | Until resolved | Retain the minimum evidence required for review |
| Resolved reports | 90–180 days | Remove or anonymize after the policy window; preserve only legally required audit data |
| Email verification tokens | Expiry plus at most 7 days | Tokens are unusable immediately after use/expiry; delete hashed records in cleanup |
| Password-reset tokens | Expiry plus at most 7 days | Invalidate immediately after use; delete expired/used hashed records |
| Signup/login rate-limit records | 7 days initially | Delete records outside every enforcement and investigation window |
| Channel block records | Until unblock or channel deletion | Remove with the channel; never reuse across channels |
| Normal request logs | 30 days | Aggregate first where possible, then delete raw events |
| Error logs | 90 days | Remove private payloads before storage |
| Platform-admin audit logs | At least 1 year, subject to policy review | Append-only, access-controlled and excluded from ordinary application deletion |

These are initial product recommendations rather than legal advice. Before
launch in additional jurisdictions, align user-facing policy, legal
requirements and actual deletion behavior.

#### Minimal deleted-message placeholder

When replies require the parent row to remain, immediately remove:

- original text and image URL;
- gallery record and R2 object;
- nickname, fingerprint and other unnecessary sender metadata.

Keep only the message ID, channel/reply relationship, deletion state and the
minimum timestamp required to render the thread. Delete the placeholder after
its final visible reply is removed if no other integrity rule requires it.

#### Pending upload lifecycle

The current direct-to-R2 model needs an explicit attachment lifecycle:

```text
upload ticket issued
  → R2 object stored as pending
  → message/DM transaction attaches the object
  → object becomes active

pending for more than 1 hour
  → cleanup job deletes R2 object and pending record
```

A ticket should be short-lived and bound to the signed actor, channel, allowed
content type and maximum size. A message may attach only a valid pending object
for the same actor and channel.

#### Scheduled cleanup

Use a Cloudflare Cron Trigger, initially once per day, to process:

- expired and used email-verification tokens;
- expired and used password-reset tokens;
- old authentication/rate-limit request records;
- DMs beyond the retention window;
- expired pending uploads;
- queued R2 deletions;
- expired operational logs and resolved-report records.

Never issue an unbounded delete. Select a bounded batch of IDs (for example
100–500), delete it, record the result and continue on the next run or within a
strict execution budget. Before enabling deletion in production, run a
read-only dry run that reports candidate counts and oldest/newest timestamps.

#### Reliable cross-store deletion

D1 and R2 cannot be modified in one atomic transaction. Use a retryable cleanup
queue rather than assuming both operations always succeed:

```text
cleanup_jobs
- id
- type
- target_key
- status
- attempts
- next_attempt_at
- created_at
- completed_at
```

For media deletion:

1. mark the application record deleted or inaccessible;
2. enqueue the exact R2 key;
3. attempt R2 deletion;
4. mark the cleanup job complete;
5. retry failures with bounded exponential backoff;
6. alert when attempts or age exceed the operational threshold.

The deletion operation must be idempotent: an already-missing D1 row or R2
object counts as success.

#### Account deletion policy

Before exposing account deletion, define and test:

- whether owned channels are deleted or transferred;
- whether authored messages are deleted or anonymized;
- removal of account recents, personal colors and font preferences;
- removal of email, credential, verification and reset records;
- treatment of reports and platform audit records under a documented
  retention exception;
- the maximum time until backups and derived logs no longer contain the data.

Show the user the consequence before confirmation and require recent
authentication for destructive account deletion.

#### Rollout phases

1. Add structured error codes, request IDs and deployed-version fields.
2. Record core API, upload, email, WebSocket, D1 and R2 metrics without content.
3. Add dashboards and the small initial alert set.
4. Add pending-upload state and reliable cleanup jobs.
5. Run retention dry reports and compare candidate records with product policy.
6. Enable token/rate-record cleanup first.
7. Enable pending-media and deleted-media cleanup with retries.
8. Enable DM, report and log retention only after restore and audit checks.

Trade-offs:

- metrics and logs introduce storage and processing cost;
- overly detailed labels or logs create a new privacy risk;
- short retention may impede incident or report investigation;
- long retention increases cost and breach impact;
- cleanup bugs can delete required data, so dry runs, bounded batches,
  idempotency and retry visibility are mandatory;
- aggressive alert thresholds create alert fatigue.

## Current follow-up work

- complete the 2026-07-26 security-audit remediation in the documented order;
- verify a production Resend sending domain and monitor verification/reset delivery;
- finish monitored legacy-password migration;
- consider message-list virtualization for exceptionally long historical browsing sessions;
- add typing indicators;
- implement the documented operational metrics, alerts, cleanup jobs and retention policy;
- continue mobile and accessibility testing for widgets, dialogs and dashboard gestures.
