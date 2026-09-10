const PROJECTION_BATCH_SIZE = 10;
const PROJECTION_LEASE_MS = 2 * 60 * 1000;
const MAX_PROJECTION_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
const CHANNEL_ID_PATTERN = /^[a-z0-9-]{3,30}$/;

interface ProjectionEventRow {
  id: string;
  channel_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  source_version: number;
  payload_json: string;
  attempt_count: number;
}

interface ProjectionEventCandidate {
  id: string;
  created_at: string;
}

export type ChannelProjectionEvent =
  | {
      id: string;
      channelId: string;
      sourceVersion: number;
      type: "upsert";
      ownerUid: string;
      showOnProfile: 0 | 1;
      createdAt: string | null;
    }
  | {
      id: string;
      channelId: string;
      sourceVersion: number;
      type: "delete";
    };

export interface ChannelProjectionDrainResult {
  claimed: number;
  delivered: number;
  retried: number;
  dead: number;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isValidCreatedAt(value: unknown): value is string | null {
  return value === null
    || (
      typeof value === "string"
      && value.length <= 40
      && Number.isFinite(Date.parse(value))
    );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === expected[index]);
}

export function parseChannelProjectionEvent(
  row: ProjectionEventRow,
): ChannelProjectionEvent | null {
  if (
    !isBoundedString(row.id, 64)
    || !CHANNEL_ID_PATTERN.test(row.channel_id)
    || row.aggregate_type !== "channel"
    || row.aggregate_id !== row.channel_id
    || !Number.isSafeInteger(row.source_version)
    || row.source_version <= 0
    || row.payload_json.length > 16_384
  ) {
    return null;
  }

  let payload: Record<string, unknown>;
  try {
    const decoded = JSON.parse(row.payload_json);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
    payload = decoded as Record<string, unknown>;
  } catch {
    return null;
  }

  if (row.event_type === "channel_projection_delete") {
    if (
      payload.state !== "deleted"
      || !hasOnlyKeys(payload, ["state"])
    ) {
      return null;
    }
    return {
      id: row.id,
      channelId: row.channel_id,
      sourceVersion: row.source_version,
      type: "delete",
    };
  }

  if (
    row.event_type !== "channel_projection_upsert"
    || payload.state !== "active"
    || !hasOnlyKeys(payload, [
      "owner_uid",
      "show_on_profile",
      "created_at",
      "state",
    ])
    || !isBoundedString(payload.owner_uid, 128)
    || (payload.show_on_profile !== 0 && payload.show_on_profile !== 1)
    || !isValidCreatedAt(payload.created_at)
  ) {
    return null;
  }

  return {
    id: row.id,
    channelId: row.channel_id,
    sourceVersion: row.source_version,
    type: "upsert",
    ownerUid: payload.owner_uid,
    showOnProfile: payload.show_on_profile,
    createdAt: payload.created_at,
  };
}

export async function applyChannelProjectionEvent(
  controlDatabase: D1Database,
  event: ChannelProjectionEvent,
  now: string,
): Promise<void> {
  const watermark = controlDatabase.prepare(`
    INSERT INTO channel_projection_versions (
      channel_id, source_version, state, updated_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      source_version = excluded.source_version,
      state = excluded.state,
      updated_at = excluded.updated_at
    WHERE excluded.source_version > channel_projection_versions.source_version
  `).bind(
    event.channelId,
    event.sourceVersion,
    event.type === "upsert" ? "active" : "deleted",
    now,
  );

  if (event.type === "delete") {
    await controlDatabase.batch([
      watermark,
      controlDatabase.prepare(`
        DELETE FROM channel_control_projections
        WHERE channel_id = ?
          AND source_version <= ?
          AND EXISTS (
            SELECT 1
            FROM channel_projection_versions
            WHERE channel_id = ?
              AND source_version = ?
              AND state = 'deleted'
          )
      `).bind(
        event.channelId,
        event.sourceVersion,
        event.channelId,
        event.sourceVersion,
      ),
    ]);
    return;
  }

  await controlDatabase.batch([
    watermark,
    controlDatabase.prepare(`
      INSERT INTO channel_control_projections (
        channel_id,
        owner_uid,
        show_on_profile,
        created_at,
        projection_version,
        projected_at,
        source_version
      )
      SELECT ?, ?, ?, ?, 1, ?, ?
      WHERE EXISTS (
        SELECT 1
        FROM channel_projection_versions
        WHERE channel_id = ?
          AND source_version = ?
          AND state = 'active'
      )
      ON CONFLICT(channel_id) DO UPDATE SET
        owner_uid = excluded.owner_uid,
        show_on_profile = excluded.show_on_profile,
        created_at = excluded.created_at,
        projection_version = channel_control_projections.projection_version + 1,
        projected_at = excluded.projected_at,
        source_version = excluded.source_version
      WHERE excluded.source_version > channel_control_projections.source_version
    `).bind(
      event.channelId,
      event.ownerUid,
      event.showOnProfile,
      event.createdAt,
      now,
      event.sourceVersion,
      event.channelId,
      event.sourceVersion,
    ),
  ]);
}

async function claimProjectionEvents(
  sourceDatabase: D1Database,
  nowMs: number,
  limit: number,
): Promise<ProjectionEventRow[]> {
  const now = new Date(nowMs).toISOString();
  const leaseUntil = new Date(nowMs + PROJECTION_LEASE_MS).toISOString();
  const [readyResult, expiredLeaseResult] = await sourceDatabase.batch<ProjectionEventCandidate>([
    sourceDatabase.prepare(`
      SELECT id, created_at
      FROM domain_events
      WHERE status = 'pending'
        AND next_attempt_at <= ?
      ORDER BY next_attempt_at ASC, created_at ASC, id ASC
      LIMIT ?
    `).bind(now, limit),
    sourceDatabase.prepare(`
      SELECT id, created_at
      FROM domain_events
      WHERE status = 'processing'
        AND lease_until < ?
      ORDER BY lease_until ASC, created_at ASC, id ASC
      LIMIT ?
    `).bind(now, limit),
  ]);
  const candidates = [...(readyResult.results || []), ...(expiredLeaseResult.results || [])]
    .sort((left, right) => (
      left.created_at.localeCompare(right.created_at)
      || left.id.localeCompare(right.id)
    ))
    .slice(0, limit);

  const claimed: ProjectionEventRow[] = [];
  for (const candidate of candidates) {
    const claim = await sourceDatabase.prepare(`
      UPDATE domain_events
      SET status = 'processing',
          attempt_count = attempt_count + 1,
          lease_until = ?,
          updated_at = ?
      WHERE id = ? AND (
        (status = 'pending' AND next_attempt_at <= ?)
        OR (status = 'processing' AND lease_until < ?)
      )
    `).bind(leaseUntil, now, candidate.id, now, now).run();
    if (!claim.meta.changes) continue;

    const row = await sourceDatabase.prepare(`
      SELECT
        id,
        channel_id,
        aggregate_type,
        aggregate_id,
        event_type,
        source_version,
        payload_json,
        attempt_count
      FROM domain_events
      WHERE id = ? AND status = 'processing'
      LIMIT 1
    `).bind(candidate.id).first<ProjectionEventRow>();
    if (row) claimed.push(row);
  }
  return claimed;
}

async function markDelivered(
  sourceDatabase: D1Database,
  id: string,
  now: string,
): Promise<void> {
  await sourceDatabase.prepare(`
    UPDATE domain_events
    SET status = 'delivered',
        lease_until = NULL,
        last_error_code = NULL,
        updated_at = ?
    WHERE id = ? AND status = 'processing'
  `).bind(now, id).run();
}

async function markDead(
  sourceDatabase: D1Database,
  id: string,
  errorCode: string,
  now: string,
): Promise<void> {
  await sourceDatabase.prepare(`
    UPDATE domain_events
    SET status = 'dead',
        lease_until = NULL,
        last_error_code = ?,
        updated_at = ?
    WHERE id = ? AND status = 'processing'
  `).bind(errorCode, now, id).run();
}

async function markRetry(
  sourceDatabase: D1Database,
  row: ProjectionEventRow,
  nowMs: number,
): Promise<"retried" | "dead"> {
  const now = new Date(nowMs).toISOString();
  if (row.attempt_count >= MAX_PROJECTION_ATTEMPTS) {
    await markDead(sourceDatabase, row.id, "projection_control_write_failed", now);
    return "dead";
  }

  const retryDelay = RETRY_DELAYS_MS[
    Math.min(row.attempt_count - 1, RETRY_DELAYS_MS.length - 1)
  ];
  await sourceDatabase.prepare(`
    UPDATE domain_events
    SET status = 'pending',
        next_attempt_at = ?,
        lease_until = NULL,
        last_error_code = 'projection_control_write_failed',
        updated_at = ?
    WHERE id = ? AND status = 'processing'
  `).bind(
    new Date(nowMs + retryDelay).toISOString(),
    now,
    row.id,
  ).run();
  return "retried";
}

export async function drainChannelProjectionEvents(input: {
  sourceDatabase: D1Database;
  controlDatabase: D1Database;
  nowMs?: number;
  limit?: number;
}): Promise<ChannelProjectionDrainResult> {
  const nowMs = input.nowMs ?? Date.now();
  const limit = Math.max(1, Math.min(input.limit ?? PROJECTION_BATCH_SIZE, PROJECTION_BATCH_SIZE));
  const rows = await claimProjectionEvents(input.sourceDatabase, nowMs, limit);
  const result: ChannelProjectionDrainResult = {
    claimed: rows.length,
    delivered: 0,
    retried: 0,
    dead: 0,
  };

  for (const row of rows) {
    const event = parseChannelProjectionEvent(row);
    if (!event) {
      await markDead(
        input.sourceDatabase,
        row.id,
        "invalid_channel_projection_event",
        new Date(nowMs).toISOString(),
      );
      result.dead += 1;
      continue;
    }

    try {
      await applyChannelProjectionEvent(
        input.controlDatabase,
        event,
        new Date(nowMs).toISOString(),
      );
      await markDelivered(
        input.sourceDatabase,
        row.id,
        new Date(nowMs).toISOString(),
      );
      result.delivered += 1;
    } catch {
      const status = await markRetry(input.sourceDatabase, row, nowMs);
      result[status] += 1;
    }
  }

  return result;
}
