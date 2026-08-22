import type { Env } from "../types.ts";
import { createRoomTokenBinding } from "../routes/passcode.ts";
import { processNotificationOutbox } from "./notification-delivery.ts";

// Normal messages:
// - first message in each 10-second window is delivered immediately
// - additional messages in that window are aggregated
// - the aggregate notification replaces the first notification via the same tag
const MESSAGE_BUNDLE_WINDOW_MS = 10_000;

export type ChannelNotificationEvent =
  | "channel_message"
  | "live_start"
  | "dm"
  | "message_report"
  | "channel_report";

interface RecipientRow {
  user_id: string;
  subscription_id: string;
  locale: string | null;
}

interface ChannelRow {
  id: string;
  name: string | null;
  owner_uid: string;
  passcode: string | null;
}

interface QueueChannelNotificationInput {
  env: Env;
  ctx?: ExecutionContext;
  channelId: string;
  event: ChannelNotificationEvent;
  eventId: string;
  actorUserId?: string | null;
  liveTitle?: string | null;

  /** Owner messages and live starts are important for members. */
  memberImportance?: "important" | "all";

  /** DM and report events are sent only to the channel owner. */
  ownerOnly?: boolean;

  /** Normal member messages may also notify an owner who selected All. */
  includeOwner?: boolean;

  /** Normal channel messages may be bundled. */
  bundle?: boolean;
}

function payloadFor(input: {
  locale: string;
  channelId: string;
  channelName: string;
  event: ChannelNotificationEvent;
  liveTitle?: string | null;
  tag: string;
}) {
  const ko = input.locale !== "en";
  const channel = `[${input.channelName}]`;

  let notificationText: string;

  switch (input.event) {
    case "live_start":
      notificationText = ko
        ? `${channel} ${input.liveTitle || "라이브"} 라이브 세션이 시작됐어요`
        : `${channel} ${input.liveTitle || "Live"} live session has started`;
      break;

    case "dm":
      notificationText = ko
        ? `${channel} 새 DM이 도착했어요`
        : `${channel} You received a new DM`;
      break;

    case "message_report":
      notificationText = ko
        ? `${channel} 새 메시지 신고가 접수됐어요`
        : `${channel} A message was reported`;
      break;

    case "channel_report":
      notificationText = ko
        ? `${channel} 채널 신고가 접수됐어요`
        : `${channel} Your channel was reported`;
      break;

    default:
      notificationText = ko
        ? `${channel} 새 메시지가 도착했어요`
        : `${channel} New messages have arrived`;
  }

  return {
    title: notificationText,
    body: "",
    locale: ko ? "ko" : "en",
    channelName: input.channelName,
    url: `/ch/${encodeURIComponent(input.channelId)}`,
    tag: input.tag,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Schedule a short delayed outbox drain.
 *
 * Cron remains a fallback, but normal-message aggregate rows do not need
 * to wait for the one-minute cron in the normal case.
 */
function scheduleDelayedDrain(
  ctx: ExecutionContext,
  env: Env,
  delayMs: number,
): void {
  ctx.waitUntil(
    (async () => {
      if (delayMs > 0) {
        await sleep(delayMs);
      }

      await processNotificationOutbox(env);
    })(),
  );
}

export async function queueChannelNotification(
  input: QueueChannelNotificationInput,
): Promise<number> {
  const channel = await input.env.DB.prepare(`
    SELECT id, name, owner_uid, passcode
    FROM channels
    WHERE id = ? AND id NOT LIKE '%_live'
    LIMIT 1
  `)
    .bind(input.channelId)
    .first<ChannelRow>();

  if (!channel) return 0;

  const currentBinding = channel.passcode
    ? await createRoomTokenBinding(
        channel.id,
        channel.passcode,
        input.env,
      )
    : null;

  const modeClause =
    input.memberImportance === "all"
      ? "pref.mode = 'all'"
      : "pref.mode IN ('important', 'all')";

  const ownerClause = input.ownerOnly
    ? "pref.user_id = ?"
    : input.includeOwner
      ? "1 = 1"
      : "pref.user_id != ?";

  const ownerBind = channel.owner_uid;

  const bindingClause = currentBinding
    ? "(pref.user_id = ? OR pref.access_binding = ?)"
    : "pref.access_binding IS NULL";

  const params: unknown[] = [channel.id];

  if (!input.includeOwner || input.ownerOnly) {
    params.push(ownerBind);
  }

  if (currentBinding) {
    params.push(channel.owner_uid, currentBinding);
  }

  if (input.actorUserId) {
    params.push(input.actorUserId);
  }

  const { results } = await input.env.DB.prepare(`
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
      AND ${ownerClause}
      AND ${bindingClause}
      AND ${modeClause}
      ${input.actorUserId ? "AND pref.user_id != ?" : ""}
  `)
    .bind(...params)
    .all<RecipientRow>();

  if (!results.length) return 0;

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const bundle = input.bundle === true;

  /*
   * Important notifications
   *
   * DM, live start, message report, channel report, etc.
   * retain the existing immediate-delivery behavior.
   */
  if (!bundle) {
    const statements = results.map((recipient) => {
      const id = crypto.randomUUID();

      const eventKey =
        `${input.event}:` +
        `${input.channelId}:` +
        `${recipient.subscription_id}:` +
        `${input.eventId}`;

      const payload = payloadFor({
        locale: recipient.locale || "ko",
        channelId: input.channelId,
        channelName: channel.name || input.channelId,
        event: input.event,
        liveTitle: input.liveTitle,
        tag: `${input.event}-${input.channelId}`,
      });

      return input.env.DB.prepare(`
        INSERT INTO notification_outbox (
          id,
          event_type,
          event_key,
          user_id,
          channel_id,
          subscription_id,
          payload_json,
          aggregate_count,
          status,
          attempt_count,
          next_attempt_at,
          created_at,
          updated_at
        )
        VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          1,
          'pending',
          0,
          ?, ?, ?
        )
      `).bind(
        id,
        input.event,
        eventKey,
        recipient.user_id,
        input.channelId,
        recipient.subscription_id,
        JSON.stringify(payload),
        now,
        now,
        now,
      );
    });

    await input.env.DB.batch(statements);

    if (input.ctx) {
      input.ctx.waitUntil(
        processNotificationOutbox(input.env),
      );
    }

    return statements.length;
  }

  /*
   * Normal channel messages
   *
   * Each 10-second interval acts as a small notification burst window.
   *
   * Example:
   *
   * 00.0s A -> immediate push
   * 02.0s B -> aggregate count = 2
   * 05.0s C -> aggregate count = 3
   * 09.0s D -> aggregate count = 4
   * 10.0s   -> push updates existing notification to "4 new messages"
   *
   * The Service Worker uses the same channel_message-{channelId} tag,
   * so the aggregate push replaces the existing notification instead
   * of creating another persistent notification card.
   */

  const bucket = Math.floor(
    nowMs / MESSAGE_BUNDLE_WINDOW_MS,
  );

  const bucketEndMs =
    (bucket + 1) * MESSAGE_BUNDLE_WINDOW_MS;

  let queued = 0;

  let shouldDrainImmediately = false;
  let shouldDrainAtBucketEnd = false;

  for (const recipient of results) {
    const payload = payloadFor({
      locale: recipient.locale || "ko",
      channelId: input.channelId,
      channelName: channel.name || input.channelId,
      event: input.event,
      liveTitle: input.liveTitle,

      // Keep this stable across the channel.
      // push-sw.js will use it to replace the prior notification.
      tag: `${input.event}-${input.channelId}`,
    });

    /*
     * FIRST MESSAGE
     *
     * Only one initial row is allowed for each
     * channel + browser subscription + 10-second bucket.
     */
    const initialId = crypto.randomUUID();

    const initialEventKey =
      `${input.event}:` +
      `${input.channelId}:` +
      `${recipient.subscription_id}:` +
      `${bucket}:initial`;

    const initialInsert = await input.env.DB.prepare(`
      INSERT INTO notification_outbox (
        id,
        event_type,
        event_key,
        user_id,
        channel_id,
        subscription_id,
        payload_json,
        aggregate_count,
        status,
        attempt_count,
        next_attempt_at,
        created_at,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        1,
        'pending',
        0,
        ?, ?, ?
      )
      ON CONFLICT(event_key) DO NOTHING
    `)
      .bind(
        initialId,
        input.event,
        initialEventKey,
        recipient.user_id,
        input.channelId,
        recipient.subscription_id,
        JSON.stringify(payload),

        // Immediately eligible.
        now,

        now,
        now,
      )
      .run();

    if (initialInsert.meta.changes > 0) {
      /*
       * This is the first message in the current burst.
       *
       * Deliver immediately.
       */
      queued += 1;
      shouldDrainImmediately = true;
      continue;
    }

    /*
     * SECOND+ MESSAGE
     *
     * The first message was already sent.
     *
     * Create/update a separate aggregate row.
     * aggregate_count begins at 2 because it represents:
     *
     *   first already-delivered message
     *   +
     *   this second message
     */
    const aggregateId = crypto.randomUUID();

    const aggregateEventKey =
      `${input.event}:` +
      `${input.channelId}:` +
      `${recipient.subscription_id}:` +
      `${bucket}:aggregate`;

    const aggregateNextAttempt =
      new Date(bucketEndMs).toISOString();

    await input.env.DB.prepare(`
      INSERT INTO notification_outbox (
        id,
        event_type,
        event_key,
        user_id,
        channel_id,
        subscription_id,
        payload_json,
        aggregate_count,
        status,
        attempt_count,
        next_attempt_at,
        created_at,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        2,
        'pending',
        0,
        ?, ?, ?
      )

      ON CONFLICT(event_key) DO UPDATE SET
        aggregate_count =
          notification_outbox.aggregate_count + 1,

        payload_json =
          excluded.payload_json,

        updated_at =
          excluded.updated_at

      WHERE notification_outbox.status
        IN ('pending', 'retry')
    `)
      .bind(
        aggregateId,
        input.event,
        aggregateEventKey,
        recipient.user_id,
        input.channelId,
        recipient.subscription_id,
        JSON.stringify(payload),
        aggregateNextAttempt,
        now,
        now,
      )
      .run();

    queued += 1;
    shouldDrainAtBucketEnd = true;
  }

  /*
   * Deliver the first message immediately.
   */
  if (shouldDrainImmediately && input.ctx) {
    input.ctx.waitUntil(
      processNotificationOutbox(input.env),
    );
  }

  /*
   * If more messages arrived during the burst,
   * deliver the aggregate update at the end of
   * the current 10-second window.
   *
   * Add a tiny safety margin so D1's ISO timestamp
   * is definitely <= the delivery worker's Date.now().
   */
  if (shouldDrainAtBucketEnd && input.ctx) {
    const delayMs = Math.max(
      0,
      bucketEndMs - Date.now() + 100,
    );

    scheduleDelayedDrain(
      input.ctx,
      input.env,
      delayMs,
    );
  }

  return queued;
}