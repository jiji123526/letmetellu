"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  LIVE_WARNING_THRESHOLDS_MS,
  formatLiveCountdownClock,
  formatLiveThresholdLabel,
} from "./chatMessageUtils";

interface LiveStateSnapshot {
  active: boolean;
  title?: string;
  sessionId?: string;
  expiresAt?: string;
}

interface LiveStateResponse {
  live?: LiveStateSnapshot | null;
}

interface UseChatLiveSessionArgs {
  channelId: string;
  locale: "ko" | "en";
  texts: {
    liveTitle: string;
    liveCountdownBanner: string;
    liveCountdownLabel: string;
  };
  fetchLiveState: () => Promise<LiveStateResponse>;
  onExpiredLiveEnded: () => Promise<void> | void;
  onLiveModePresenceChange: (inLiveMode: boolean, sessionId: string) => void;
}

interface EndLiveSessionOptions {
  clearSeen?: boolean;
  showEndedPopup?: boolean;
}

interface EnterLiveModeOptions {
  markCurrentSessionSeen?: boolean;
}

interface SyncLiveSessionOptions {
  title?: string;
  sessionId?: string;
  expiresAt?: string | null;
}

interface UseChatLiveSessionResult {
  liveActive: boolean;
  inLiveMode: boolean;
  liveTitle: string;
  liveSessionId: string;
  liveExpiresAt: string | null;
  liveCountdownNotice: string | null;
  showLivePopup: boolean;
  showLiveEnded: boolean;
  showLiveTitlePrompt: boolean;
  showEndLiveConfirm: boolean;
  emojiPresets: string[] | null;
  liveLastMinuteBannerText: string | null;
  liveLastMinuteLabel: string | null;
  inLiveModeRef: MutableRefObject<boolean>;
  setShowLivePopup: Dispatch<SetStateAction<boolean>>;
  setShowLiveEnded: Dispatch<SetStateAction<boolean>>;
  setShowLiveTitlePrompt: Dispatch<SetStateAction<boolean>>;
  setShowEndLiveConfirm: Dispatch<SetStateAction<boolean>>;
  applyLiveSnapshot: (live: LiveStateSnapshot | null | undefined) => void;
  applyEmojiPresetsSnapshot: (rawPresets: string | null | undefined) => void;
  enterLiveMode: (options?: EnterLiveModeOptions) => void;
  exitLiveMode: () => void;
  startLiveLocally: (title: string) => void;
  syncLiveSessionDetails: (options: SyncLiveSessionOptions) => void;
  endLiveSessionLocally: (options?: EndLiveSessionOptions) => boolean;
  handleLiveStartedEvent: (options: SyncLiveSessionOptions) => void;
  dismissLivePopup: () => void;
}

function readStoredFlag(key: string): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(key) === "true";
}

function readStoredValue(key: string): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(key) || "";
}

function parseEmojiPresets(rawPresets: string | null | undefined): string[] | null {
  if (!rawPresets) return null;
  try {
    return JSON.parse(rawPresets) as string[];
  } catch {
    return null;
  }
}

export function useChatLiveSession({
  channelId,
  locale,
  texts,
  fetchLiveState,
  onExpiredLiveEnded,
  onLiveModePresenceChange,
}: UseChatLiveSessionArgs): UseChatLiveSessionResult {
  const liveActiveKey = `liveActive_${channelId}`;
  const inLiveModeKey = `inLiveMode_${channelId}`;
  const liveTitleKey = `liveTitle_${channelId}`;
  const liveSessionKey = `liveSession_${channelId}`;
  const liveSeenKey = `liveSeen_${channelId}`;
  const liveEmojiKey = `liveEmojis_${channelId}_live`;
  const liveNoticeDismissedKey = `noticeDismissed_${channelId}_live`;

  const [liveActive, setLiveActive] = useState(() => readStoredFlag(liveActiveKey));
  const [inLiveMode, setInLiveMode] = useState(false);
  const [liveTitle, setLiveTitle] = useState(() => readStoredValue(liveTitleKey) || texts.liveTitle);
  const [liveSessionId, setLiveSessionId] = useState(() => readStoredValue(liveSessionKey));
  const [liveExpiresAt, setLiveExpiresAt] = useState<string | null>(null);
  const [liveTimeLeftMs, setLiveTimeLeftMs] = useState<number | null>(null);
  const [liveCountdownNotice, setLiveCountdownNotice] = useState<string | null>(null);
  const [showLivePopup, setShowLivePopup] = useState(false);
  const [showLiveEnded, setShowLiveEnded] = useState(false);
  const [showLiveTitlePrompt, setShowLiveTitlePrompt] = useState(false);
  const [showEndLiveConfirm, setShowEndLiveConfirm] = useState(false);
  const [emojiPresets, setEmojiPresets] = useState<string[] | null>(null);

  const liveCountdownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveExpiryRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveExpiryCheckInFlightRef = useRef(false);
  const previousLiveTimeLeftRef = useRef<number | null>(null);
  const inLiveModeRef = useRef(inLiveMode);

  useEffect(() => {
    localStorage.setItem(inLiveModeKey, "false");
  }, [inLiveModeKey]);

  const clearLiveNoticeTimeout = useCallback(() => {
    if (!liveCountdownTimeoutRef.current) return;
    clearTimeout(liveCountdownTimeoutRef.current);
    liveCountdownTimeoutRef.current = null;
  }, []);

  const clearLiveExpiryRetryTimer = useCallback(() => {
    if (!liveExpiryRetryTimerRef.current) return;
    clearTimeout(liveExpiryRetryTimerRef.current);
    liveExpiryRetryTimerRef.current = null;
  }, []);

  const resetLiveCountdownState = useCallback(() => {
    previousLiveTimeLeftRef.current = null;
    clearLiveNoticeTimeout();
    clearLiveExpiryRetryTimer();
    liveExpiryCheckInFlightRef.current = false;
    setLiveTimeLeftMs(null);
    setLiveCountdownNotice(null);
  }, [clearLiveExpiryRetryTimer, clearLiveNoticeTimeout]);

  const syncStoredLiveSession = useCallback((options: SyncLiveSessionOptions) => {
    if (options.title !== undefined) {
      const nextTitle = options.title || texts.liveTitle;
      setLiveTitle(nextTitle);
      localStorage.setItem(liveTitleKey, nextTitle);
    }
    if (options.sessionId !== undefined) {
      setLiveSessionId(options.sessionId);
      if (options.sessionId) {
        localStorage.setItem(liveSessionKey, options.sessionId);
      } else {
        localStorage.removeItem(liveSessionKey);
      }
    }
    if (options.expiresAt !== undefined) {
      setLiveExpiresAt(options.expiresAt || null);
    }
  }, [liveSessionKey, liveTitleKey, texts.liveTitle]);

  const exitLiveMode = useCallback(() => {
    inLiveModeRef.current = false;
    setInLiveMode(false);
    localStorage.setItem(inLiveModeKey, "false");
  }, [inLiveModeKey]);

  const enterLiveMode = useCallback((options?: EnterLiveModeOptions) => {
    setShowLivePopup(false);
    setShowLiveEnded(false);
    inLiveModeRef.current = true;
    setInLiveMode(true);
    localStorage.setItem(inLiveModeKey, "true");
    localStorage.removeItem(liveNoticeDismissedKey);
    if (options?.markCurrentSessionSeen && liveSessionId) {
      localStorage.setItem(liveSeenKey, liveSessionId);
    }
  }, [inLiveModeKey, liveNoticeDismissedKey, liveSeenKey, liveSessionId]);

  const endLiveSessionLocally = useCallback((options?: EndLiveSessionOptions) => {
    const wasInLiveMode = inLiveModeRef.current;
    inLiveModeRef.current = false;
    setLiveActive(false);
    setLiveTitle(texts.liveTitle);
    setLiveSessionId("");
    setLiveExpiresAt(null);
    setShowLivePopup(false);
    resetLiveCountdownState();
    setInLiveMode(false);
    localStorage.setItem(liveActiveKey, "false");
    localStorage.setItem(inLiveModeKey, "false");
    localStorage.removeItem(liveTitleKey);
    localStorage.removeItem(liveSessionKey);
    if (options?.clearSeen) {
      localStorage.removeItem(liveSeenKey);
    }
    if (options?.showEndedPopup) {
      setShowLiveEnded(true);
    }
    return wasInLiveMode;
  }, [
    inLiveModeKey,
    liveActiveKey,
    liveSeenKey,
    liveSessionKey,
    liveTitleKey,
    resetLiveCountdownState,
    texts.liveTitle,
  ]);

  const startLiveLocally = useCallback((title: string) => {
    setShowLiveTitlePrompt(false);
    setLiveActive(true);
    localStorage.setItem(liveActiveKey, "true");
    syncStoredLiveSession({
      title,
      sessionId: "",
      expiresAt: null,
    });
    resetLiveCountdownState();
    enterLiveMode();
  }, [enterLiveMode, liveActiveKey, resetLiveCountdownState, syncStoredLiveSession]);

  const syncLiveSessionDetails = useCallback((options: SyncLiveSessionOptions) => {
    syncStoredLiveSession(options);
  }, [syncStoredLiveSession]);

  const applyLiveSnapshot = useCallback((live: LiveStateSnapshot | null | undefined) => {
    if (live?.active) {
      setLiveActive(true);
      localStorage.setItem(liveActiveKey, "true");
      syncStoredLiveSession({
        title: live.title || texts.liveTitle,
        sessionId: live.sessionId || "",
        expiresAt: live.expiresAt || null,
      });
      return;
    }

    endLiveSessionLocally();
  }, [endLiveSessionLocally, liveActiveKey, syncStoredLiveSession, texts.liveTitle]);

  const applyEmojiPresetsSnapshot = useCallback((rawPresets: string | null | undefined) => {
    if (rawPresets) {
      localStorage.setItem(liveEmojiKey, rawPresets);
      setEmojiPresets(parseEmojiPresets(rawPresets));
      return;
    }

    localStorage.removeItem(liveEmojiKey);
    setEmojiPresets(null);
  }, [liveEmojiKey]);

  const handleLiveStartedEvent = useCallback((options: SyncLiveSessionOptions) => {
    const sessionId = options.sessionId || "";
    setLiveActive(true);
    localStorage.setItem(liveActiveKey, "true");
    syncStoredLiveSession({
      title: options.title || texts.liveTitle,
      sessionId,
      expiresAt: options.expiresAt || null,
    });
    if (!inLiveModeRef.current) {
      const seenSessionId = localStorage.getItem(liveSeenKey);
      if (seenSessionId !== sessionId) {
        setShowLivePopup(true);
      }
    }
  }, [liveActiveKey, liveSeenKey, syncStoredLiveSession, texts.liveTitle]);

  const dismissLivePopup = useCallback(() => {
    setShowLivePopup(false);
    if (liveSessionId) {
      localStorage.setItem(liveSeenKey, liveSessionId);
    }
  }, [liveSeenKey, liveSessionId]);

  useEffect(() => {
    inLiveModeRef.current = inLiveMode;
  }, [inLiveMode]);

  useEffect(() => () => {
    clearLiveNoticeTimeout();
    clearLiveExpiryRetryTimer();
  }, [clearLiveExpiryRetryTimer, clearLiveNoticeTimeout]);

  useEffect(() => {
    if (inLiveMode && !liveSessionId) return;
    onLiveModePresenceChange(inLiveMode, liveSessionId);
  }, [inLiveMode, liveSessionId, onLiveModePresenceChange]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== liveActiveKey || event.newValue !== "false") return;
      const wasInLiveMode = endLiveSessionLocally({
        clearSeen: true,
        showEndedPopup: inLiveModeRef.current,
      });
      if (wasInLiveMode) {
        void Promise.resolve(onExpiredLiveEnded()).catch(() => {});
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [endLiveSessionLocally, liveActiveKey, onExpiredLiveEnded]);

  useEffect(() => {
    resetLiveCountdownState();
  }, [liveSessionId, resetLiveCountdownState]);

  useEffect(() => {
    if (!liveActive || !liveExpiresAt || !inLiveMode) {
      setLiveTimeLeftMs(null);
      return;
    }

    const updateTimeLeft = () => {
      const expiresAtMs = Date.parse(liveExpiresAt);
      if (!Number.isFinite(expiresAtMs)) {
        setLiveTimeLeftMs(null);
        return;
      }
      setLiveTimeLeftMs(Math.max(0, expiresAtMs - Date.now()));
    };

    updateTimeLeft();
    const intervalId = window.setInterval(updateTimeLeft, 1000);
    return () => window.clearInterval(intervalId);
  }, [inLiveMode, liveActive, liveExpiresAt]);

  useEffect(() => {
    if (!liveActive || !inLiveMode || liveTimeLeftMs === null) {
      previousLiveTimeLeftRef.current = null;
      return;
    }

    const previousTimeLeft = previousLiveTimeLeftRef.current;
    for (const thresholdMs of LIVE_WARNING_THRESHOLDS_MS) {
      if (previousTimeLeft !== null && previousTimeLeft > thresholdMs && liveTimeLeftMs <= thresholdMs) {
        const nextNotice = texts.liveCountdownBanner.replace(
          "{time}",
          formatLiveThresholdLabel(locale, thresholdMs),
        );
        clearLiveNoticeTimeout();
        setLiveCountdownNotice(nextNotice);
        liveCountdownTimeoutRef.current = setTimeout(() => {
          setLiveCountdownNotice((current) => current === nextNotice ? null : current);
          liveCountdownTimeoutRef.current = null;
        }, 3000);
      }
    }

    previousLiveTimeLeftRef.current = liveTimeLeftMs;
  }, [clearLiveNoticeTimeout, inLiveMode, liveActive, liveTimeLeftMs, locale, texts.liveCountdownBanner]);

  const liveLastMinuteBannerText = useMemo(() => {
    if (!liveActive || !inLiveMode || liveTimeLeftMs === null || liveTimeLeftMs > 60 * 1000) return null;
    return texts.liveCountdownBanner.replace("{time}", formatLiveCountdownClock(liveTimeLeftMs));
  }, [inLiveMode, liveActive, liveTimeLeftMs, texts.liveCountdownBanner]);

  const liveLastMinuteLabel = useMemo(() => {
    if (!liveActive || !inLiveMode || liveTimeLeftMs === null || liveTimeLeftMs > 60 * 1000) return null;
    return texts.liveCountdownLabel.replace("{time}", formatLiveCountdownClock(liveTimeLeftMs));
  }, [inLiveMode, liveActive, liveTimeLeftMs, texts.liveCountdownLabel]);

  const attemptLiveExpirySync = useCallback(async () => {
    if (liveExpiryCheckInFlightRef.current) return;
    liveExpiryCheckInFlightRef.current = true;
    try {
      const liveData = await fetchLiveState();
      if (liveData.live?.active) {
        if (liveData.live.expiresAt && liveData.live.expiresAt !== liveExpiresAt) {
          setLiveExpiresAt(liveData.live.expiresAt);
        }
        return;
      }

      const shouldShowEndedPopup = inLiveModeRef.current;
      endLiveSessionLocally({ showEndedPopup: shouldShowEndedPopup });
      await onExpiredLiveEnded();
    } catch {
      // Retry while the local live timer remains expired.
    } finally {
      liveExpiryCheckInFlightRef.current = false;
    }
  }, [endLiveSessionLocally, fetchLiveState, liveExpiresAt, onExpiredLiveEnded]);

  useEffect(() => {
    if (!liveActive || !inLiveMode || !liveExpiresAt || liveTimeLeftMs === null || liveTimeLeftMs > 0) {
      clearLiveExpiryRetryTimer();
      return;
    }

    let cancelled = false;

    const runCheck = async () => {
      await attemptLiveExpirySync();
      if (cancelled) return;
      if (!inLiveModeRef.current || !liveActive) return;
      liveExpiryRetryTimerRef.current = setTimeout(runCheck, 5000);
    };

    void runCheck();

    return () => {
      cancelled = true;
      clearLiveExpiryRetryTimer();
    };
  }, [
    attemptLiveExpirySync,
    clearLiveExpiryRetryTimer,
    inLiveMode,
    liveActive,
    liveExpiresAt,
    liveTimeLeftMs,
  ]);

  return {
    liveActive,
    inLiveMode,
    liveTitle,
    liveSessionId,
    liveExpiresAt,
    liveCountdownNotice,
    showLivePopup,
    showLiveEnded,
    showLiveTitlePrompt,
    showEndLiveConfirm,
    emojiPresets,
    liveLastMinuteBannerText,
    liveLastMinuteLabel,
    inLiveModeRef,
    setShowLivePopup,
    setShowLiveEnded,
    setShowLiveTitlePrompt,
    setShowEndLiveConfirm,
    applyLiveSnapshot,
    applyEmojiPresetsSnapshot,
    enterLiveMode,
    exitLiveMode,
    startLiveLocally,
    syncLiveSessionDetails,
    endLiveSessionLocally,
    handleLiveStartedEvent,
    dismissLivePopup,
  };
}
