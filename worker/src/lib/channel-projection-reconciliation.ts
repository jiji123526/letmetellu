const MAX_RECONCILIATION_ROWS = 100;

interface SourceProjectionRow {
  channel_id: string;
  source_version: number;
  state: "active" | "deleted";
  owner_uid: string | null;
  show_on_profile: number | null;
  created_at: string | null;
}

interface ControlProjectionRow {
  channel_id: string;
  source_version: number;
  state: "active" | "deleted";
  projected_source_version: number | null;
  owner_uid: string | null;
  show_on_profile: number | null;
  created_at: string | null;
}

export interface ChannelProjectionReconciliationIssue {
  channelId: string;
  reason:
    | "missing_control_watermark"
    | "watermark_mismatch"
    | "missing_active_projection"
    | "active_projection_mismatch"
    | "deleted_projection_present";
  sourceVersion: number;
  controlVersion: number | null;
}

export interface ChannelProjectionReconciliationResult {
  checked: number;
  issues: ChannelProjectionReconciliationIssue[];
  nextCursor: string | null;
}

export async function reconcileChannelProjections(input: {
  sourceDatabase: D1Database;
  controlDatabase: D1Database;
  cursor?: string;
  limit?: number;
}): Promise<ChannelProjectionReconciliationResult> {
  const limit = Math.max(
    1,
    Math.min(input.limit ?? MAX_RECONCILIATION_ROWS, MAX_RECONCILIATION_ROWS),
  );
  const { results: sourceRows } = await input.sourceDatabase.prepare(`
    SELECT
      version.channel_id,
      version.source_version,
      version.state,
      channel.owner_uid,
      channel.show_on_profile,
      channel.created_at
    FROM channel_projection_versions AS version
    LEFT JOIN channels AS channel
      ON channel.id = version.channel_id
    WHERE version.channel_id > ?
    ORDER BY version.channel_id ASC
    LIMIT ?
  `).bind(input.cursor || "", limit).all<SourceProjectionRow>();

  if (sourceRows.length === 0) {
    return { checked: 0, issues: [], nextCursor: null };
  }

  const placeholders = sourceRows.map(() => "?").join(", ");
  const { results: controlRows } = await input.controlDatabase.prepare(`
    SELECT
      version.channel_id,
      version.source_version,
      version.state,
      projection.source_version AS projected_source_version,
      projection.owner_uid,
      projection.show_on_profile,
      projection.created_at
    FROM channel_projection_versions AS version
    LEFT JOIN channel_control_projections AS projection
      ON projection.channel_id = version.channel_id
    WHERE version.channel_id IN (${placeholders})
  `).bind(...sourceRows.map((row) => row.channel_id)).all<ControlProjectionRow>();
  const controlByChannel = new Map(
    controlRows.map((row) => [row.channel_id, row]),
  );
  const issues: ChannelProjectionReconciliationIssue[] = [];

  for (const source of sourceRows) {
    const control = controlByChannel.get(source.channel_id);
    if (!control) {
      issues.push({
        channelId: source.channel_id,
        reason: "missing_control_watermark",
        sourceVersion: source.source_version,
        controlVersion: null,
      });
      continue;
    }
    if (
      control.source_version !== source.source_version
      || control.state !== source.state
    ) {
      issues.push({
        channelId: source.channel_id,
        reason: "watermark_mismatch",
        sourceVersion: source.source_version,
        controlVersion: control.source_version,
      });
      continue;
    }
    if (source.state === "deleted") {
      if (control.projected_source_version !== null) {
        issues.push({
          channelId: source.channel_id,
          reason: "deleted_projection_present",
          sourceVersion: source.source_version,
          controlVersion: control.source_version,
        });
      }
      continue;
    }
    if (control.projected_source_version === null) {
      issues.push({
        channelId: source.channel_id,
        reason: "missing_active_projection",
        sourceVersion: source.source_version,
        controlVersion: control.source_version,
      });
      continue;
    }
    if (
      control.projected_source_version !== source.source_version
      || control.owner_uid !== source.owner_uid
      || control.show_on_profile !== source.show_on_profile
      || control.created_at !== source.created_at
    ) {
      issues.push({
        channelId: source.channel_id,
        reason: "active_projection_mismatch",
        sourceVersion: source.source_version,
        controlVersion: control.source_version,
      });
    }
  }

  return {
    checked: sourceRows.length,
    issues,
    nextCursor: sourceRows.length === limit
      ? sourceRows[sourceRows.length - 1].channel_id
      : null,
  };
}
