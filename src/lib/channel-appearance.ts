import { normalizeBubbleColor } from "./bubble-color";

export interface ChannelAppearanceInput {
  bubble_color?: string | null;
  background_type?: "default" | "color" | "image";
  background_color?: string | null;
  background_image?: string | null;
  background_overlay?: number | null;
  background_blur?: number | boolean | null;
}

function normalizeBackgroundType(
  value: ChannelAppearanceInput["background_type"],
): "default" | "color" | "image" {
  return value === "color" || value === "image" ? value : "default";
}

function normalizeBackgroundOverlay(value: number | null | undefined): number {
  return Number.isInteger(value) ? value as number : 14;
}

function normalizeBackgroundBlur(value: number | boolean | null | undefined): number {
  return value === true || value === 1 ? 1 : 0;
}

export function getChannelAppearanceVersion(input: ChannelAppearanceInput): string {
  const normalized = [
    "v1",
    normalizeBubbleColor(input.bubble_color),
    normalizeBackgroundType(input.background_type),
    input.background_color || "",
    input.background_image || "",
    String(normalizeBackgroundOverlay(input.background_overlay)),
    String(normalizeBackgroundBlur(input.background_blur)),
  ].join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
