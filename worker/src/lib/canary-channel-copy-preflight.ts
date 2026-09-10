import type { Env } from "../types.ts";
import {
  type CanaryShardId,
  resolveCanaryProjectionSource,
} from "./channel-projection-dispatcher.ts";

const CHANNEL_ID_PATTERN = /^[a-z0-9-]{3,30}$/;

export const CANARY_CHANNEL_COPY_TABLES = [
  "channels",
  "moderators",
  "messages",
  "blocked",
  "dm",
  "gallery",
  "config",
  "banned_words",
  "upload_tickets",
  "channel_reports",
  "channel_moderation",
  "channel_petitions",
  "message_actor_identities",
  "message_links",
  "dm_replies",
  "pending_admin_deletions",
] as const;

type CopyTable = typeof CANARY_CHANNEL_COPY_TABLES[number];
type RowCounts = Record<CopyTable, number>;

interface CountRow {
  table_name: CopyTable;
  row_count: number;
}

interface SourceStateRow {
  projection_source_version: number;
  active_cleanup_jobs: number;
  active_undo_rows: number;
  pending_uploads: number;
}

interface DestinationMetadataRow {
  shard_role: string;
  bootstrap_version: number;
}

export interface CanaryChannelCopyPreflightResult {
  shardId: CanaryShardId;
  channelId: string;
  projectionSourceVersion: number;
  sourceCounts: RowCounts;
  destinationCounts: RowCounts;
  blockers: string[];
}

function channelAndLiveBindings(channelId: string): string[] {
  return [channelId, `${channelId}_live`];
}

function configBindings(channelId: string): string[] {
  return [
    `notice_${channelId}`,
    `notice_${channelId}_live`,
    `welcome_${channelId}`,
    `live_${channelId}`,
    `liveEmojis_${channelId}`,
    `petition_${channelId}`,
    `dm_${channelId}`,
  ];
}

function countStatement(database: D1Database, channelId: string) {
  const channelIds = channelAndLiveBindings(channelId);
  const configs = configBindings(channelId);
  const statements: Array<{ table: CopyTable; sql: string; values: string[] }> = [
    { table: "channels", sql: "id IN (?, ?)", values: channelIds },
    { table: "moderators", sql: "channel_id IN (?, ?)", values: channelIds },
    { table: "messages", sql: "channel_id IN (?, ?)", values: channelIds },
    { table: "blocked", sql: "channel_id IN (?, ?)", values: channelIds },
    { table: "dm", sql: "channel_id IN (?, ?)", values: channelIds },
    { table: "gallery", sql: "channel_id IN (?, ?)", values: channelIds },
    {
      table: "config",
      sql: `id IN (${configs.map(() => "?").join(", ")})`,
      values: configs,
    },
    { table: "banned_words", sql: "channel_id IN (?, ?)", values: channelIds },
    { table: "upload_tickets", sql: "channel_id IN (?, ?)", values: channelIds },
    { table: "channel_reports", sql: "channel_id IN (?, ?)", values: channelIds },
    { table: "channel_moderation", sql: "channel_id IN (?, ?)", values: channelIds },
    { table: "channel_petitions", sql: "channel_id IN (?, ?)", values: channelIds },
    { table: "message_actor_identities", sql: "channel_id IN (?, ?)", values: channelIds },
    { table: "message_links", sql: "channel_id IN (?, ?)", values: channelIds },
    { table: "dm_replies", sql: "channel_id IN (?, ?)", values: channelIds },
    { table: "pending_admin_deletions", sql: "channel_id IN (?, ?)", values: channelIds },
  ];
  const sql = statements.map(({ table, sql: where }) => (
    `SELECT '${table}' AS table_name, COUNT(*) AS row_count FROM ${table} WHERE ${where}`
  )).join(" UNION ALL ");
  return database.prepare(sql).bind(
    ...statements.flatMap(({ values }) => values),
  );
}

function normalizeCounts(rows: CountRow[]): RowCounts {
  const counts = Object.fromEntries(
    CANARY_CHANNEL_COPY_TABLES.map((table) => [table, 0]),
  ) as RowCounts;
  for (const row of rows) counts[row.table_name] = Number(row.row_count);
  return counts;
}

export async function preflightCanaryChannelCopy(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
}): Promise<CanaryChannelCopyPreflightResult> {
  if (!CHANNEL_ID_PATTERN.test(input.channelId)) {
    throw new Error("canary_copy_channel_invalid");
  }
  const destination = resolveCanaryProjectionSource(
    input.env,
    input.shardId,
  ).database;
  const sourceStateStatement = input.env.DB.prepare(`
        SELECT
          channel.projection_source_version,
          (
            SELECT COUNT(*)
            FROM cleanup_jobs
            WHERE resource_type = 'channel'
              AND resource_id = channel.id
              AND completed_at IS NULL
          ) AS active_cleanup_jobs,
          (
            SELECT COUNT(*)
            FROM pending_admin_deletions
            WHERE channel_id = channel.id
          ) AS active_undo_rows,
          (
            SELECT COUNT(*)
            FROM upload_tickets
            WHERE channel_id IN (channel.id, channel.id || '_live')
              AND status = 'pending'
          ) AS pending_uploads
        FROM channels AS channel
        WHERE channel.id = ?
          AND channel.id NOT LIKE '%_live'
      `).bind(input.channelId);
  const destinationMetadataStatement = destination.prepare(`
        SELECT shard_role, bootstrap_version
        FROM chat_shard_metadata
        WHERE id = 1
      `);
  const [sourceResults, destinationResults] = await Promise.all([
    input.env.DB.batch([
      sourceStateStatement,
      countStatement(input.env.DB, input.channelId),
    ]),
    destination.batch([
      destinationMetadataStatement,
      countStatement(destination, input.channelId),
    ]),
  ]);
  const sourceState = sourceResults[0].results?.[0] as
    | SourceStateRow
    | undefined;
  const metadata = destinationResults[0].results?.[0] as
    | DestinationMetadataRow
    | undefined;
  const sourceCountRows = (sourceResults[1].results || []) as CountRow[];
  const destinationCountRows = (
    destinationResults[1].results || []
  ) as CountRow[];

  const blockers: string[] = [];
  if (!sourceState) blockers.push("source_channel_missing");
  if (
    !metadata
    || metadata.shard_role !== "chat-canary"
    || Number(metadata.bootstrap_version) !== 2
  ) {
    blockers.push("destination_not_bootstrapped");
  }
  const destinationCounts = normalizeCounts(destinationCountRows);
  if (Object.values(destinationCounts).some((count) => count !== 0)) {
    blockers.push("destination_not_empty");
  }
  if (Number(sourceState?.active_cleanup_jobs || 0) !== 0) {
    blockers.push("source_cleanup_active");
  }
  if (Number(sourceState?.active_undo_rows || 0) !== 0) {
    blockers.push("source_undo_active");
  }
  if (Number(sourceState?.pending_uploads || 0) !== 0) {
    blockers.push("source_upload_pending");
  }

  return {
    shardId: input.shardId,
    channelId: input.channelId,
    projectionSourceVersion: Number(sourceState?.projection_source_version || 0),
    sourceCounts: normalizeCounts(sourceCountRows),
    destinationCounts,
    blockers,
  };
}
