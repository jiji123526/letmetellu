"use client";

export interface GalleryNavigationTiming {
  targetId: string;
  mountedFastPath: boolean;
  startedAt: number;
  milestonesMs: Record<string, number>;
  outcome?: "completed" | "cancelled" | "not-found";
}

declare global {
  interface Window {
    __letmetelluGalleryNavigationPerf?: GalleryNavigationTiming[];
  }
}

export function startGalleryNavigationTiming(
  targetId: string,
  mountedFastPath: boolean,
): GalleryNavigationTiming | null {
  if (process.env.NODE_ENV === "production") return null;
  return {
    targetId,
    mountedFastPath,
    startedAt: performance.now(),
    milestonesMs: {},
  };
}

export function markGalleryNavigationTiming(
  timing: GalleryNavigationTiming | null,
  milestone: string,
): void {
  if (!timing) return;
  timing.milestonesMs[milestone] = performance.now() - timing.startedAt;
}

export function finishGalleryNavigationTiming(
  timing: GalleryNavigationTiming | null,
  outcome: NonNullable<GalleryNavigationTiming["outcome"]>,
): void {
  if (!timing) return;
  timing.outcome = outcome;
  const entries = window.__letmetelluGalleryNavigationPerf || [];
  window.__letmetelluGalleryNavigationPerf = [...entries.slice(-19), timing];
}
