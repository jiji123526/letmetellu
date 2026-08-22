# Notification Plan

This document defines the proposed notification system for yap. It is an
unimplemented plan. Shipped behavior must be recorded in
[MIGRATION_NOTES.md](./MIGRATION_NOTES.md) as each phase is completed.

## Product Decision

Notifications are available only to authenticated users.

- Email/password and Google-authenticated accounts are eligible.
- Anonymous visitors do not receive Web Push, email notifications or
  server-synchronized unread state.
- Guest dashboards may continue showing locally stored recent channels, but
  this local history must not be presented as a notification subscription.
- Signing in does not automatically enable browser notifications. Push
  permission is requested only after an explicit user action such as
  **Enable notifications for this channel**.
- A user must already have legitimate access to a channel before subscribing.
  A push subscription never grants channel access or bypasses a passcode.

## Goals

1. Show reliable per-channel unread state across a signed-in user's devices.
2. Notify users about high-value events without turning active chat traffic
   into notification spam.
3. Support browser Web Push when the browser and operating system permit it.
4. Keep notification delivery asynchronous so message persistence and realtime
   chat acknowledgements are never delayed by a push provider.
5. Give users channel-level and global controls, quiet hours and a clear way to
   remove a device subscription.

## Initial Notification Policy

| Event | In-app unread | Web Push default | Notes |
| --- | --- | --- | --- |
| Normal channel message | Yes | Off | User may enable per channel; batch bursts. |
| Direct message to owner | Yes | On after channel opt-in | Highest-value immediate event. |
| Channel report or moderation warning | Yes | On for relevant owner/operator | Never expose sensitive evidence in lock-screen text. |
| Support reply | Yes | On after global opt-in | Deep-link to the support thread. |
| Live session started | Optional | Off | Separate per-channel preference. |
| Messages during live | Yes while retained | Off | Never push every live message. |
| Reaction, edit or deletion | No | Off | These update existing state, not unread count. |
| User's own action | No | Off | Suppress on every device owned by the actor. |

The first release should support unread state, DMs, support replies and
channel-owner alerts. Normal-message Web Push can follow after production
frequency data is available.

## User Experience

### Dashboard

- Show one iMessage-style unread dot on a channel row when its latest eligible
  event is newer than the user's last-read cursor.
- Prefer a dot over a numeric count initially. Exact counts require additional
  aggregation and can imply precision across deleted or moderated messages.
- Clear the dot only after the channel opens successfully and its latest
  visible cursor has been acknowledged by the client.
- Synchronize the read cursor to the account so another signed-in device also
  clears the dot.

### Channel notification control

- Add **Notifications** to the channel's general settings for signed-in users.
- States:
  - Off
  - Important only
  - All new messages
- Keep live-start alerts as a separate toggle if introduced.
- If browser permission is not granted, explain what enabling notifications
  does before calling the permission API.
- If permission is denied, show browser-specific instructions instead of
  repeatedly requesting permission.

### Global control

- Add a dashboard settings section listing registered devices and global push
  status.
- Allow disabling all push while retaining in-app unread dots.
- Allow quiet hours using the user's local time zone. Store an IANA time-zone
  identifier, not a fixed UTC offset.
- Removing a device revokes only that browser subscription.

### iOS and installed web apps

- Explain that supported iPhone/iPad Web Push generally requires adding yap. to
  the Home Screen and opening the installed web app before granting permission.
- Do not show installation guidance to browsers that can subscribe normally.
- Notification UI must remain useful when Web Push is unavailable: unread dots
  and in-app realtime updates are the baseline feature.

## Data Model

Use separate tables so read state, preferences and physical device endpoints
can evolve independently.

### `channel_read_state`

One row per authenticated user and joined/owned channel.

```sql
CREATE TABLE channel_read_state (
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  last_read_created_at TEXT,
  last_read_source TEXT,
  last_read_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);
```

Use the unified timeline's composite ordering rather than a message-only ID so
normal messages and owner-visible DMs cannot produce contradictory unread
state. Validate source and cursor ownership server-side.

### `notification_preferences`

```sql
CREATE TABLE notification_preferences (
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'off',
  live_start_enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);
```

Allowed modes should be enforced by the Worker: `off`, `important`, and `all`.
Deleting a channel must remove both read-state and preference rows.

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

- Treat endpoint and key material as sensitive operational data.
- Never return another user's subscription details.
- Store only a coarse browser family if needed for device management; avoid a
  full fingerprint.
- Cap active subscriptions per user, initially at five devices.

### Optional `notification_outbox`

Do not make push delivery part of the message transaction. Add a durable
outbox before enabling production push fan-out:

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

The unique event key makes retries idempotent. Process rows in bounded batches
using a queue or scheduled Worker. A provider failure must not fail message
creation.

## API Shape

All endpoints require the existing authenticated session to be verified by the
Vercel layer and forwarded to the Worker through the trusted internal identity
path.

- `GET /api/notifications/state`
  - Returns bounded unread channel IDs, current preferences and registered
    device summary for the current user.
- `POST /api/notifications/read`
  - Accepts channel ID plus a canonical unified-timeline cursor.
  - Advances only; an older cursor must never make a channel unread again.
- `PUT /api/notifications/preferences`
  - Updates one channel's mode and optional live-start preference.
- `POST /api/notifications/subscriptions`
  - Registers or rotates the current browser's Push API subscription.
- `DELETE /api/notifications/subscriptions/:id`
  - Revokes a subscription owned by the current user.

Apply request-body limits, schema validation, CSRF/origin checks and bounded
rate limits to every mutation. Preference and read updates should be cheap
idempotent upserts.

## Web Push Delivery

1. Register a dedicated Service Worker from the production origin.
2. Generate VAPID keys once and store the private key only as a Worker secret.
3. After explicit user consent, call `Notification.requestPermission()` and
   create a `PushSubscription` using the public VAPID key.
4. Send the subscription to the authenticated registration endpoint.
5. After a qualifying event commits, enqueue an outbox record for each eligible
   user—not for each device.
6. The delivery worker expands the user to active device subscriptions,
   applies batching/quiet-hour policy and sends push payloads.
7. On permanent `404`/`410` push responses, revoke the endpoint. On transient
   errors, retry with bounded exponential backoff and a maximum attempt count.
8. Notification clicks open a validated same-origin route such as
   `/ch/{channel}?notification={eventId}`. Never accept an arbitrary URL from
   stored payload data.

Push payloads should contain minimal information:

- Generic title or channel name when safe.
- Short non-sensitive summary.
- Opaque event ID and validated channel route.
- No passcodes, report evidence, email address, anonymous identifier or private
  message body on the lock screen by default.

## Batching and Spam Control

- Suppress push when the same authenticated user has the target channel visible
  in a recently active browser connection.
- Collapse normal-message bursts per user/channel into one notification over a
  short window, initially 30–60 seconds.
- Send DMs and support replies immediately, but cap repeated alerts from the
  same source.
- Enforce per-user and per-channel delivery ceilings in the Worker, independent
  of browser subscription count.
- Do not enqueue push for reactions, edits, deletions or the actor's own event.
- Use a collapse/deduplication key so retries or reconnect duplicate writes do
  not produce duplicate notifications.

## Security and Privacy Requirements

- Authentication and authorization are rechecked when preferences, read state
  and subscriptions are changed.
- Subscription possession is not authorization to read a channel.
- Passcode changes, channel removal from an account, moderation blocks and
  channel deletion must invalidate or suppress future notification eligibility.
- Channel deletion must clean notification state using the existing recoverable
  deletion workflow rather than relying on one large transaction.
- VAPID private keys and any provider credentials stay in Worker secrets and
  must never enter Vercel public environment variables or client bundles.
- Redact endpoints and key material from logs, metrics and support dashboards.
- Define subscription and outbox retention before launch; revoked endpoints
  should be deleted after a short operational recovery window.
- Document notification processing and push providers in the privacy policy
  before enabling the feature for users.

## Realtime and Read-State Semantics

- Existing WebSocket events can update unread dots while the dashboard is open.
- Server state remains authoritative; realtime events are only a fast path.
- On dashboard focus/reconnect, fetch the bounded current notification state to
  recover missed events.
- Opening a channel does not mark future unseen messages as read. Advance the
  cursor only to the newest visible item confirmed by the client.
- When the user is reading older history, do not clear newer unread activity
  until they reach or explicitly jump to the latest state.
- Deleted messages do not move a read cursor backward.

## Rollout Plan

### Phase 1 — account-synchronized unread state

- Add read-state schema and authenticated APIs.
- Show dashboard unread dots.
- Advance state when a user reaches the latest visible timeline item.
- Recover state on reconnect and across devices.
- No browser permission or Service Worker changes.

### Phase 2 — preferences and in-app alerts

- Add channel and global preferences.
- Add in-app alerts for DMs, support replies and owner events.
- Validate suppression while the channel is already visible.
- Measure event frequency before enabling external push.

### Phase 3 — Web Push foundation

- Register the Service Worker and VAPID configuration.
- Add explicit opt-in UI and device management.
- Implement subscription rotation/revocation and permanent-failure cleanup.
- Deliver only test notifications and support/DM events to an allowlist.

### Phase 4 — durable production delivery

- Add the outbox/queue, bounded retry and deduplication.
- Enable important notifications for opted-in users.
- Add batching, quiet hours and operational dashboards.
- Gradually allow per-channel normal-message notifications.

### Phase 5 — calibration

- Review opt-in, delivery, click, mute and unsubscribe rates.
- Adjust batching and defaults from actual behavior.
- Add live-start alerts only if users request them.
- Do not add anonymous push unless a separate privacy and abuse review proves it
  worthwhile.

## Tests and Acceptance Criteria

- Anonymous requests cannot read or mutate notification state.
- A user cannot subscribe to or read another user's channels.
- Read cursors advance monotonically across message and DM sources.
- Own messages do not create unread dots or push events.
- Duplicate realtime events and outbox retries produce at most one alert.
- Opening a channel on one device clears its unread state on another after sync.
- Current-channel activity suppresses push without losing server unread state.
- Passcode changes, blocks and channel deletion stop future delivery.
- Expired endpoints are revoked after permanent provider responses.
- Push/provider outages do not increase message-send latency or fail sends.
- Quiet hours respect the stored IANA time zone through daylight-saving changes.
- Service Worker notification clicks navigate only to validated same-origin
  routes.

## Operational Metrics

Collect bounded aggregate metrics without endpoint or message content:

- unread-state read/update count and latency;
- preference mutation failures;
- active and revoked subscription counts;
- outbox queued, delivered, retried, expired and dead-lettered counts;
- provider response category and delivery latency;
- notification click and disable rates;
- batching suppression and active-channel suppression counts;
- per-event-type delivery volume.

Alert on sustained outbox age, repeated provider authentication failures,
unexpected subscription growth, high permanent-failure rate and any measurable
increase in message acknowledgement latency.

## Decisions Required Before Phase 3

- Use direct standards-based Web Push with VAPID or a managed delivery provider.
- Define the exact important-event set and lock-screen copy in Korean and
  English.
- Choose quiet-hour defaults and whether they are global or channel-specific.
- Decide whether channel names may appear in lock-screen notifications by
  default.
- Set retention windows for revoked subscriptions, delivered outbox rows and
  aggregate delivery metrics.

