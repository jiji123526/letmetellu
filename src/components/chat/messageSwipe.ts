const MAX_MESSAGE_SWIPE_PX = 56;

export function isHorizontalMessageSwipe(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaX) >= 6 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15;
}

export function messageSwipeOffset(deltaX: number, isSent: boolean): number {
  const direction = isSent ? -1 : 1;
  const directionalDistance = Math.max(0, deltaX * direction);
  if (directionalDistance === 0) return 0;
  return direction * Math.min(MAX_MESSAGE_SWIPE_PX, directionalDistance);
}
