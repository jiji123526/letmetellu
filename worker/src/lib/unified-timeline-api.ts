import {
  clampUnifiedTimelinePageSize,
  parseUnifiedTimelineCursor,
  type UnifiedTimelineCursor,
} from "./unified-timeline.ts";
import type { UnifiedTimelinePage } from "./unified-timeline-reader.ts";

export const UNIFIED_TIMELINE_CONTRACT_VERSION = 1;

const CURSOR_FIELDS = [
  "cursor_visual_root_created_at",
  "cursor_source",
  "cursor_visual_root_id",
  "cursor_visual_depth",
  "cursor_created_at",
  "cursor_id",
] as const;

type UnifiedTimelineDirection = "before" | "after";

export type UnifiedTimelinePageRequest =
  | {
      ok: true;
      cursor: UnifiedTimelineCursor | null;
      direction: UnifiedTimelineDirection;
      limit: number;
    }
  | {
      ok: false;
      error: "invalid_unified_cursor" | "invalid_unified_direction";
    };

function isCanonicalRootCursor(cursor: UnifiedTimelineCursor): boolean {
  return cursor.visual_depth === 0
    && cursor.created_at === cursor.visual_root_created_at
    && cursor.id === cursor.visual_root_id;
}

export function parseUnifiedTimelinePageRequest(
  searchParams: URLSearchParams,
): UnifiedTimelinePageRequest {
  const cursorValues = CURSOR_FIELDS.map((field) => searchParams.get(field));
  const suppliedCursorFields = cursorValues.filter((value) => value !== null).length;
  const hasDuplicateCursorField = CURSOR_FIELDS.some(
    (field) => searchParams.getAll(field).length > 1,
  );
  if (
    hasDuplicateCursorField
    || (suppliedCursorFields !== 0 && suppliedCursorFields !== CURSOR_FIELDS.length)
  ) {
    return { ok: false, error: "invalid_unified_cursor" };
  }

  const directionValues = searchParams.getAll("direction");
  const directionValue = directionValues[0] || null;
  if (directionValues.length > 1) {
    return { ok: false, error: "invalid_unified_direction" };
  }

  if (suppliedCursorFields === 0) {
    if (directionValue !== null) {
      return { ok: false, error: "invalid_unified_direction" };
    }
    return {
      ok: true,
      cursor: null,
      direction: "before",
      limit: clampUnifiedTimelinePageSize(searchParams.get("limit")),
    };
  }

  if (directionValue !== "before" && directionValue !== "after") {
    return { ok: false, error: "invalid_unified_direction" };
  }

  const cursor = parseUnifiedTimelineCursor({
    visual_root_created_at: cursorValues[0],
    source: cursorValues[1],
    visual_root_id: cursorValues[2],
    visual_depth: cursorValues[3],
    created_at: cursorValues[4],
    id: cursorValues[5],
  });
  if (!cursor || !isCanonicalRootCursor(cursor)) {
    return { ok: false, error: "invalid_unified_cursor" };
  }

  return {
    ok: true,
    cursor,
    direction: directionValue,
    limit: clampUnifiedTimelinePageSize(searchParams.get("limit")),
  };
}

export function serializeUnifiedTimelinePage(page: UnifiedTimelinePage) {
  return {
    contract_version: UNIFIED_TIMELINE_CONTRACT_VERSION,
    items: page.items,
    has_more: page.hasMore,
    page_start_cursor: page.pageStartCursor,
    page_end_cursor: page.pageEndCursor,
  };
}
