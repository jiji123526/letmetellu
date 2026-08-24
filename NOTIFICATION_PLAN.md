# Web Push Notification Plan

This document defines the current notification design and remaining work for
yap. Shipped behavior must be recorded in
[MIGRATION_NOTES.md](./MIGRATION_NOTES.md) as each phase is completed.

## Product Decisions

- Notifications are available only to authenticated users. Email/password and
  Google-authenticated accounts are eligible; anonymous visitors are not.
- This project implements Web Push only. It does not add dashboard unread dots,
  account-synchronized read cursors, in-app notification banners or counts.
- Signing in does not automatically enable notifications. Browser permission is
  requested only after an explicit action such as **Enable notifications for
  this channel**.
- A user must already have legitimate channel access before subscribing. A push
  subscription never grants access or bypasses a passcode.
- Channel-admin messages and live-session starts are **Important** events for
  authenticated non-admin users subscribed to that channel.
- Push delivery is asynchronous and must never delay message persistence,
  realtime broadcast or the sender's acknowledgement.

## Goals

1. Deliver useful background notifications to signed-in channel users who opt
   in, even when yap. is not open.
2. Make **Important only** useful by including channel-admin messages and live
   starts while excluding routine member traffic.
3. Avoid duplicate, noisy or privacy-sensitive lock-screen notifications.
4. Keep message and live-session mutations independent from push-provider
   latency or failure.
5. Support browser/device revocation, quiet hours and bounded retries.

## Notification Modes

Each authenticated user has one preference per channel.

| Mode | Admin message | Live starts | Member message | Owner DM/message report/channel report |
| --- | --- | --- | --- | --- |
| Off | No | No | No | Only separately enabled account-level alerts |
| Important only | Yes | Yes | No | Yes when relevant |
| All new messages | Yes | Yes | Yes | Yes when relevant |

The initial default is **Off**. Existing channel participation must not silently
grant push permission or create a subscription.

### Important event classification

- **Channel-admin message:** a normal-channel message whose sender is the
  authoritative channel owner/admin. Determine this on the server, never from a
  client-supplied `is_admin` value.
- **Live start:** the transition from no active session to a newly created live
  session. One session creates at most one important event per subscribed user.
- Live-session messages are not individually important. Users receive the live
  start notification, then follow the session in the app if they choose.
- DM, message-report and channel-report events are important only to the channel
  owner; their sensitive contents never appear on the lock screen.
- Reactions, edits, deletions and the user's own actions do not create push.

### Important-event recipient rules

- The recipient must be authenticated, associated with the channel and have a
  valid active subscription.
- The channel preference must be `important` or `all`.
- Admin-message notifications target non-admin channel users, not the sender.
- Live-start notifications target opted-in non-admin channel users, excluding
  the owner who started the session.
- Protected-channel recipients must retain the passcode binding that was current
  when they opted in. A changed passcode requires reconfirmation.
- If a user's active browser is visibly viewing that channel, suppress the push
  for that device.

## Channel User Experience

Put notification controls in the channel's general settings because users spend
most of their time inside channels rather than on the dashboard.

```text
Notifications
○ Off
○ Important only
  Admin messages and live starts
○ All new messages
```

- Show an explanatory pre-permission panel before calling
  `Notification.requestPermission()`.
- Request permission only after the user selects a push-enabled mode.
- If permission is denied, keep the preference off and provide browser-specific
  instructions. Do not repeatedly trigger the native prompt.
- If registration fails, show a retry action and keep the previous server
  preference unchanged.
- Turning a channel off does not revoke the entire device. Global device
  revocation belongs in account settings.

### iOS and installed web apps

- Supported iPhone/iPad Web Push generally requires adding yap. to the Home
  Screen, opening the installed web app and granting permission there.
- Show installation guidance only when the current platform requires it.
- If Web Push is unavailable, keep the channel usable without substituting an
  in-app or dashboard notification system.

## Data Model

### `notification_preferences`

```sql
CREATE TABLE notification_preferences (
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'off',
  quiet_hours_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);
```

- Enforce `off`, `important` and `all` in the Worker.
- Channel deletion and account/channel unlinking remove or disable the row.
- Quiet hours use the user's IANA time zone, never a fixed UTC offset.
- Do not create read-state or unread-count rows.

### `push_subscriptions`

```sql
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent_family TEXT,
  device_label TEXT,
  created_at TEXT NOT NULL,
  last_success_at TEXT,
  last_failure_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT
);
```

- Treat endpoints and keys as sensitive operational data.
- Return only the current user's coarse device summaries.
- Avoid storing a full browser fingerprint.
- Initially cap active subscriptions at five devices per account.
- Permanently revoke endpoints returning `404` or `410`.

### `notification_outbox`

Use a durable outbox before enabling production fan-out.

```sql
CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel_id TEXT,
  event_type TEXT NOT NULL,
  event_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  available_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  UNIQUE (user_id, event_key)
);
```

- One qualifying mutation creates logical events, not synchronous sends to
  every device.
- Unique event keys make retries and duplicate realtime events idempotent.
- A queue consumer or scheduled Worker processes bounded batches.
- Provider failure never rolls back a message or live-session start.

## API Shape

All endpoints require the existing authenticated session to be verified by the
Vercel layer and forwarded through the trusted Worker identity path.

- `GET /api/notifications/preferences?channel={id}` returns channel mode and a
  device capability summary.
- `PUT /api/notifications/preferences` updates one channel mode after verifying
  current channel association and access.
- `POST /api/notifications/subscriptions` registers or rotates the current
  browser subscription.
- `DELETE /api/notifications/subscriptions/:id` revokes a device owned by the
  current user.
- An optional `POST /api/notifications/test` sends a tightly rate-limited
  self-test only after registration.

Apply body-size limits, schema validation, origin/CSRF checks and durable rate
limits to every mutation. Preferences are idempotent upserts. No dashboard
notification endpoint or read-cursor endpoint is needed.

## Web Push Flow

1. Register a dedicated Service Worker from the production origin.
2. Generate VAPID keys once. Store the private key only as a Worker secret and
   expose only the public key to the client.
3. After explicit consent, request browser permission and create a
   `PushSubscription` using the public VAPID key.
4. Register the subscription through the authenticated endpoint.
5. Persist the selected channel mode only after registration succeeds.
6. When an admin message, live start or other qualifying event commits, enqueue
   outbox work without awaiting delivery.
7. The delivery worker resolves eligible users, expands them to active devices,
   applies active-channel suppression, quiet hours and rate limits, then sends
   Web Push.
8. Permanent endpoint failures revoke the device. Transient failures retry with
   bounded exponential backoff and a maximum attempt count.
9. Notification clicks open a validated same-origin route. Admin-message pushes
   may include an opaque message target; live-start pushes open the live channel
   without exposing a session token.

## Payload and Copy

Keep payloads minimal and safe for lock screens.

Suggested Korean copy:

- Admin message: `관리자가 새 메시지를 보냈어요`
- Live start: `라이브가 시작되었어요`

Suggested English copy:

- Admin message: `The channel admin sent a new message`
- Live start: `A live session has started`

The payload may include the channel name only if the privacy decision allows
it. Never include passcodes, report evidence, email addresses, anonymous
identifiers, private DM bodies or arbitrary navigation URLs.

## Delivery and Spam Control

- Every eligible message creates an immediately available event for each
  recipient device. Message notifications use event-specific tags so they
  remain individually visible rather than replacing one another.
- Deduplicate live starts by live session ID so reconnects or repeated
  processing cannot resend them.
- Suppress a device when its authenticated session reports that the target
  channel is visible and recently active. A background tab is not visible.
- Enforce per-user, per-channel and per-device ceilings independently of
  subscription count.
- Do not enqueue events for the actor's own action.

## Security and Privacy Requirements

- Recheck authentication, channel association and authorization when modifying
  preferences or subscriptions.
- Re-evaluate eligibility at delivery time because access may change between
  event creation and outbox processing.
- A subscription is a delivery endpoint, not authorization to read a channel.
- Passcode changes, blocks, moderation restrictions, account/channel unlinking
  and channel deletion suppress future delivery.
- Channel deletion cleans preferences and pending events using a bounded,
  recoverable deletion workflow.
- VAPID private keys and provider credentials stay in Worker secrets and never
  enter client bundles or public Vercel variables.
- Redact endpoints and key material from logs, metrics and support tools.
- Retain delivered outbox rows for 30 days, dead rows for 90 days and revoked
  subscriptions for at least 90 days. Delete only bounded indexed batches, and
  never retention-delete pending, retry or processing work.
- Update the privacy policy before enabling push for users.

## Active-Channel Suppression

Because users commonly remain inside one channel, avoid notifying them about a
message or live start they are already viewing.

- The Push Service Worker suppresses display when a visible same-origin window
  already has the target channel open. This avoids user-visible duplication but
  does not avoid the outbox row or provider request.
- Server-side suppression may later use short-lived Durable Object
  user/channel/device presence if production traffic justifies the complexity.
  Do not write every heartbeat to D1.
- When server presence is unavailable, prefer sending the opted-in notification
  and let the Service Worker make the local visibility decision.

## Rollout Plan

### Phase 1 — subscription foundation

- Add VAPID secrets, Service Worker registration and feature detection.
- Add subscription and preference schema plus authenticated APIs.
- Add channel settings UI with explicit permission education.
- Support test pushes only for an internal allowlist.

### Phase 2 — important admin messages

- Create outbox events after authoritative admin-message persistence.
- Add recipient resolution, current-channel suppression and permanent endpoint
  cleanup.
- Confirm send acknowledgement latency is unchanged by immediate fanout.

### Phase 3 — important live starts

- Create exactly one event when a new live session becomes active.
- Deduplicate with the live session ID.
- Notify `important` and `all` subscribers, excluding the initiating admin and
  currently active viewers.
- Confirm live restart, expiry and reconnect paths do not emit duplicates.

### Phase 4 — remaining important events

- Add DM, support and moderation notifications with generic lock-screen copy.
- Add bounded retry, dead-letter visibility and operational alerts.
- Enable quiet hours.

### Phase 5 — all-message delivery

- `All` mode delivers each eligible member message immediately and separately.
- Use production frequency data to decide whether stricter ceilings are needed.
- Do not add anonymous push without a separate privacy and abuse review.

## Tests and Acceptance Criteria

- Anonymous requests cannot read or mutate preferences or subscriptions.
- A signed-in user cannot subscribe to a channel not associated with the
  account.
- Forging `is_admin` cannot produce an important admin-message event.
- One admin message produces at most one logical event per eligible user.
- One live session ID produces at most one live-start event per eligible user.
- `important` receives admin messages and live starts but not member messages.
- `all` receives admin messages, live starts and individual member messages.
- `off` receives none of the channel events.
- The initiating admin never receives their own admin-message or live-start
  push.
- Duplicate outbox processing and transient retries produce at most one visible
  alert per event key.
- A visible active channel suppresses its device push; a hidden tab does not.
- Passcode/access changes, blocks and channel deletion stop future delivery.
- Permanent provider failures revoke endpoints.
- Provider outages do not increase message-send or live-start latency and do
  not roll back successful mutations.
- Service Worker clicks navigate only to validated same-origin routes.
- Unsupported or denied push leaves chat fully functional.

## Operational Metrics

Collect bounded aggregate metrics without endpoint or message content:

- preference updates and subscription registration failures;
- active/revoked subscription totals;
- outbox queued, delivered, retried, expired and dead-lettered totals;
- event volume split by admin message, live start, DM, support and moderation;
- provider response class and delivery latency;
- deduplication, rate-limit and active-channel suppression counts;
- notification clicks, channel mutes and device revocations;
- message acknowledgement and live-start mutation latency before and after push
  rollout.

Alert on sustained outbox age, provider authentication failures, unexpected
subscription growth, high permanent-failure rates and any measurable mutation
latency regression.

## Decisions Required Before Implementation

- Direct standards-based VAPID delivery or a managed Web Push provider.
- Whether channel names may appear on lock screens by default.
- Quiet-hour defaults.
- Exact Korean and English pre-permission and failure copy.
