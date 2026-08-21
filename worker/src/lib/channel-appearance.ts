import type { Env } from "../types.ts";
import {
  DEFAULT_BACKGROUND_OVERLAY,
  DEFAULT_BUBBLE_COLOR,
} from "./plan-feature-gates.ts";

export function normalizeBubbleColor(value: string | null | undefined): string {
  if (!value || value.toLowerCase() === "#3b8df0") {
    return DEFAULT_BUBBLE_COLOR;
  }
  return value;
}

export interface ChannelAppearanceInput {
  bubble_color?: string | null;
  background_type?: "default" | "color" | "image" | null;
  background_color?: string | null;
  background_image?: string | null;
  background_overlay?: number | null;
  background_blur?: number | boolean | null;
}

export interface NormalizedChannelAppearance {
  bubble_color: string;
  background_type: "default" | "color" | "image";
  background_color: string | null;
  background_image: string | null;
  background_overlay: number;
  background_blur: number;
}

function normalizeBackgroundType(
  value: ChannelAppearanceInput["background_type"],
): "default" | "color" | "image" {
  return value === "color" || value === "image" ? value : "default";
}

function normalizeBackgroundOverlay(value: number | null | undefined): number {
  return Number.isInteger(value) ? value as number : DEFAULT_BACKGROUND_OVERLAY;
}

function normalizeBackgroundBlur(value: number | boolean | null | undefined): number {
  return value === true || value === 1 ? 1 : 0;
}

export function normalizeChannelAppearance(
  input: ChannelAppearanceInput,
): NormalizedChannelAppearance {
  return {
    bubble_color: normalizeBubbleColor(input.bubble_color),
    background_type: normalizeBackgroundType(input.background_type),
    background_color: input.background_color || null,
    background_image: input.background_image || null,
    background_overlay: normalizeBackgroundOverlay(input.background_overlay),
    background_blur: normalizeBackgroundBlur(input.background_blur),
  };
}

export function hasPremiumChannelAppearance(input: ChannelAppearanceInput): boolean {
  const normalized = normalizeChannelAppearance(input);
  return (
    normalized.bubble_color !== DEFAULT_BUBBLE_COLOR
    || normalized.background_type !== "default"
    || normalized.background_color !== null
    || normalized.background_image !== null
    || normalized.background_overlay !== DEFAULT_BACKGROUND_OVERLAY
    || normalized.background_blur !== 0
  );
}

export function applyFreeChannelAppearance<T extends ChannelAppearanceInput>(
  input: T,
): T & NormalizedChannelAppearance {
  return {
    ...input,
    bubble_color: DEFAULT_BUBBLE_COLOR,
    background_type: "default",
    background_color: null,
    background_image: null,
    background_overlay: DEFAULT_BACKGROUND_OVERLAY,
    background_blur: 0,
  };
}

export async function resetPersistedChannelAppearanceIfNeeded(
  env: Env,
  channelId: string,
  currentAppearance?: ChannelAppearanceInput | null,
): Promise<boolean> {
  const appearance = currentAppearance || await env.DB.prepare(
    `SELECT bubble_color, background_type, background_color, background_image,
            background_overlay, background_blur
     FROM channels
     WHERE id = ?
     LIMIT 1`
  ).bind(channelId).first<ChannelAppearanceInput>();
  if (!appearance || !hasPremiumChannelAppearance(appearance)) {
    return false;
  }

  await env.DB.prepare(`
    UPDATE channels
    SET bubble_color = ?,
        background_type = 'default',
        background_color = NULL,
        background_image = NULL,
        background_overlay = ?,
        background_blur = 0
    WHERE id = ?
  `).bind(
    DEFAULT_BUBBLE_COLOR,
    DEFAULT_BACKGROUND_OVERLAY,
    channelId,
  ).run();
  return true;
}

export async function resetOwnedChannelAppearancesIfNeeded(
  env: Env,
  ownerUid: string,
): Promise<string[]> {
  const { results } = await env.DB.prepare(`
    SELECT id
    FROM channels
    WHERE owner_uid = ?
      AND id NOT LIKE '%_live'
      AND (
        bubble_color IS NOT NULL
        AND lower(bubble_color) NOT IN ('#3598fe', '#3b8df0')
        OR COALESCE(background_type, 'default') != 'default'
        OR background_color IS NOT NULL
        OR background_image IS NOT NULL
        OR COALESCE(background_overlay, ?) != ?
        OR COALESCE(background_blur, 0) != 0
      )
  `).bind(
    ownerUid,
    DEFAULT_BACKGROUND_OVERLAY,
    DEFAULT_BACKGROUND_OVERLAY,
  ).all<{ id: string }>();

  const channelIds = (results || []).map((row) => row.id);
  if (channelIds.length === 0) {
    return [];
  }

  await env.DB.batch(channelIds.map((channelId) => env.DB.prepare(`
    UPDATE channels
    SET bubble_color = ?,
        background_type = 'default',
        background_color = NULL,
        background_image = NULL,
        background_overlay = ?,
        background_blur = 0
    WHERE id = ?
  `).bind(
    DEFAULT_BUBBLE_COLOR,
    DEFAULT_BACKGROUND_OVERLAY,
    channelId,
  )));

  return channelIds;
}

export function getChannelAppearanceVersion(input: ChannelAppearanceInput): string {
  const normalizedInput = normalizeChannelAppearance(input);
  const normalized = [
    "v1",
    normalizedInput.bubble_color,
    normalizedInput.background_type,
    normalizedInput.background_color || "",
    normalizedInput.background_image || "",
    String(normalizedInput.background_overlay),
    String(normalizedInput.background_blur),
  ].join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
