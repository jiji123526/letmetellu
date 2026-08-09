"use client";

import { useEffect, useState } from "react";

function readVisibleViewportHeight(): number | null {
  if (typeof window === "undefined") return null;
  const viewport = window.visualViewport;
  if (!viewport) return Math.round(window.innerHeight);
  return Math.round(viewport.height + viewport.offsetTop);
}

export function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    let frame = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nextHeight = readVisibleViewportHeight();
        setHeight((current) => current === nextHeight ? current : nextHeight);
      });
    };

    const settleAfterFocusChange = () => {
      measure();
      for (const delay of [80, 240, 500]) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          measure();
        }, delay);
        timers.add(timer);
      }
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", settleAfterFocusChange);
    document.addEventListener("focusin", settleAfterFocusChange);
    document.addEventListener("focusout", settleAfterFocusChange);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);

    return () => {
      cancelAnimationFrame(frame);
      for (const timer of timers) clearTimeout(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", settleAfterFocusChange);
      document.removeEventListener("focusin", settleAfterFocusChange);
      document.removeEventListener("focusout", settleAfterFocusChange);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, []);

  return height;
}
