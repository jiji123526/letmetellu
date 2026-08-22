import type { Env } from "../types.ts";
import { createRoomTokenBinding } from "../routes/passcode.ts";
import { processNotificationOutbox } from "./notification-delivery.ts";

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

  /**
   * Retained for caller compatibility.
   * Normal messages are no longer bundled.
   */
  bundle?: boolean;
}

function notificationTag(input: {
  event: ChannelNotificationEvent;
  channelId: string;
  eventId: string;
}): string {
  /*
   * Normal messages must have a unique tag so each Push remains
   * independently visible in the notification center.
   *
   * Important channel-level events retain their existing stable tag.
   */
  if (input.event === "channel_message") {
    return `${input.event}-${input.channelId}-${input.eventId}`;
  }

  return `${input.event}-${input.channelId}`;
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
        : `${channel} New message has arrived`;
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
    params.push(
      channel.owner_uid,
      currentBinding,
    );
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

  const now = new Date().toISOString();

  /*
   * Every notification event now receives its own outbox row.
   *
   * In particular, every channel_message uses input.eventId as part
   * of both the event key and notification tag, so normal messages:
   *
   * - become immediately eligible for delivery;
   * - trigger an asynchronous outbox drain immediately;
   * - are not aggregated;
   * - do not replace previous message notifications in the OS
   *   notification center.
   */
  const statements = results.map((recipient) => {
    const id = crypto.randomUUID();

    const eventKey =
      `${input.event}:` +
      `${input.channelId}:` +
      `${recipient.subscription_id}:` +
      `${input.eventId}`;

    const tag = notificationTag({
      event: input.event,
      channelId: input.channelId,
      eventId: input.eventId,
    });

    const payload = payloadFor({
      locale: recipient.locale || "ko",
      channelId: input.channelId,
      channelName: channel.name || input.channelId,
      event: input.event,
      liveTitle: input.liveTitle,
      tag,
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
      ON CONFLICT(event_key) DO NOTHING
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

  /*
   * Every event is immediately eligible.
   *
   * waitUntil keeps Push-provider latency outside the response-critical
   * message persistence path.
   */
  if (input.ctx) {
    input.ctx.waitUntil(
      processNotificationOutbox(input.env),
    );
  }

  return statements.length;
}