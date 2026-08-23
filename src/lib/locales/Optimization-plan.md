아래 그대로 `FUTURE_PLANS.md` 같은 문서 상단에 붙이면 돼.

```md
# Notification Query / Delivery Optimization Notes

> Status: Future optimization candidate  
> Priority: Medium  
> Reason: Current implementation is functionally correct, but notification fanout and delivery add a noticeable amount of D1 reads/writes as notification volume grows. Since Cloudflare is already on a paid plan, this is not an immediate cost concern. The main reason to revisit this later is architectural efficiency, database write reduction, and long-term outbox growth.

## Current notification query flow

The notification system currently uses three main tables:

- `notification_preferences`
- `push_subscriptions`
- `notification_outbox`

The runtime flow is split into:

1. notification preference / subscription management
2. event fanout into `notification_outbox`
3. immediate push delivery
4. scheduled retry / recovery delivery

The most important scaling factor is not the number of messages alone, but the number of active push subscriptions that qualify for each event.

---

## 1. Message / event fanout query cost

When a notification-producing event occurs, `queueChannelNotification()` currently performs the following work.

### Channel lookup

Each event first reads the channel:

```sql
SELECT id, name, owner_uid, passcode
FROM channels
WHERE id = ?
  AND id NOT LIKE '%_live'
LIMIT 1
```

Purpose:

- validate the channel
- read channel name for notification text
- determine owner
- determine whether the channel is passcode-protected

Approximate cost:

```text
1 read per notification-producing event
```

### Recipient lookup

The Worker then queries eligible notification recipients by joining:

- `notification_preferences`
- `push_subscriptions`
- `users`

Example structure:

```sql
SELECT
  pref.user_id,
  subscription.id AS subscription_id,
  users.locale
FROM notification_preferences pref
INNER JOIN push_subscriptions subscription
  ON subscription.user_id = pref.user_id
  AND subscription.revoked_at IS NULL
INNER JOIN users
  ON users.id = pref.user_id
WHERE pref.channel_id = ?
  AND ...
```

This query filters recipients according to:

- Important vs All notification mode
- owner-only events
- owner inclusion/exclusion
- actor exclusion
- passcode access binding
- active push subscriptions
- active user account
- locale

Approximate cost:

```text
1 recipient-selection read per notification-producing event
```

### Outbox insertion

Every eligible push subscription receives its own row in:

```text
notification_outbox
```

For example, if one message has 20 eligible active subscriptions:

```text
20 outbox rows are inserted
```

Each row contains its own:

- event ID
- event key
- user ID
- subscription ID
- notification payload
- retry status
- timestamps

Normal channel messages deliberately use a unique event key and notification tag so that each message can remain as a separate OS notification rather than replacing a previous notification.

Approximate enqueue cost:

```text
2 fixed reads + N outbox inserts
```

where:

```text
N = number of eligible active push subscriptions
```

Example:

```text
1 subscription   -> ~3 DB operations
5 subscriptions  -> ~7 DB operations
20 subscriptions -> ~22 DB operations
100 subscriptions -> ~102 DB operations
```

This is expected fanout behavior, but it scales linearly with notification subscribers.

---

## 2. Immediate push delivery query cost

After outbox insertion, notification delivery is immediately scheduled through:

```ts
processNotificationOutbox(env)
```

The outbox delivery flow currently has several DB operations for each delivery.

### Step 1: Find deliverable rows

The Worker performs:

```sql
SELECT outbox.id
FROM notification_outbox outbox
WHERE (
  ...
)
ORDER BY outbox.created_at ASC
LIMIT ?
```

This finds:

- pending notifications
- retries whose retry time has arrived
- processing rows whose lease expired

Approximate cost:

```text
1 query per delivery batch
```

### Step 2: Claim each row

For every candidate notification:

```sql
UPDATE notification_outbox
SET
  status = 'processing',
  attempt_count = attempt_count + 1,
  lease_until = ?,
  updated_at = ?
WHERE id = ?
  AND (...)
```

Approximate cost:

```text
1 write per notification
```

This lease is important because it prevents duplicate delivery when multiple Worker executions overlap.

### Step 3: Read delivery credentials

After claiming a row, the Worker reads the outbox row together with its push subscription:

```sql
SELECT
  outbox.id,
  outbox.subscription_id,
  outbox.payload_json,
  outbox.attempt_count,
  outbox.event_type,
  outbox.aggregate_count,
  subscription.endpoint,
  subscription.p256dh,
  subscription.auth
FROM notification_outbox outbox
INNER JOIN push_subscriptions subscription
  ON subscription.id = outbox.subscription_id
WHERE outbox.id = ?
  AND outbox.status = 'processing'
  AND subscription.revoked_at IS NULL
LIMIT 1
```

Approximate cost:

```text
1 read per notification
```

### Step 4: Mark successful notification as delivered

After successful Web Push delivery:

```sql
UPDATE notification_outbox
SET
  status = 'delivered',
  lease_until = NULL,
  last_error_code = NULL,
  updated_at = ?
WHERE id = ?
  AND status = 'processing'
```

Approximate cost:

```text
1 write per successful notification
```

### Step 5: Update subscription health

The successful subscription is also updated:

```sql
UPDATE push_subscriptions
SET
  last_success_at = ?,
  failure_count = 0,
  last_failure_at = NULL,
  updated_at = ?
WHERE id = ?
  AND revoked_at IS NULL
```

Approximate cost:

```text
1 additional write per successful push
```

Because this happens on every successful notification, it can become one of the highest-frequency writes in the notification system.

---

## Approximate DB operations per normal message

Ignoring unrelated message persistence queries, notification delivery alone is approximately:

```text
enqueue:
  2 + N

delivery:
  1 + 4N

total:
  ~3 + 5N
```

where:

```text
N = eligible active push subscriptions
```

Examples:

```text
N = 1
~8 DB operations

N = 5
~28 DB operations

N = 10
~53 DB operations

N = 20
~103 DB operations

N = 100
~503 DB operations
```

These numbers are approximate because batching and failure handling can slightly change the exact count.

This is not currently considered a critical issue, but it is the main notification-related scaling path to monitor.

---

# 3. Scheduled outbox polling

The Worker currently runs notification outbox recovery every minute:

```text
* * * * *
```

The scheduled handler calls:

```ts
drainNotificationOutbox(env)
```

This exists primarily for:

- failed push retries
- expired delivery leases
- missed immediate delivery
- Worker interruption recovery

Even if there are no notifications waiting, the Worker still checks the outbox.

Approximate empty polling:

```text
60 checks/hour
1,440 checks/day
43,200 checks/30-day month
```

This is not an important cost concern on the current Cloudflare plan.

However, it is still technically unnecessary database activity during completely idle periods.

### Keep for now

Do not remove the scheduled outbox drain without replacing its recovery behavior.

Current retry delays are approximately:

```text
1 minute
5 minutes
30 minutes
```

The cron is therefore currently part of notification reliability rather than only a polling mechanism.

Future optimization should preserve retry and lease recovery semantics.

---

# 4. Push subscription success writes

One of the clearest optimization opportunities is this success-path update:

```sql
UPDATE push_subscriptions
SET
  last_success_at = ?,
  failure_count = 0,
  last_failure_at = NULL,
  updated_at = ?
WHERE id = ?
```

This currently runs after every successful push.

Example:

```text
one device receives 100 notifications
-> roughly 100 subscription success UPDATEs
```

Most of these writes may not provide meaningful new information.

### Possible future optimization

Only update `last_success_at` periodically.

Possible policy:

```text
Update subscription success metadata only if:

last_success_at is NULL
or
last_success_at is older than 1 hour
or
the subscription previously had failures
```

This preserves useful health information while eliminating many repetitive writes.

Another possible design:

```text
Successful push:
- update notification_outbox only

Failed push:
- update push_subscriptions health fields
```

This would reduce the success path to the minimum necessary DB writes.

### Priority

Medium-high optimization candidate.

This is likely the easiest recurring write to remove without changing notification behavior.

---

# 5. Notification outbox retention

Successful rows are currently marked:

```text
status = delivered
```

rather than deleted immediately.

Failed permanent rows may remain as:

```text
status = dead
```

Keeping recent rows is useful for:

- troubleshooting
- delivery diagnostics
- retry analysis
- deduplication visibility

However, there is no reason to retain old delivered rows forever.

If cleanup is not already implemented elsewhere, `notification_outbox` will continuously grow.

Potential long-term effects:

- larger D1 table
- larger indexes
- more storage
- slower maintenance
- unnecessary retained payload JSON
- increasing historical noise during debugging

### Future cleanup policy

Recommended retention:

```text
delivered:
  keep 7-30 days

dead:
  keep 30 days or longer if useful for debugging

pending / retry / processing:
  never delete solely because of age without careful recovery rules
```

Example cleanup:

```sql
DELETE FROM notification_outbox
WHERE status = 'delivered'
  AND updated_at < ?;
```

and separately:

```sql
DELETE FROM notification_outbox
WHERE status = 'dead'
  AND updated_at < ?;
```

This should preferably run as part of existing scheduled maintenance rather than adding another cron schedule.

### Priority

High long-term maintenance item.

This is more important for database hygiene than for immediate Cloudflare cost.

---

# 6. Notification preference reads

Opening notification settings currently causes several reads.

Before any notification API route is processed:

```sql
SELECT 1
FROM users
WHERE id = ?
LIMIT 1
```

This validates that the trusted user still exists.

Then notification preference GET resolves channel access:

```sql
SELECT
  c.id,
  c.owner_uid,
  c.passcode,
  EXISTS(
    SELECT 1
    FROM user_recent_channels recent
    WHERE recent.user_id = ?
      AND recent.channel_id = c.id
  ) AS associated
FROM channels c
WHERE c.id = ?
LIMIT 1
```

Then it reads the user's channel preference:

```sql
SELECT mode, access_binding, updated_at
FROM notification_preferences
WHERE user_id = ?
  AND channel_id = ?
LIMIT 1
```

At the same time, it reads the active device list:

```sql
SELECT
  id,
  user_agent_family,
  device_label,
  updated_at,
  last_success_at
FROM push_subscriptions
WHERE user_id = ?
  AND revoked_at IS NULL
ORDER BY updated_at DESC
LIMIT ?
```

Approximate total:

```text
~4 reads when opening notification settings
```

This is acceptable because notification settings are a low-frequency action.

### Priority

Low.

Do not optimize unless notification settings become a high-frequency API path.

---

# 7. Notification preference writes

Changing a notification preference uses:

```sql
INSERT INTO notification_preferences (...)
VALUES (...)
ON CONFLICT(user_id, channel_id)
DO UPDATE SET ...
```

Before that, the Worker:

- validates the user
- rate-limits the mutation
- resolves channel access
- validates passcode access when applicable

Turning notifications Off performs:

```sql
DELETE FROM notification_preferences
WHERE user_id = ?
  AND channel_id = ?
```

These operations are user-triggered and infrequent.

### Priority

Very low.

No optimization needed.

---

# 8. Push subscription registration

Registering a browser subscription performs an atomic insert/update with a subscription-count check.

The query intentionally includes:

```sql
SELECT COUNT(*)
FROM push_subscriptions
WHERE user_id = ?
  AND revoked_at IS NULL
  AND endpoint != ?
```

inside the registration operation.

After registration, the Worker reads the active device list again for the API response.

This work occurs only when:

- enabling notifications on a new browser
- reinstalling / recreating a push subscription
- refreshing a broken subscription

### Priority

Very low.

The current design is acceptable and safer than splitting the device-limit check into separate race-prone requests.

---

# 9. Failure / retry writes

Push failures intentionally generate additional writes.

Retryable failures update:

```text
notification_outbox
```

with:

- retry status
- retry time
- error code
- lease reset

and update:

```text
push_subscriptions
```

with:

- last failure timestamp
- incremented failure count

Permanent 404 / 410 push endpoint failures also revoke the subscription.

These writes are useful and should not be aggressively optimized.

Failed endpoints need to be removed so future fanout does not continue attempting delivery to invalid browser subscriptions.

### Priority

Keep current behavior.

---

# 10. Main optimization candidates

## A. Add / verify outbox cleanup

Priority:

```text
High
```

Goal:

```text
Prevent delivered/dead notification rows from accumulating indefinitely.
```

Recommended implementation:

- add cleanup to existing maintenance job
- delete old delivered rows
- delete sufficiently old dead rows
- retain pending/retry/processing rows safely

---

## B. Reduce `push_subscriptions` success writes

Priority:

```text
Medium-high
```

Current behavior:

```text
1 successful notification
-> 1 push_subscriptions UPDATE
```

Possible future behavior:

```text
Only update success health data periodically
```

or:

```text
Only write subscription metadata when health state changes
```

This can substantially reduce D1 writes without changing visible notification behavior.

---

## C. Review fanout architecture if channels become large

Priority:

```text
Future scale only
```

Current fanout is deliberately simple:

```text
1 subscription
=
1 outbox row
=
1 Web Push delivery
```

This is easy to reason about and provides reliable per-device retry handling.

Do not optimize prematurely.

If channels eventually have hundreds or thousands of notification subscribers, possible future investigation areas include:

- chunked fanout
- queue-based delivery
- Cloudflare Queues
- separating fanout from the message request Worker
- bulk recipient staging
- more efficient outbox claiming
- reducing repeated subscription metadata reads

The current architecture is appropriate while channel notification audiences remain moderate.

---

## D. Review empty 1-minute polling later

Priority:

```text
Low
```

Current cost:

```text
~43,200 empty outbox checks per month
```

This is acceptable under the current paid Cloudflare setup.

Potential future alternatives:

- Cloudflare Queue retries
- scheduled retry buckets
- dynamically scheduled alarms
- less frequent cron combined with immediate delivery
- retry-specific scheduling

Do not change this until there is a reliable replacement for lease recovery and retries.

---

# 11. What is not currently worth optimizing

The following are intentionally low-priority:

- notification preference reads
- preference updates
- subscription registration
- subscription revocation
- VAPID key access
- passcode access validation
- actor filtering
- locale lookup
- owner/member notification-mode filtering

These either happen infrequently or are important correctness/security checks.

Removing them would provide little practical benefit compared with the risk of weakening access control or notification correctness.

---

# 12. Recommended future order

Recommended order if notification infrastructure is revisited:

```text
1. Verify / implement notification_outbox retention cleanup

2. Reduce repetitive push_subscriptions success writes

3. Add lightweight metrics for:
   - notifications queued
   - subscriptions targeted
   - push successes
   - push failures
   - retries
   - dead subscriptions
   - outbox size

4. Monitor average fanout size per event

5. Only redesign fanout when real subscriber counts justify it

6. Reconsider 1-minute empty polling only after retry/recovery behavior
   can be preserved by another mechanism
```

---

# Current conclusion

The notification implementation is not currently considered wasteful enough to justify a major rewrite.

The current design prioritizes:

- delivery reliability
- per-device retry handling
- access correctness
- separate OS notifications for individual messages
- simple debugging
- deterministic fanout behavior

The main areas to clean up later are not Cloudflare billing concerns.

They are:

```text
1. outbox table growth
2. repetitive subscription health writes
3. eventual fanout scalability
4. idle cron polling efficiency
```

Until notification volume becomes significantly larger, the existing architecture should remain in place and optimization should focus only on low-risk maintenance improvements.
```