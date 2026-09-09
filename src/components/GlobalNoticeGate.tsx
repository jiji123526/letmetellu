"use client";

import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  fetchGlobalNotice,
  GLOBAL_NOTICE_UPDATED_EVENT,
  type GlobalNotice,
} from "@/lib/api-global-notice";
import { GlobalNoticeDialog } from "@/components/dashboard/GlobalNoticeDialog";

function getViewerKey(userId: string | undefined) {
  return userId ? `user:${userId}` : "guest";
}

export function GlobalNoticeGate() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [notice, setNotice] = useState<GlobalNotice | null>(null);
  const [visible, setVisible] = useState(false);
  const viewerKey = getViewerKey(session?.user?.id);

  const loadNotice = useCallback(async () => {
    try {
      const nextNotice = await fetchGlobalNotice();
      setNotice(nextNotice);
      if (!nextNotice) {
        setVisible(false);
      }
    } catch {
      // Global notice failures must not block page usage.
    }
  }, []);

  const closeNotice = useCallback(() => {
    if (notice) {
      try {
        localStorage.setItem(`yap_global_notice_seen_${viewerKey}_${notice.version}`, "seen");
      } catch {}
    }
    setVisible(false);
  }, [notice, viewerKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadNotice();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadNotice, pathname]);

  useEffect(() => {
    const handleNoticeUpdated = () => {
      void loadNotice();
    };
    window.addEventListener(GLOBAL_NOTICE_UPDATED_EVENT, handleNoticeUpdated);
    return () => window.removeEventListener(GLOBAL_NOTICE_UPDATED_EVENT, handleNoticeUpdated);
  }, [loadNotice]);

  useEffect(() => {
    if (status === "loading" || !notice) return;
    let shouldShow = true;
    try {
      shouldShow = localStorage.getItem(`yap_global_notice_seen_${viewerKey}_${notice.version}`) !== "seen";
    } catch {}
    if (!shouldShow) {
      const timer = window.setTimeout(() => setVisible(false), 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setVisible(true), 0);
    return () => window.clearTimeout(timer);
  }, [notice, status, viewerKey]);

  if (!visible || !notice) {
    return null;
  }

  return <GlobalNoticeDialog notice={notice} onClose={closeNotice} />;
}
