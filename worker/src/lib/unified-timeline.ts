export const UNIFIED_TIMELINE_PAGE_SIZE = 50;
export const UNIFIED_TIMELINE_MAX_PAGE_SIZE = 100;

export type UnifiedTimelineSource = "message" | "dm";

export interface UnifiedTimelineCursor {
  visual_root_created_at: string;
  source: UnifiedTimelineSource;
  visual_root_id: string;
  visual_depth: 0 | 1;
  created_at: string;
  id: string;
}

export interface UnifiedTimelineCursorRow {
  visual_root_created_at: unknown;
  source: unknown;
  visual_root_id: unknown;
  visual_depth: unknown;
  created_at: unknown;
  id: unknown;
}

const SOURCE_ORDER: Record<UnifiedTimelineSource, number> = {
  message: 0,
  dm: 1,
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareUnifiedTimelineCursor(
  left: UnifiedTimelineCursor,
  right: UnifiedTimelineCursor,
): number {
  return compareText(left.visual_root_created_at, right.visual_root_created_at)
    || SOURCE_ORDER[left.source] - SOURCE_ORDER[right.source]
    || compareText(left.visual_root_id, right.visual_root_id)
    || left.visual_depth - right.visual_depth
    || compareText(left.created_at, right.created_at)
    || compareText(left.id, right.id);
}

export function parseUnifiedTimelineCursor(
  value: UnifiedTimelineCursorRow | null | undefined,
): UnifiedTimelineCursor | null {
  if (!value) return null;
  const source = value.source === "message" || value.source === "dm"
    ? value.source
    : null;
  const visualDepth = Number(value.visual_depth);
  if (
    !source
    || (visualDepth !== 0 && visualDepth !== 1)
    || typeof value.visual_root_created_at !== "string"
    || !value.visual_root_created_at
    || typeof value.visual_root_id !== "string"
    || !value.visual_root_id
    || typeof value.created_at !== "string"
    || !value.created_at
    || typeof value.id !== "string"
    || !value.id
  ) {
    return null;
  }
  return {
    visual_root_created_at: value.visual_root_created_at,
    source,
    visual_root_id: value.visual_root_id,
    visual_depth: visualDepth,
    created_at: value.created_at,
    id: value.id,
  };
}

export function clampUnifiedTimelinePageSize(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return UNIFIED_TIMELINE_PAGE_SIZE;
  return Math.min(parsed, UNIFIED_TIMELINE_MAX_PAGE_SIZE);
}
