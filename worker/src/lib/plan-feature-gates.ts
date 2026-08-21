export const FREE_OWNED_CHANNEL_LIMIT = 1;
export const PLUS_OWNED_CHANNEL_LIMIT = 5;
export const DEFAULT_BUBBLE_COLOR = "#3598fe";
export const DEFAULT_BACKGROUND_OVERLAY = 14;

export function getOwnedChannelLimit(hasPlus: boolean): number {
  return hasPlus ? PLUS_OWNED_CHANNEL_LIMIT : FREE_OWNED_CHANNEL_LIMIT;
}

export function isPremiumAppearanceWrite(input: {
  bubbleColor?: unknown;
  backgroundType?: unknown;
  backgroundColor?: unknown;
  backgroundImage?: string | null | undefined;
  backgroundOverlay?: number | undefined;
  backgroundBlur?: number | undefined;
}): boolean {
  if (
    input.bubbleColor !== undefined
    && input.bubbleColor !== null
    && input.bubbleColor !== DEFAULT_BUBBLE_COLOR
  ) {
    return true;
  }
  if (input.backgroundType !== undefined && input.backgroundType !== "default") {
    return true;
  }
  if (input.backgroundColor !== undefined && input.backgroundColor !== null) {
    return true;
  }
  if (input.backgroundImage !== undefined && input.backgroundImage !== null) {
    return true;
  }
  if (
    input.backgroundOverlay !== undefined
    && input.backgroundOverlay !== DEFAULT_BACKGROUND_OVERLAY
  ) {
    return true;
  }
  if (input.backgroundBlur !== undefined && input.backgroundBlur !== 0) {
    return true;
  }
  return false;
}
