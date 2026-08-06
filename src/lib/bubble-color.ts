export const DEFAULT_BUBBLE_COLOR = "#3598fe";

const REPLACED_BUBBLE_COLOR = "#3b8df0";

export function normalizeBubbleColor(color: string | null | undefined): string {
  if (!color || color.toLowerCase() === REPLACED_BUBBLE_COLOR) {
    return DEFAULT_BUBBLE_COLOR;
  }
  return color;
}
