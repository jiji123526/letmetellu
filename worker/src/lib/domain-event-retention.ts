const DAY_MS = 24 * 60 * 60 * 1000;
const DELIVERED_RETENTION_MS = 30 * DAY_MS;
const DEAD_RETENTION_MS = 90 * DAY_MS;
const RETENTION_BATCH_SIZE = 250;
const RETENTION_MAX_BATCHES = 8;

async function deleteTerminalBatch(
  database: D1Database,
  status: "delivered" | "dead",
  cutoff: string,
): Promise<number> {
  const indexName = status === "delivered"
    ? "domain_events_delivered_updated_idx"
    : "domain_events_dead_updated_idx";
  const result = await database.prepare(`
    DELETE FROM domain_events
    WHERE rowid IN (
      SELECT rowid
      FROM domain_events INDEXED BY ${indexName}
      WHERE status = '${status}'
        AND updated_at < ?
      ORDER BY updated_at ASC
      LIMIT ?
    )
  `).bind(cutoff, RETENTION_BATCH_SIZE).run();
  return result.meta.changes || 0;
}

async function drainTerminalStatus(
  database: D1Database,
  status: "delivered" | "dead",
  cutoff: string,
): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch += 1) {
    const count = await deleteTerminalBatch(database, status, cutoff);
    deleted += count;
    if (count < RETENTION_BATCH_SIZE) break;
  }
  return deleted;
}

export async function drainDomainEventRetention(
  database: D1Database,
  nowMs = Date.now(),
): Promise<{ deliveredDeleted: number; deadDeleted: number }> {
  const deliveredDeleted = await drainTerminalStatus(
    database,
    "delivered",
    new Date(nowMs - DELIVERED_RETENTION_MS).toISOString(),
  );
  const deadDeleted = await drainTerminalStatus(
    database,
    "dead",
    new Date(nowMs - DEAD_RETENTION_MS).toISOString(),
  );
  return { deliveredDeleted, deadDeleted };
}
