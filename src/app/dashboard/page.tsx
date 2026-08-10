"use client";

import { CloseIcon } from "@/components/ui/CloseIcon";
import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Providers } from "@/components/Providers";
import { useLocale } from "@/hooks/useLocale";
import { useForegroundPolling } from "@/hooks/useForegroundPolling";
import { decorateMediaUrl } from "@/lib/api-core";
import {
  clearStoredSupportTicketPreview,
  closeSupportThread,
  fetchPlatformDashboard,
  fetchPlatformDashboardStats,
  fetchPlatformDashboardVersion,
  fetchPlatformOperationalHealth,
  fetchSupportPreview,
  readStoredSupportTicketPreview,
  storeSupportTicketPreview,
  type PlatformDashboardResponse,
  type PlatformOperationalHealthResponse,
} from "@/lib/api-support";
import { clearRecentChannels, getRecentChannels, markRecentChannelsValidated, removeRecentChannel, shouldValidateRecentChannels, toggleRecentChannelPinned, type RecentChannel } from "@/lib/recent-channels";
import { normalizeBubbleColor } from "@/lib/bubble-color";
import { clearChannelLocalState } from "@/lib/channel-local-state";
import { parseServerDate } from "@/lib/chat-date";
import { FirstChannelOnboarding } from "@/components/dashboard/FirstChannelOnboarding";
import { GuestOnboarding } from "@/components/dashboard/GuestOnboarding";
import { ConfirmDialog } from "@/components/chat/ConfirmDialog";
import { UserGuidePanel } from "@/components/chat/UserGuidePanel";
import { AdminGuidePanel } from "@/components/admin/AdminGuidePanel";
import { DashboardHelpMenu } from "@/components/dashboard/DashboardHelpMenu";
import { PlatformOperationalHealthCard } from "@/components/support/PlatformOperationalHealthCard";
import { LoginDialog } from "@/components/dashboard/LoginDialog";
import { BetaNoticeDialog } from "@/components/dashboard/BetaNoticeDialog";
import { LegalFooter } from "@/components/legal/LegalFooter";
import { ThemeLogo } from "@/components/ThemeLogo";
import { VisitSurvey } from "@/components/VisitSurvey";
import {
  fetchAccountRecentChannels,
  mergeAccountRecentChannels,
  readCachedAccountRecentChannels,
  removeAccountRecentChannel,
  setAccountRecentChannelPinned,
  storeCachedAccountRecentChannels,
} from "@/lib/account-recent-channels";
import {
  finishDashboardRequest,
  markDashboardMilestone,
  startDashboardPerformanceTrace,
  startDashboardRequest,
} from "@/lib/dashboard-performance";
import { fetchCurrentUserState } from "@/lib/current-user-state";

interface Channel {
  id: string;
  name: string;
  profile_image: string | null;
  bubble_color: string;
  created_at: string;
  last_message_at?: string;
  has_passcode: number;
  owner_name: string | null;
  live_active: number;
}

interface SupportDashboardPreview {
  threadId: string;
  topicLabel: string;
  preview: string;
  updatedAt: string;
  unreadForUser?: boolean;
  waitingOn?: "user" | "platform_admin" | null;
  staleLevel?: "none" | "stale" | "critical";
}

interface DashboardListItem {
  id: string;
  group: "reports" | "tickets" | "owned" | "joined" | "search-result" | "support-preview";
  kind: "channel" | "support";
  supportThreadId?: string;
  supportTopic?: string | null;
  supportIcon?: string | null;
  supportIconBg?: string | null;
  supportIconColor?: string | null;
  supportUnread?: boolean;
  supportWaitingOn?: "user" | "platform_admin" | null;
  supportActorType?: "guest" | "logged_in";
  supportStaleLevel?: "none" | "stale" | "critical";
  route: string;
  name: string;
  profileImage: string | null;
  bubbleColor: string;
  hasPasscode: boolean;
  ownerName: string;
  meta: string;
  time: string;
  owned: boolean;
  pinned: boolean;
  activityAt: string;
  liveActive: boolean;
}

const ADMIN_DASHBOARD_POLL_MS = 60000;
const ADMIN_DASHBOARD_STATS_POLL_MS = 5 * 60 * 1000;
const OPERATIONAL_HEALTH_POLL_MS = 5 * 60 * 1000;
const OPERATIONAL_HEALTH_MIN_REFRESH_MS = 60 * 1000;
const SUPPORT_PREVIEW_POLL_MS = 60000;
const DASHBOARD_REFRESH_TICK_MS = Math.min(ADMIN_DASHBOARD_POLL_MS, SUPPORT_PREVIEW_POLL_MS);
type PlatformTicketFilter = "open" | "needs_reply" | "waiting_user" | "unread" | "stale" | "critical" | null;

function formatDate(value: string, locale: "ko" | "en") {
  const date = parseServerDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric" }).format(date);
}

function formatRelativeTime(timestamp: number, locale: "ko" | "en") {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return locale === "ko" ? "방금" : "Now";
  if (minutes < 60) return locale === "ko" ? `${minutes}분 전` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return locale === "ko" ? `${hours}시간 전` : `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return locale === "ko" ? `${days}일 전` : `${days}d`;
  return formatDate(new Date(timestamp).toISOString(), locale);
}

function formatDurationMinutes(minutes: number, locale: "ko" | "en") {
  if (minutes < 60) return locale === "ko" ? `${Math.max(1, minutes)}분` : `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return locale === "ko" ? `${hours}시간` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return locale === "ko" ? `${days}일` : `${days}d`;
}

function getChannelPreviewColor(channelId: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  try {
    const storedColor = localStorage.getItem(`bubbleColor_${channelId}`);
    if (!storedColor) return normalizeBubbleColor(fallback);
    const normalizedColor = normalizeBubbleColor(storedColor);
    if (normalizedColor !== storedColor) {
      localStorage.setItem(`bubbleColor_${channelId}`, normalizedColor);
    }
    return normalizedColor;
  } catch {
    return normalizeBubbleColor(fallback);
  }
}

function getChannelIdFromLink(value: string) {
  const match = value.trim().match(/^(?:(?:https?:\/\/(?:www\.)?yapndot\.com|(?:www\.)?yapndot\.com|https?:\/\/letmetellu\.vercel\.app|letmetellu\.vercel\.app|https?:\/\/localhost(?::\d+)?|localhost(?::\d+)?))?\/ch\/([a-z0-9-]{3,30})\/?(?:[?#].*)?$/i);
  return match?.[1]?.toLowerCase() || null;
}

function looksLikeChannelAddress(value: string) {
  return /^(?:(?:https?:\/\/(?:www\.)?yapndot\.com|(?:www\.)?yapndot\.com|https?:\/\/letmetellu\.vercel\.app|letmetellu\.vercel\.app|https?:\/\/localhost(?::\d+)?|localhost(?::\d+)?))?\/ch\//i.test(value.trim());
}

function localMigrationSignature(channels: RecentChannel[]) {
  return channels.map((channel) => channel.id).sort().join(",");
}

function getSupportTopicVisual(topic: string | null | undefined) {
  switch (topic) {
    case "login":
      return {
        background: "#eaf2ff",
        color: "#2563eb",
        icon: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round'><path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'/><circle cx='12' cy='7' r='4'/></svg>",
      };
    case "passcode":
      return {
        background: "#fff3d8",
        color: "#b45309",
        icon: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round'><rect x='3' y='11' width='18' height='10' rx='2'/><path d='M7 11V7a5 5 0 0 1 10 0v4'/></svg>",
      };
    case "blocked":
      return {
        background: "#ffe8e8",
        color: "#dc2626",
        icon: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round'><circle cx='12' cy='12' r='9'/><path d='M7 7l10 10'/></svg>",
      };
    case "reports":
      return {
        background: "#ffe8e8",
        color: "#b91c1c",
        icon: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><path d='M12 9v4'/><circle cx='12' cy='16.5' r='.9' fill='currentColor' stroke='none'/><path d='M10.29 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.71 3.86a2 2 0 0 0-3.42 0z'/></svg>",
      };
    case "live":
      return {
        background: "#e6f7ed",
        color: "#15803d",
        icon: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='9'/><circle cx='12' cy='12' r='2.5'/><path d='M12 3v2M12 19v2M3 12h2M19 12h2'/></svg>",
      };
    case "other":
    default:
      return {
        background: "#eef2f7",
        color: "#475569",
        icon: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M9.5 9.5a2.5 2.5 0 1 1 4 2c-.9.6-1.5 1.1-1.5 2.5'/><circle cx='12' cy='17' r='.9' fill='currentColor' stroke='none'/><circle cx='12' cy='12' r='9'/></svg>",
      };
  }
}

function DashboardLoadingSkeleton({ label }: { label: string }) {
  const rows = [
    { title: "44%", meta: "62%" },
    { title: "36%", meta: "48%" },
    { title: "52%", meta: "70%" },
    { title: "40%", meta: "55%" },
    { title: "47%", meta: "64%" },
    { title: "34%", meta: "46%" },
  ];

  return (
    <main
      className="dashboard-font-scaled min-h-dvh"
      style={{ background: "var(--bg)", color: "var(--gray-text)" }}
      aria-busy="true"
      aria-label={label}
    >
      <div
        className="mx-auto flex min-h-dvh max-w-[480px] flex-col md:border-x"
        style={{ borderColor: "var(--hairline)" }}
      >
        <header className="sticky top-0 z-30" style={{ background: "var(--header-bg)" }}>
          <div className="flex h-[64px] items-center justify-between px-4">
            <div className="min-w-[72px]">
              <div className="h-3.5 w-10 rounded-full animate-pulse" style={{ background: "var(--gray-bubble)" }} />
            </div>
            <div className="h-12 w-12 rounded-full animate-pulse" style={{ background: "var(--gray-bubble)" }} />
            <div className="flex min-w-[72px] justify-end">
              <div className="h-6 w-6 rounded-full animate-pulse" style={{ background: "var(--gray-bubble)" }} />
            </div>
          </div>
          <div className="px-4 pb-3">
            <div className="h-10 w-full rounded-[12px] animate-pulse" style={{ background: "var(--input-bg)" }} />
          </div>
        </header>

        <section>
          <div className="px-4 pb-1.5 pt-3">
            <div className="h-3 w-20 rounded-full animate-pulse" style={{ background: "var(--gray-bubble)" }} />
          </div>
          {rows.map((row, index) => (
            <div key={index} className="flex min-h-[74px] items-center pl-4">
              <div className="h-[50px] w-[50px] shrink-0 rounded-full animate-pulse" style={{ background: "var(--gray-bubble)" }} />
              <div
                className="ml-3.5 flex min-w-0 flex-1 flex-col justify-center self-stretch border-b py-2 pr-4"
                style={{ borderColor: "var(--hairline)" }}
              >
                <div className="flex items-center justify-between gap-4">
                  <div
                    className="h-4 rounded-full animate-pulse"
                    style={{ width: row.title, background: "var(--gray-bubble)" }}
                  />
                  <div className="h-3 w-9 shrink-0 rounded-full animate-pulse" style={{ background: "var(--gray-bubble)" }} />
                </div>
                <div
                  className="mt-2 h-3 rounded-full animate-pulse"
                  style={{ width: row.meta, background: "var(--gray-bubble)" }}
                />
              </div>
            </div>
          ))}
        </section>
      </div>
      <span className="sr-only">{label}</span>
    </main>
  );
}

function DashboardPageContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { locale, setLocale, t } = useLocale();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [recentChannels, setRecentChannels] = useState<RecentChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [submittedLinkedChannelId, setSubmittedLinkedChannelId] = useState<string | null>(null);
  const [linkedChannel, setLinkedChannel] = useState<Channel | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showFirstOnboarding, setShowFirstOnboarding] = useState(false);
  const [showGuestOnboarding, setShowGuestOnboarding] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showBetaNotice, setShowBetaNotice] = useState(false);
  const [showBetaCapacityNotice, setShowBetaCapacityNotice] = useState(false);
  const [checkingChannelCapacity, setCheckingChannelCapacity] = useState(false);
  const [showUserGuide, setShowUserGuide] = useState(false);
  const [showAdminGuide, setShowAdminGuide] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginInitialTab, setLoginInitialTab] = useState<"login" | "signup">("login");
  const [pendingLocalChannels, setPendingLocalChannels] = useState<RecentChannel[] | null>(null);
  const [migratingLocalChannels, setMigratingLocalChannels] = useState(false);
  const [localMigrationError, setLocalMigrationError] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const createFieldsValid = Boolean(newName.trim()) && /^[a-z0-9-]{3,30}$/.test(newSlug.trim());
  const [editing, setEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: "owned-single"; channelIds: string[] }
    | { kind: "selected"; channelIds: string[] }
    | { kind: "support-thread"; threadId: string }
    | null
  >(null);
  const [deleteError, setDeleteError] = useState<{ title: string; message: string } | null>(null);
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [showDeleteAccountError, setShowDeleteAccountError] = useState(false);
  const [platformDashboard, setPlatformDashboard] = useState<PlatformDashboardResponse | null>(null);
  const [platformDashboardError, setPlatformDashboardError] = useState(false);
  const [platformAdminRole, setPlatformAdminRole] = useState<{
    userId: string;
    isAdmin: boolean;
  } | null>(null);
  const [operationalHealth, setOperationalHealth] = useState<PlatformOperationalHealthResponse | null>(null);
  const [operationalHealthLoading, setOperationalHealthLoading] = useState(false);
  const [operationalHealthError, setOperationalHealthError] = useState(false);
  const [operationalHealthExpanded, setOperationalHealthExpanded] = useState(false);
  const [loadingMorePlatformTickets, setLoadingMorePlatformTickets] = useState(false);
  const [platformTicketFilter, setPlatformTicketFilter] = useState<PlatformTicketFilter>(null);
  const [supportPreview, setSupportPreview] = useState<SupportDashboardPreview | null>(() => readStoredSupportTicketPreview());
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [prioritizedOwnedId, setPrioritizedOwnedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return localStorage.getItem("letmetellu_prioritized_owned_channel"); } catch { return null; }
  });
  const channelItemRefs = useRef(new Map<string, HTMLDivElement>());
  const previousItemPositionsRef = useRef(new Map<string, number>());
  const skipNextListAnimationRef = useRef(false);
  const rowAnimationsRef = useRef(new Map<string, Animation>());
  const listAnimationsEnabledRef = useRef(false);
  const loadChannelsInFlightRef = useRef<Promise<boolean> | null>(null);
  const loadPlatformDashboardInFlightRef = useRef<Promise<boolean> | null>(null);
  const loadPlatformDashboardVersionInFlightRef = useRef<Promise<void> | null>(null);
  const loadPlatformDashboardStatsInFlightRef = useRef<Promise<void> | null>(null);
  const platformDashboardLoadedAtRef = useRef(0);
  const platformDashboardStatsLoadedAtRef = useRef(0);
  const platformDashboardVersionRef = useRef<string | null>(null);
  const loadOperationalHealthInFlightRef = useRef<Promise<void> | null>(null);
  const operationalHealthLoadedAtRef = useRef(0);
  const loadSupportPreviewInFlightRef = useRef<Promise<void> | null>(null);
  const supportPreviewLoadedAtRef = useRef(0);
  const [swipe, setSwipe] = useState<{ id: string | null; offset: number }>({ id: null, offset: 0 });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const swipeStartRef = useRef<{ id: string; x: number; y: number; startOffset: number; moved: boolean; width: number } | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  const channelLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copiedChannelId, setCopiedChannelId] = useState<string | null>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const linkedChannelId = submittedLinkedChannelId;
  const hasSearchQuery = query.trim().length > 0;
  const isAddressQuery = looksLikeChannelAddress(query);
  const authenticatedUserId = session?.user?.id;
  const hasResolvedPlatformRole = Boolean(
    authenticatedUserId && platformAdminRole?.userId === authenticatedUserId
  );
  const isPlatformAdmin = hasResolvedPlatformRole && platformAdminRole?.isAdmin === true;

  useEffect(() => {
    listAnimationsEnabledRef.current = false;
    previousItemPositionsRef.current = new Map();
    rowAnimationsRef.current.forEach((animation) => animation.cancel());
    rowAnimationsRef.current.clear();
  }, [authenticatedUserId, status]);

  useEffect(() => () => {
    rowAnimationsRef.current.forEach((animation) => animation.cancel());
    rowAnimationsRef.current.clear();
  }, []);

  const togglePlatformTicketFilter = useCallback((nextFilter: Exclude<PlatformTicketFilter, null>) => {
    skipNextListAnimationRef.current = true;
    setPlatformTicketFilter((current) => current === nextFilter ? null : nextFilter);
  }, []);
  const submitLinkedChannelSearch = useCallback((value: string) => {
    const channelId = getChannelIdFromLink(value);
    if (!channelId) return false;
    setSubmittedLinkedChannelId(channelId);
    return true;
  }, []);
  const ownedChannelIds = useMemo(() => {
    const ids = new Set(channels.map((channel) => channel.id));
    const userId = session?.user?.id;
    if (userId) {
      recentChannels.forEach((channel) => {
        if (channel.ownerUid === userId) ids.add(channel.id);
      });
    }
    return ids;
  }, [channels, recentChannels, session?.user?.id]);

  useEffect(() => () => {
    if (channelLongPressTimerRef.current) clearTimeout(channelLongPressTimerRef.current);
    if (copiedResetTimerRef.current) clearTimeout(copiedResetTimerRef.current);
  }, []);

  useEffect(() => {
    startDashboardPerformanceTrace();
  }, []);

  useEffect(() => {
    if (status !== "loading") {
      markDashboardMilestone("session-ready");
    }
  }, [status]);

  useEffect(() => {
    if (!loading) {
      markDashboardMilestone("usable");
    }
  }, [loading]);

  useEffect(() => {
    const syncViewportHeight = () => {
      setViewportHeight(window.innerHeight);
    };
    syncViewportHeight();
    window.addEventListener("resize", syncViewportHeight);
    return () => window.removeEventListener("resize", syncViewportHeight);
  }, []);

  const loadChannels = useCallback((): Promise<boolean> => {
    if (!authenticatedUserId) return Promise.resolve(false);
    if (loadChannelsInFlightRef.current) return loadChannelsInFlightRef.current;
    const request = (async () => {
      startDashboardRequest("user-bootstrap");
      const response = await fetchCurrentUserState<Channel>(authenticatedUserId);
      const data = response.data;
      if (!response.ok) throw new Error("user dashboard unavailable");
      const isAdmin = data.is_platform_admin === true;
      setPlatformAdminRole({
        userId: data.user_id || authenticatedUserId || "",
        isAdmin,
      });
      setChannels((data.channels || []).map((channel) => ({
        ...channel,
        profile_image: decorateMediaUrl(channel.profile_image),
      })));
      markDashboardMilestone("channels-ready");
      return isAdmin;
    })().finally(() => {
      finishDashboardRequest("user-bootstrap");
      if (loadChannelsInFlightRef.current === request) {
        loadChannelsInFlightRef.current = null;
      }
    });
    loadChannelsInFlightRef.current = request;
    return request;
  }, [authenticatedUserId]);

  const loadLocalRecentChannels = useCallback(async () => {
    const stored = getRecentChannels();
    setRecentChannels(stored);
    if (stored.length === 0) return;
    if (!shouldValidateRecentChannels(stored)) return;
    try {
      const chunks: RecentChannel[][] = [];
      for (let index = 0; index < stored.length; index += 20) {
        chunks.push(stored.slice(index, index + 20));
      }
      const responses = await Promise.all(chunks.map(async (chunk) => {
        const ids = chunk.map((channel) => channel.id).join(",");
        const response = await fetch(`/api/channels/exists?ids=${encodeURIComponent(ids)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("channel validation failed");
        const data = await response.json() as { existingIds?: string[] };
        if (!Array.isArray(data.existingIds)) throw new Error("invalid channel validation");
        return data.existingIds;
      }));
      const existingIds = new Set(responses.flat());
      stored.forEach((channel) => {
        if (!existingIds.has(channel.id)) removeRecentChannel(channel.id);
      });
      const refreshed = getRecentChannels();
      setRecentChannels(refreshed);
      markRecentChannelsValidated(refreshed);
    } catch {
      // Keep locally stored channels when validation is temporarily unavailable.
    }
  }, []);

  const loadAccountRecentChannels = useCallback(async (
    userId: string,
    options?: { skipListAnimation?: boolean },
  ) => {
    const migrationKey = `letmetellu_recent_channels_migrated_${userId}`;
    startDashboardRequest("recent-channels");
    try {
      const accountChannels = await fetchAccountRecentChannels();
      if (options?.skipListAnimation) {
        skipNextListAnimationRef.current = true;
      }
      setRecentChannels(accountChannels);
      storeCachedAccountRecentChannels(userId, accountChannels);
      markDashboardMilestone("recent-channels-ready");
      const migrationState = localStorage.getItem(migrationKey);
      const accountChannelIds = new Set(accountChannels.map((channel) => channel.id));
      const unsyncedLocalChannels = getRecentChannels().filter(
        (channel) => !accountChannelIds.has(channel.id)
      );
      if (unsyncedLocalChannels.length > 0) {
        const skippedState = `skipped:${localMigrationSignature(unsyncedLocalChannels)}`;
        if (migrationState !== skippedState) {
          setPendingLocalChannels(unsyncedLocalChannels);
        }
      } else {
        setPendingLocalChannels(null);
        if (!migrationState) {
          localStorage.setItem(migrationKey, "merged");
        }
      }
    } catch {
      // Do not replace account data with device-local history on a transient failure.
      setRecentChannels([]);
    } finally {
      finishDashboardRequest("recent-channels");
    }
  }, []);

  const loadPlatformDashboard = useCallback((includeStats = true): Promise<boolean> => {
    if (loadPlatformDashboardInFlightRef.current) return loadPlatformDashboardInFlightRef.current;
    const request = (async (): Promise<boolean> => {
      if (status !== "authenticated") {
        setPlatformDashboard(null);
        setPlatformDashboardError(false);
        setOperationalHealth(null);
        setOperationalHealthError(false);
        return false;
      }
      try {
        startDashboardRequest("admin-dashboard");
        const [result, versionResult] = await Promise.all([
          fetchPlatformDashboard(null, { includeStats }),
          fetchPlatformDashboardVersion(),
        ]);
        if (versionResult._status < 400) {
          platformDashboardVersionRef.current = versionResult.version;
        }
        if (result._status === 403 || result._status === 404) {
          setPlatformAdminRole((current) => current ? { ...current, isAdmin: false } : current);
          setPlatformDashboard(null);
          setPlatformDashboardError(false);
          setOperationalHealth(null);
          setOperationalHealthError(false);
          return false;
        }
        if (result._status >= 400) {
          setPlatformDashboard(null);
          setPlatformDashboardError(true);
          return true;
        }
        if (result.support_stats !== undefined) {
          platformDashboardStatsLoadedAtRef.current = Date.now();
        }
        setPlatformDashboardError(false);
        setPlatformDashboard((current) => {
          const nextDashboard: PlatformDashboardResponse = {
            reportsInbox: result.reportsInbox ?? null,
            tickets: result.tickets || [],
            open_pagination: result.open_pagination ?? null,
            support_stats: result.support_stats !== undefined
              ? result.support_stats
              : current?.support_stats ?? null,
          };
          if (!current) return nextDashboard;
          const currentOpenCount = current.tickets.filter((ticket) => ticket.status === "open").length;
          const nextOpenCount = nextDashboard.tickets.filter((ticket) => ticket.status === "open").length;
          if (currentOpenCount <= nextOpenCount) return nextDashboard;
          const ticketsById = new Map(current.tickets.map((ticket) => [ticket.id, ticket]));
          nextDashboard.tickets.forEach((ticket) => ticketsById.set(ticket.id, ticket));
          return {
            ...nextDashboard,
            tickets: Array.from(ticketsById.values()),
            open_pagination: current.open_pagination,
          };
        });
        markDashboardMilestone("admin-dashboard-ready");
        return true;
      } catch {
        setPlatformDashboard(null);
        setPlatformDashboardError(true);
        return true;
      }
    })().finally(() => {
      finishDashboardRequest("admin-dashboard");
      platformDashboardLoadedAtRef.current = Date.now();
      if (loadPlatformDashboardInFlightRef.current === request) {
        loadPlatformDashboardInFlightRef.current = null;
      }
    });
    loadPlatformDashboardInFlightRef.current = request;
    return request;
  }, [status]);

  const loadPlatformDashboardStats = useCallback((): Promise<void> => {
    if (loadPlatformDashboardStatsInFlightRef.current) {
      return loadPlatformDashboardStatsInFlightRef.current;
    }
    const request = (async () => {
      const result = await fetchPlatformDashboardStats();
      if (result._status >= 400 || result.support_stats === undefined) return;
      setPlatformDashboard((current) => current ? {
        ...current,
        support_stats: result.support_stats ?? null,
      } : current);
      platformDashboardStatsLoadedAtRef.current = Date.now();
    })().finally(() => {
      if (loadPlatformDashboardStatsInFlightRef.current === request) {
        loadPlatformDashboardStatsInFlightRef.current = null;
      }
    });
    loadPlatformDashboardStatsInFlightRef.current = request;
    return request;
  }, []);

  const refreshPlatformDashboardIfChanged = useCallback((): Promise<void> => {
    if (loadPlatformDashboardVersionInFlightRef.current) {
      return loadPlatformDashboardVersionInFlightRef.current;
    }
    const request = (async () => {
      try {
        const result = await fetchPlatformDashboardVersion();
        if (result._status >= 400) return;
        const previousVersion = platformDashboardVersionRef.current;
        platformDashboardVersionRef.current = result.version;
        const statsStale = Date.now() - platformDashboardStatsLoadedAtRef.current
          >= ADMIN_DASHBOARD_STATS_POLL_MS;
        if (previousVersion !== null && previousVersion !== result.version) {
          await loadPlatformDashboard(false);
        }
        if (statsStale) await loadPlatformDashboardStats();
      } finally {
        platformDashboardLoadedAtRef.current = Date.now();
      }
    })().finally(() => {
      if (loadPlatformDashboardVersionInFlightRef.current === request) {
        loadPlatformDashboardVersionInFlightRef.current = null;
      }
    });
    loadPlatformDashboardVersionInFlightRef.current = request;
    return request;
  }, [loadPlatformDashboard, loadPlatformDashboardStats]);

  const loadMorePlatformTickets = useCallback(async () => {
    const cursor = platformDashboard?.open_pagination?.next_cursor;
    if (!cursor || loadingMorePlatformTickets) return;
    setLoadingMorePlatformTickets(true);
    try {
      const result = await fetchPlatformDashboard(cursor, { includeStats: false });
      if (result._status >= 400) return;
      setPlatformDashboard((current) => {
        if (!current) return current;
        const ticketsById = new Map(current.tickets.map((ticket) => [ticket.id, ticket]));
        (result.tickets || []).forEach((ticket) => ticketsById.set(ticket.id, ticket));
        const tickets = Array.from(ticketsById.values()).sort((left, right) => {
          if (left.status !== right.status) return left.status === "open" ? -1 : 1;
          const updatedDifference = Date.parse(right.updated_at) - Date.parse(left.updated_at);
          return updatedDifference || right.id.localeCompare(left.id);
        });
        return {
          reportsInbox: result.reportsInbox ?? current.reportsInbox,
          tickets,
          open_pagination: result.open_pagination ?? null,
          support_stats: result.support_stats ?? current.support_stats,
        };
      });
    } finally {
      setLoadingMorePlatformTickets(false);
    }
  }, [loadingMorePlatformTickets, platformDashboard?.open_pagination?.next_cursor]);

  const loadOperationalHealth = useCallback((force = false): Promise<void> => {
    if (loadOperationalHealthInFlightRef.current) return loadOperationalHealthInFlightRef.current;
    if (!force && Date.now() - operationalHealthLoadedAtRef.current < OPERATIONAL_HEALTH_MIN_REFRESH_MS) {
      return Promise.resolve();
    }
    setOperationalHealthLoading(true);
    const request = (async () => {
      try {
        const result = await fetchPlatformOperationalHealth();
        if (result._status >= 400) {
          setOperationalHealthError(true);
          return;
        }
        setOperationalHealth({
          generated_at: result.generated_at,
          status: result.status,
          windows: result.windows,
          routes: result.routes || [],
        });
        operationalHealthLoadedAtRef.current = Date.now();
        setOperationalHealthError(false);
      } catch {
        setOperationalHealthError(true);
      } finally {
        setOperationalHealthLoading(false);
      }
    })().finally(() => {
      if (loadOperationalHealthInFlightRef.current === request) {
        loadOperationalHealthInFlightRef.current = null;
      }
    });
    loadOperationalHealthInFlightRef.current = request;
    return request;
  }, []);

  const loadSupportPreview = useCallback((resolvedRole?: {
    isPlatformAdmin: boolean;
  }): Promise<void> => {
    const effectivePlatformAdmin = resolvedRole?.isPlatformAdmin ?? isPlatformAdmin;
    const effectiveHasResolvedRole = resolvedRole !== undefined || hasResolvedPlatformRole;
    if (
      status === "loading"
      || effectivePlatformAdmin
      || (status === "authenticated" && !effectiveHasResolvedRole)
    ) {
      return Promise.resolve();
    }
    if (loadSupportPreviewInFlightRef.current) return loadSupportPreviewInFlightRef.current;
    const request = (async () => {
      startDashboardRequest("support-preview");
      try {
        const result = await fetchSupportPreview();
        if (result._status >= 400 || !result.thread) {
          clearStoredSupportTicketPreview();
          setSupportPreview(null);
          return;
        }
        const preview = {
          threadId: result.thread.id,
          topicLabel: result.thread.entry_topic_label,
          preview: result.thread.last_message || result.thread.summary,
          updatedAt: result.thread.updated_at,
          unreadForUser: result.thread.unread_for_user,
          waitingOn: result.thread.waiting_on,
          staleLevel: result.thread.stale_level,
        };
        storeSupportTicketPreview(preview);
        setSupportPreview(preview);
        markDashboardMilestone("support-preview-ready");
      } catch {
        setSupportPreview(status === "unauthenticated" ? readStoredSupportTicketPreview() : null);
      }
    })().finally(() => {
      finishDashboardRequest("support-preview");
      supportPreviewLoadedAtRef.current = Date.now();
      if (loadSupportPreviewInFlightRef.current === request) {
        loadSupportPreviewInFlightRef.current = null;
      }
    });
    loadSupportPreviewInFlightRef.current = request;
    return request;
  }, [status, isPlatformAdmin, hasResolvedPlatformRole]);

  const connectLocalChannels = async () => {
    if (!pendingLocalChannels || !session?.user?.id || migratingLocalChannels) return;
    const migrationKey = `letmetellu_recent_channels_migrated_${session.user.id}`;
    setMigratingLocalChannels(true);
    setLocalMigrationError(false);
    try {
      await mergeAccountRecentChannels(pendingLocalChannels);
      const accountChannels = await fetchAccountRecentChannels();
      setRecentChannels(accountChannels);
      storeCachedAccountRecentChannels(session.user.id, accountChannels);
      localStorage.setItem(migrationKey, "merged");
      clearRecentChannels();
      setPendingLocalChannels(null);
    } catch {
      setLocalMigrationError(true);
    } finally {
      setMigratingLocalChannels(false);
    }
  };

  const skipLocalChannelMigration = () => {
    if (!pendingLocalChannels || !session?.user?.id || migratingLocalChannels) return;
    try {
      localStorage.setItem(
        `letmetellu_recent_channels_migrated_${session.user.id}`,
        `skipped:${localMigrationSignature(pendingLocalChannels)}`
      );
    } catch {}
    setLocalMigrationError(false);
    setPendingLocalChannels(null);
  };

  const runDashboardStartup = useEffectEvent((
    startupStatus: typeof status,
    userId: string | undefined,
  ) => {
    if (startupStatus === "authenticated" && userId) {
      void (async () => {
        const cachedRecentChannels = readCachedAccountRecentChannels(userId);
        if (cachedRecentChannels.length > 0) {
          skipNextListAnimationRef.current = true;
          setRecentChannels(cachedRecentChannels);
          markDashboardMilestone("cached-channels-ready");
        }
        const roleResult = await Promise.allSettled([loadChannels()]);
        const isAdmin = roleResult[0].status === "fulfilled" && roleResult[0].value;
        if (isAdmin) {
          const platformDashboardRequest = loadPlatformDashboard();
          await platformDashboardRequest;
          setLoading(false);
          return;
        }
        const recentChannelsRequest = loadAccountRecentChannels(userId, { skipListAnimation: true });
        const supportPreviewRequest = loadSupportPreview({ isPlatformAdmin: false });
        if (cachedRecentChannels.length > 0) {
          setLoading(false);
        }
        await Promise.allSettled([recentChannelsRequest]);
        setLoading(false);
        await Promise.allSettled([supportPreviewRequest]);
        listAnimationsEnabledRef.current = true;
      })();
      return;
    }
    if (startupStatus === "unauthenticated") {
      const localRecentChannelsRequest = loadLocalRecentChannels();
      const supportPreviewRequest = loadSupportPreview();
      void Promise.allSettled([localRecentChannelsRequest, supportPreviewRequest]).finally(() => {
        listAnimationsEnabledRef.current = true;
      });
      setPlatformAdminRole(null);
      setPlatformDashboard(null);
      setLoading(false);
    }
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      runDashboardStartup(status, session?.user?.id);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [status, session?.user?.id]);

  useEffect(() => {
    if (!isPlatformAdmin) {
      operationalHealthLoadedAtRef.current = 0;
    }
  }, [isPlatformAdmin]);

  const refreshForegroundDashboard = useCallback(() => {
    const now = Date.now();
    if (isPlatformAdmin) {
      if (now - platformDashboardLoadedAtRef.current >= ADMIN_DASHBOARD_POLL_MS) {
        void refreshPlatformDashboardIfChanged();
      }
      if (
        operationalHealth
        && operationalHealthExpanded
        && now - operationalHealthLoadedAtRef.current >= OPERATIONAL_HEALTH_POLL_MS
      ) {
        void loadOperationalHealth();
      }
      return;
    }
    if (now - supportPreviewLoadedAtRef.current >= SUPPORT_PREVIEW_POLL_MS) {
      void loadSupportPreview();
    }
  }, [isPlatformAdmin, loadOperationalHealth, loadSupportPreview, operationalHealth, operationalHealthExpanded, refreshPlatformDashboardIfChanged]);

  useForegroundPolling({
    enabled: status !== "loading",
    pollMs: DASHBOARD_REFRESH_TICK_MS,
    runImmediately: false,
    onRefresh: refreshForegroundDashboard,
  });

  useEffect(() => {
    if (status === "loading") return;
    const refresh = () => {
      if (isPlatformAdmin) {
        const includeStats = Date.now() - platformDashboardStatsLoadedAtRef.current
          >= ADMIN_DASHBOARD_STATS_POLL_MS;
        void loadPlatformDashboard(includeStats);
        return;
      }
      void loadSupportPreview();
    };
    window.addEventListener("support-ticket-changed", refresh as EventListener);
    return () => {
      window.removeEventListener("support-ticket-changed", refresh as EventListener);
    };
  }, [status, isPlatformAdmin, loadPlatformDashboard, loadSupportPreview]);

  useEffect(() => {
    if (loading || status !== "unauthenticated" || recentChannels.length > 0) return;
    try {
      if (localStorage.getItem("letmetellu_guest_onboarding_seen") !== "true") {
        setShowGuestOnboarding(true);
      }
    } catch {
      // The dashboard remains usable when storage is unavailable.
    }
  }, [loading, status, recentChannels.length]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (loading || status !== "authenticated" || !userId || isPlatformAdmin) return;
    const storageKey = `yap_beta_notice_v1_${userId}`;
    let shouldShow = true;
    try {
      shouldShow = localStorage.getItem(storageKey) !== "seen";
    } catch {}
    if (!shouldShow) return;
    const timer = window.setTimeout(() => setShowBetaNotice(true), 0);
    return () => window.clearTimeout(timer);
  }, [isPlatformAdmin, loading, session?.user?.id, status]);

  const closeBetaNotice = useCallback(() => {
    const userId = session?.user?.id;
    if (userId) {
      try { localStorage.setItem(`yap_beta_notice_v1_${userId}`, "seen"); } catch {}
    }
    setShowBetaNotice(false);
  }, [session?.user?.id]);

  useEffect(() => {
    if (!showAccount) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
        setShowAccount(false);
      }
    };
    document.addEventListener("click", closeOnOutsideClick);
    return () => document.removeEventListener("click", closeOnOutsideClick);
  }, [showAccount]);

  useEffect(() => {
    setLinkedChannel(null);
    if (!linkedChannelId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/channels/exists?ids=${encodeURIComponent(linkedChannelId)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((response) => response.ok ? response.json() : null)
        .then((data: { channels?: Channel[] } | null) => {
          const match = data?.channels?.find((channel) => channel.id === linkedChannelId);
          if (match) {
            setLinkedChannel({
              ...match,
              profile_image: decorateMediaUrl(match.profile_image),
            });
          }
        })
        .catch(() => {});
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [linkedChannelId]);

  const activeItems = useMemo<DashboardListItem[]>(() => {
    const normalized = query.trim().toLowerCase();
    const fetchedOwnedIds = new Set(channels.map((channel) => channel.id));
    const personalColors = new Map(recentChannels.map((channel) => [channel.id, channel.bubbleColor]));
    const previewColor = (channelId: string, fallback: string) =>
      status === "authenticated"
        ? personalColors.get(channelId) || fallback
        : getChannelPreviewColor(channelId, fallback);
    const ownedItems: DashboardListItem[] = channels
      .map((channel) => ({
          group: "owned" as const,
          kind: "channel" as const,
          route: `/ch/${channel.id}`,
          id: channel.id,
          name: channel.name,
          profileImage: channel.profile_image,
          bubbleColor: previewColor(channel.id, channel.bubble_color || "#3598fe"),
          hasPasscode: channel.has_passcode === 1,
          ownerName: channel.owner_name || "",
          meta: `/ch/${channel.id}`,
          time: formatRelativeTime(
            parseServerDate(channel.last_message_at || channel.created_at)?.getTime() || Date.now(),
            locale,
          ),
          owned: true,
          pinned: channel.id === prioritizedOwnedId,
          activityAt: channel.last_message_at || channel.created_at,
          liveActive: channel.live_active === 1,
        }))
      .sort((left, right) =>
        Number(right.id === prioritizedOwnedId) - Number(left.id === prioritizedOwnedId)
        || (parseServerDate(right.activityAt)?.getTime() || 0) - (parseServerDate(left.activityAt)?.getTime() || 0)
      );
    const fallbackOwnedItems: DashboardListItem[] = recentChannels
      .filter((channel) => ownedChannelIds.has(channel.id) && !fetchedOwnedIds.has(channel.id))
      .map((channel) => ({
        group: "owned" as const,
        kind: "channel" as const,
        route: `/ch/${channel.id}`,
        id: channel.id,
        name: channel.name,
        profileImage: channel.profileImage,
        bubbleColor: channel.bubbleColor || "#3598fe",
        hasPasscode: channel.hasPasscode,
        ownerName: channel.ownerName,
        meta: `/ch/${channel.id}`,
        time: formatRelativeTime(channel.lastVisitedAt, locale),
        owned: true,
        pinned: channel.id === prioritizedOwnedId,
        activityAt: new Date(channel.lastVisitedAt).toISOString(),
        liveActive: false,
      }))
      .sort((left, right) => Number(right.id === prioritizedOwnedId) - Number(left.id === prioritizedOwnedId));
    const recentItems: DashboardListItem[] = recentChannels
      .filter((channel) => !ownedChannelIds.has(channel.id))
      .map((channel) => ({
          group: "joined" as const,
          kind: "channel" as const,
          route: `/ch/${channel.id}`,
          id: channel.id,
          name: channel.name,
          profileImage: channel.profileImage,
          bubbleColor: previewColor(channel.id, channel.bubbleColor || "#3598fe"),
          hasPasscode: channel.hasPasscode,
          ownerName: channel.ownerName,
          meta: `/ch/${channel.id}`,
          time: formatRelativeTime(channel.lastVisitedAt, locale),
          owned: false,
          pinned: channel.pinned,
          activityAt: new Date(channel.lastVisitedAt).toISOString(),
          liveActive: false,
        }))
      .sort((left, right) => Number(right.pinned) - Number(left.pinned));
    const items: DashboardListItem[] = isPlatformAdmin
      ? []
      : [...ownedItems, ...fallbackOwnedItems, ...recentItems];
    if (!isPlatformAdmin && linkedChannel && !items.some((item) => item.id === linkedChannel.id)) {
      items.push({
        group: "search-result",
        kind: "channel",
        route: `/ch/${linkedChannel.id}`,
        id: linkedChannel.id,
        name: linkedChannel.name,
        profileImage: linkedChannel.profile_image,
        bubbleColor: previewColor(linkedChannel.id, linkedChannel.bubble_color || "#3598fe"),
        hasPasscode: linkedChannel.has_passcode === 1,
        ownerName: linkedChannel.owner_name || "",
        meta: `/ch/${linkedChannel.id}`,
        time: "",
        owned: false,
        pinned: false,
        activityAt: linkedChannel.created_at,
        liveActive: false,
      });
    }
    const platformItems: DashboardListItem[] = [];
    if (platformDashboard?.reportsInbox) {
      platformItems.push({
        id: `reports-${platformDashboard.reportsInbox.channel_id}`,
        group: "reports",
        kind: "channel",
        route: `/ch/${platformDashboard.reportsInbox.channel_id}`,
        name: platformDashboard.reportsInbox.name || t("dashboardReportsInboxTitle"),
        profileImage: decorateMediaUrl(platformDashboard.reportsInbox.profile_image),
        bubbleColor: platformDashboard.reportsInbox.bubble_color || "#111827",
        hasPasscode: false,
        ownerName: "",
        meta: platformDashboard.reportsInbox.open_report_count > 0
          ? t("dashboardReportsCount").replace("{count}", String(platformDashboard.reportsInbox.open_report_count))
          : t("dashboardReportsEmpty"),
        time: formatRelativeTime(
          parseServerDate(platformDashboard.reportsInbox.oldest_report_at || platformDashboard.reportsInbox.created_at)?.getTime() || Date.now(),
          locale,
        ),
        owned: false,
        pinned: false,
        activityAt: platformDashboard.reportsInbox.oldest_report_at || platformDashboard.reportsInbox.created_at,
        liveActive: false,
      });
    }
    if (platformDashboard?.tickets?.length) {
      const filteredTickets = platformDashboard.tickets.filter((ticket) => {
        if (!platformTicketFilter) return true;
        if (platformTicketFilter === "open") return ticket.status === "open";
        if (platformTicketFilter === "needs_reply") return ticket.waiting_on === "platform_admin";
        if (platformTicketFilter === "waiting_user") return ticket.waiting_on === "user";
        if (platformTicketFilter === "unread") return ticket.unread_for_admin;
        if (platformTicketFilter === "stale") return ticket.stale_level !== "none";
        if (platformTicketFilter === "critical") return ticket.stale_level === "critical";
        return true;
      });
      const ticketItems = filteredTickets.map((ticket) => {
        const supportVisual = getSupportTopicVisual(ticket.entry_topic);
        return ({
        id: `ticket-${ticket.id}`,
        group: "tickets" as const,
        kind: "support" as const,
        supportThreadId: ticket.id,
        supportTopic: ticket.entry_topic,
        supportIcon: supportVisual.icon,
        supportIconBg: supportVisual.background,
        supportIconColor: supportVisual.color,
        supportUnread: ticket.unread_for_admin,
        supportWaitingOn: ticket.waiting_on,
        supportActorType: ticket.actor_type,
        supportStaleLevel: ticket.stale_level,
        route: `/support?thread=${encodeURIComponent(ticket.id)}&admin=1`,
        name: ticket.entry_topic_label,
        profileImage: null,
        bubbleColor: ticket.status === "open" ? "#111827" : "#6b7280",
        hasPasscode: false,
        ownerName: "",
        meta: ticket.last_message || ticket.summary,
        time: formatRelativeTime(
          parseServerDate(ticket.updated_at)?.getTime() || Date.now(),
          locale,
        ),
        owned: false,
        pinned: ticket.status === "open",
        activityAt: ticket.updated_at,
        liveActive: false,
      });
      });
      platformItems.push(...ticketItems);
    }
    if (platformItems.length > 0) {
      items.unshift(...platformItems);
    }
    if (!isPlatformAdmin && supportPreview && !platformDashboard) {
      const supportItem: DashboardListItem = {
        id: `support-${supportPreview.threadId}`,
        group: "support-preview",
        kind: "support",
        supportThreadId: supportPreview.threadId,
        supportUnread: supportPreview.unreadForUser,
        supportWaitingOn: supportPreview.waitingOn,
        supportStaleLevel: supportPreview.staleLevel,
        route: `/support?thread=${encodeURIComponent(supportPreview.threadId)}`,
        name: t("supportMenu"),
        profileImage: "/logo.svg",
        bubbleColor: "#111827",
        hasPasscode: false,
        ownerName: supportPreview.topicLabel,
        meta: supportPreview.preview,
        time: formatRelativeTime(
          parseServerDate(supportPreview.updatedAt)?.getTime() || Date.now(),
          locale,
        ),
        owned: false,
        pinned: true,
        activityAt: supportPreview.updatedAt,
        liveActive: false,
      };
      items.unshift(supportItem);
    }
    if (linkedChannelId) return items.filter((item) => item.id === linkedChannelId);
    if (!normalized) return items;
    return items.filter((item) =>
      item.name.toLowerCase().includes(normalized)
      || item.id.toLowerCase().includes(normalized)
      || item.meta.toLowerCase().includes(normalized)
      || item.ownerName.toLowerCase().includes(normalized)
    );
  }, [channels, recentChannels, query, locale, prioritizedOwnedId, linkedChannel, linkedChannelId, status, ownedChannelIds, platformDashboard, platformTicketFilter, supportPreview, t, isPlatformAdmin]);

  useLayoutEffect(() => {
    const nextPositions = new Map<string, number>();
    const activeIds = new Set(channelItemRefs.current.keys());
    rowAnimationsRef.current.forEach((animation, id) => {
      if (!activeIds.has(id)) {
        animation.cancel();
        rowAnimationsRef.current.delete(id);
      }
    });
    const skipAnimation = skipNextListAnimationRef.current || isPlatformAdmin || !listAnimationsEnabledRef.current;
    channelItemRefs.current.forEach((element, id) => {
      const runningAnimation = rowAnimationsRef.current.get(id);
      if (runningAnimation) {
        runningAnimation.cancel();
        rowAnimationsRef.current.delete(id);
      }
      const nextTop = element.getBoundingClientRect().top + window.scrollY;
      nextPositions.set(id, nextTop);
      if (skipAnimation) return;
      const previousTop = previousItemPositionsRef.current.get(id);
      if (previousTop === undefined || previousTop === nextTop) return;
      const animation = element.animate(
        [
          { transform: `translateY(${previousTop - nextTop}px)` },
          { transform: "translateY(0)" },
        ],
        {
          duration: 320,
          easing: "cubic-bezier(.22,.8,.36,1)",
        },
      );
      rowAnimationsRef.current.set(id, animation);
      const clearAnimation = () => {
        if (rowAnimationsRef.current.get(id) === animation) {
          rowAnimationsRef.current.delete(id);
        }
      };
      animation.addEventListener("finish", clearAnimation, { once: true });
      animation.addEventListener("cancel", clearAnimation, { once: true });
    });
    previousItemPositionsRef.current = nextPositions;
    skipNextListAnimationRef.current = false;
  }, [activeItems, isPlatformAdmin]);

  const handleCreate = async () => {
    const slug = newSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    const name = newName.trim();
    setCreateError("");
    if (!slug || !name) return setCreateError(t("allFieldsRequired"));
    if (!/^[a-z0-9-]{3,30}$/.test(slug)) return setCreateError(t("onboardingSlugHint"));
    setCreating(true);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-channel", channel_id: slug, payload: { name } }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok || data.error) {
        if (data.error === "beta channel limit reached") {
          setShowCreate(false);
          setShowBetaCapacityNotice(true);
          return;
        }
        setCreateError(
          data.error === "channel already exists"
            ? t("channelExists")
            : data.error === "channel limit reached"
              ? t("dashboardChannelLimit")
              : t("dashboardCreateFailed")
        );
        return;
      }
      clearChannelLocalState(slug);
      await loadChannels();
      setNewSlug("");
      setNewName("");
      setShowCreate(false);
    } catch {
      setCreateError(t("dashboardCreateFailed"));
    } finally {
      setCreating(false);
    }
  };

  const openCreateFlow = useCallback(async () => {
    if (checkingChannelCapacity) return;
    setCreateError("");
    setCheckingChannelCapacity(true);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "channel-capacity", channel_id: "" }),
      });
      const data = await response.json() as { can_create?: boolean };
      if (response.ok && data.can_create === false) {
        setShowBetaCapacityNotice(true);
        return;
      }
    } catch {
      // The create endpoint also enforces the limit. A transient check failure
      // should not block creation while beta capacity is still available.
    } finally {
      setCheckingChannelCapacity(false);
    }
    setShowCreate(ownedChannelIds.size > 0);
    setShowFirstOnboarding(ownedChannelIds.size === 0);
  }, [checkingChannelCapacity, ownedChannelIds]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("error");
    const callbackUrl = params.get("callbackUrl");
    const callbackPath = callbackUrl ? decodeURIComponent(callbackUrl) : "";
    let storedAuthFlow: "login" | "signup" | null = null;
    try {
      const value = sessionStorage.getItem("letmetellu_auth_flow");
      if (value === "login" || value === "signup") storedAuthFlow = value;
    } catch {}
    const signupFlow = storedAuthFlow === "signup"
      || authError === "oauth_signup"
      || authError === "oauth_signup_exists"
      || params.get("onboarding") === "true"
      || callbackPath.includes("onboarding=true");
    const authEntry = params.get("login") === "true" || authError || params.has("callbackUrl");
    const shouldOpenLogin = authEntry && status === "unauthenticated";
    if (shouldOpenLogin) {
      setShowGuestOnboarding(false);
      setLoginInitialTab(signupFlow ? "signup" : "login");
      setLoginError(
        authError
          ? t(
            authError === "oauth_signup_exists"
              ? "oauthSignupExistsError"
              : signupFlow
                ? "signupError"
                : "oauthLoginError"
          )
          : ""
      );
      setShowLogin(true);
    }
    if (shouldOpenLogin || status === "authenticated") {
      try { sessionStorage.removeItem("letmetellu_auth_flow"); } catch {}
    }
  }, [status, t]);

  useEffect(() => {
    if (loading || status !== "authenticated") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("onboarding") !== "true") return;
    void openCreateFlow();
    window.history.replaceState(null, "", "/dashboard");
  }, [loading, openCreateFlow, status]);

  const closeLogin = () => {
    setShowLogin(false);
    setLoginError("");
    setLoginInitialTab("login");
    try { sessionStorage.removeItem("letmetellu_auth_flow"); } catch {}
    if (window.location.search) window.history.replaceState(null, "", "/dashboard");
  };

  const closeGuestOnboarding = () => {
    try { localStorage.setItem("letmetellu_guest_onboarding_seen", "true"); } catch {}
    setShowGuestOnboarding(false);
  };

  const deleteAccount = async () => {
    if (deletingAccount || !session?.user?.id) return;
    setDeletingAccount(true);
    try {
      const response = await fetch("/api/user", { method: "DELETE" });
      if (!response.ok) throw new Error("account deletion failed");
    } catch {
      setShowDeleteAccountConfirm(false);
      setShowDeleteAccountError(true);
      setDeletingAccount(false);
      return;
    }
    ownedChannelIds.forEach(clearChannelLocalState);
    clearRecentChannels();
    try {
      localStorage.removeItem(`letmetellu_recent_channels_migrated_${session.user.id}`);
      localStorage.removeItem("letmetellu_prioritized_owned_channel");
    } catch {}
    await signOut({ callbackUrl: "/dashboard" }).catch(() => {
      window.location.href = "/dashboard";
    });
  };

  const removeRecent = (channelId: string) => {
    setRecentChannels((current) => current.filter((channel) => channel.id !== channelId));
    if (status === "authenticated") {
      void removeAccountRecentChannel(channelId);
    } else {
      removeRecentChannel(channelId);
      setRecentChannels(getRecentChannels());
    }
  };

  const togglePinned = (channelId: string) => {
    const nextPinned = !recentChannels.find((channel) => channel.id === channelId)?.pinned;
    setRecentChannels((current) => current.map((channel) =>
      channel.id === channelId ? { ...channel, pinned: nextPinned } : channel
    ));
    if (status === "authenticated") {
      void setAccountRecentChannelPinned(channelId, nextPinned);
    } else {
      toggleRecentChannelPinned(channelId);
      setRecentChannels(getRecentChannels());
    }
    setSwipe({ id: null, offset: 0 });
  };

  const toggleOwnedPinned = (channelId: string) => {
    const nextPinnedId = prioritizedOwnedId === channelId ? null : channelId;
    setPrioritizedOwnedId(nextPinnedId);
    try {
      if (nextPinnedId) localStorage.setItem("letmetellu_prioritized_owned_channel", nextPinnedId);
      else localStorage.removeItem("letmetellu_prioritized_owned_channel");
    } catch {}
    setSwipe({ id: null, offset: 0 });
  };

  const deleteOwnedChannel = async (channelId: string) => {
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete-channel", channel_id: channelId }),
    });
    if (!response.ok) throw new Error("delete failed");
    clearChannelLocalState(channelId);
    if (status === "authenticated") {
      await removeAccountRecentChannel(channelId).catch(() => {});
    } else {
      removeRecentChannel(channelId);
    }
  };

  const performDeleteSelected = async (channelIds: string[]) => {
    const ownedIds = channelIds.filter((id) => ownedChannelIds.has(id));
    setDeleting(true);
    try {
      await Promise.all(ownedIds.map(deleteOwnedChannel));
      const recentIds = channelIds.filter((id) => !ownedIds.includes(id));
      if (status === "authenticated") {
        await Promise.all(recentIds.map((id) => removeAccountRecentChannel(id)));
      } else {
        recentIds.forEach(removeRecentChannel);
      }
      if (ownedIds.length > 0) {
        await loadChannels();
      }
      if (status === "authenticated" && session?.user?.id) {
        await loadAccountRecentChannels(session.user.id);
      } else {
        setRecentChannels(getRecentChannels());
      }
      setSelectedIds(new Set());
      setEditing(false);
    } catch {
      setDeleteError({
        title: t("dashboardDeleteChannel"),
        message: t("dashboardDeleteFailed"),
      });
    } finally {
      setDeleting(false);
    }
  };

  const deleteSelected = () => {
    if (!selectedIds.size || deleting) return;
    const channelIds = [...selectedIds];
    const includesOwned = channelIds.some((id) => ownedChannelIds.has(id));
    if (includesOwned) {
      setPendingDelete({ kind: "selected", channelIds });
    } else {
      void performDeleteSelected(channelIds);
    }
  };

  const performDeleteSingleOwned = async (channelId: string) => {
    setDeleting(true);
    try {
      await deleteOwnedChannel(channelId);
      await loadChannels();
      if (status === "authenticated" && session?.user?.id) {
        await loadAccountRecentChannels(session.user.id);
      } else {
        setRecentChannels(getRecentChannels());
      }
      setSwipe({ id: null, offset: 0 });
    } catch {
      setDeleteError({
        title: t("dashboardDeleteChannel"),
        message: t("dashboardDeleteFailed"),
      });
    } finally {
      setDeleting(false);
    }
  };

  const performDeleteSupportThread = async (threadId: string) => {
    setDeleting(true);
    try {
      const result = await closeSupportThread(threadId);
      if (result._status >= 400 && result.error !== "thread_not_found") {
        throw new Error("close support thread failed");
      }
      clearStoredSupportTicketPreview();
      setSupportPreview(null);
      setSwipe({ id: null, offset: 0 });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("support-ticket-changed"));
      }
    } catch {
      setDeleteError({
        title: t("supportDeleteTicket"),
        message: t("supportDeleteFailed"),
      });
    } finally {
      setDeleting(false);
    }
  };

  const clearChannelLongPress = () => {
    if (!channelLongPressTimerRef.current) return;
    clearTimeout(channelLongPressTimerRef.current);
    channelLongPressTimerRef.current = null;
  };

  const copyChannelLink = async (channelId: string) => {
    const link = `${window.location.host}/ch/${channelId}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const input = document.createElement("textarea");
      input.value = link;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopiedChannelId(channelId);
    if (copiedResetTimerRef.current) clearTimeout(copiedResetTimerRef.current);
    copiedResetTimerRef.current = setTimeout(() => setCopiedChannelId(null), 1600);
  };

  const startSwipe = (event: ReactPointerEvent<HTMLDivElement>, channelId: string, width: number, allowLongPressCopy: boolean) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    swipeStartRef.current = {
      id: channelId,
      x: event.clientX,
      y: event.clientY,
      startOffset: swipe.id === channelId ? swipe.offset : 0,
      moved: false,
      width,
    };
    setDraggingId(channelId);
    if (swipe.id !== channelId) setSwipe({ id: channelId, offset: 0 });
    clearChannelLongPress();
    if (!allowLongPressCopy) return;
    channelLongPressTimerRef.current = setTimeout(() => {
      const start = swipeStartRef.current;
      if (!start || start.id !== channelId || start.moved) return;
      start.moved = true;
      suppressClickRef.current = channelId;
      if (navigator.vibrate) navigator.vibrate(20);
      void copyChannelLink(channelId);
    }, 550);
  };

  const moveSwipe = (event: ReactPointerEvent<HTMLDivElement>, channelId: string) => {
    const start = swipeStartRef.current;
    if (!start || start.id !== channelId) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) >= 8 || Math.abs(deltaY) >= 8) clearChannelLongPress();
    if (!start.moved && Math.abs(deltaX) < 8) return;
    if (!start.moved && Math.abs(deltaY) > Math.abs(deltaX)) return;
    start.moved = true;
    const offset = Math.max(-start.width, Math.min(0, start.startOffset + deltaX));
    setSwipe({ id: channelId, offset });
  };

  const finishSwipe = (channelId: string) => {
    clearChannelLongPress();
    const start = swipeStartRef.current;
    if (!start || start.id !== channelId) return;
    if (start.moved) suppressClickRef.current = channelId;
    setSwipe((current) => ({
      id: current.id,
      offset: current.id === channelId && current.offset < -(start.width / 2) ? -start.width : 0,
    }));
    swipeStartRef.current = null;
    setDraggingId(null);
  };

  if (status === "loading" || loading) {
    return <DashboardLoadingSkeleton label={t("loading")} />;
  }

  const isLoggedIn = !!session;
  const empty = activeItems.length === 0;
  const dashboardMinHeight = viewportHeight ? `${viewportHeight}px` : "100dvh";
  const listBottomPadding = isLoggedIn && !editing ? "6rem" : "0px";

  return (
    <main className="dashboard-font-scaled min-h-dvh" style={{ background: "var(--bg)", color: "var(--gray-text)" }}>
      <div className="max-w-[480px] mx-auto min-h-dvh md:border-x flex flex-col" style={{ borderColor: "var(--hairline)", minHeight: dashboardMinHeight }}>
        <header className="sticky top-0 z-30 backdrop-blur-xl" style={{ background: "var(--header-bg)" }}>
          <div className="h-[64px] px-4 flex items-center justify-between">
            {activeItems.length > 0 && !isPlatformAdmin ? (
              <button
                type="button"
                className="border-none bg-transparent cursor-pointer text-[17px] min-w-[72px] text-left"
                style={{ color: "#007aff" }}
                onClick={() => {
                  setEditing((value) => !value);
                  setSelectedIds(new Set());
                  setSwipe({ id: null, offset: 0 });
                }}
              >
                {editing ? t("dashboardDone") : t("dashboardEdit")}
              </button>
            ) : (
              <span className="min-w-[72px]" />
            )}
            <h1 className="m-0 inline-flex items-center text-[17px] font-semibold tracking-[-.02em]">
              <ThemeLogo alt="" width={48} height={48} className="h-12 w-12" />
            </h1>
            <div ref={accountMenuRef} className="min-w-[72px] flex items-center justify-end gap-3 relative">
              <button
                type="button"
                className="w-6 h-8 p-0 border-none bg-transparent cursor-pointer flex items-center justify-center"
                style={{ color: "#007aff" }}
                onClick={() => setShowAccount((value) => !value)}
                aria-label={t("dashboardAccount")}
              >
                <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="10.5" />
                  <circle cx="8" cy="12" r="1" fill="currentColor" stroke="none" />
                  <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
                  <circle cx="16" cy="12" r="1" fill="currentColor" stroke="none" />
                </svg>
              </button>
              {showAccount && (
                  <div
                    className="absolute right-0 top-[42px] z-20 min-w-[180px] overflow-hidden rounded-[12px] text-left"
                    style={{
                      background: "var(--header-bg)",
                      boxShadow: "0 4px 20px rgba(0,0,0,.15)",
                      backdropFilter: "saturate(180%) blur(20px)",
                      WebkitBackdropFilter: "saturate(180%) blur(20px)",
                    }}
                  >
                    {isLoggedIn ? (
                      <>
                        <div className="px-4 py-3 text-[12px] truncate" style={{ color: "var(--meta)", borderBottom: "0.5px solid var(--hairline)" }}>{session.user?.email}</div>
                        <button
                          className="w-full border-none cursor-pointer text-left px-4 py-3 text-[14px]"
                          style={{
                            background: "transparent",
                            color: "var(--tint)",
                            borderBottom: !isPlatformAdmin ? "0.5px solid var(--hairline)" : "none",
                          }}
                          onClick={() => signOut({ callbackUrl: "/dashboard" })}
                        >
                          {t("logout")}
                        </button>
                        {!isPlatformAdmin && (
                          <button className="w-full border-none cursor-pointer text-left px-4 py-3 text-[14px]" style={{ background: "transparent", color: "#ff453a", borderBottom: "0.5px solid var(--hairline)" }} onClick={() => { setShowAccount(false); setShowDeleteAccountConfirm(true); }}>{t("deleteAccount")}</button>
                        )}
                      </>
                    ) : (
                      <>
                        <button className="w-full border-none cursor-pointer text-left px-4 py-3 text-[14px]" style={{ background: "transparent", color: "var(--tint)", borderBottom: "0.5px solid var(--hairline)" }} onClick={() => { setShowAccount(false); setShowGuestOnboarding(false); setLoginError(""); setLoginInitialTab("login"); try { sessionStorage.removeItem("letmetellu_auth_flow"); } catch {} setShowLogin(true); }}>{t("loginTab")}</button>
                      </>
                    )}
                    <div className="px-3 py-3">
                      <div className="px-1 pb-2 text-[12px]" style={{ color: "var(--meta)" }}>{t("language")}</div>
                      <div className="relative flex rounded-[8px] p-[2px]" style={{ background: "var(--gray-bubble)" }}>
                        <span
                          className="pointer-events-none absolute top-[2px] bottom-[2px] left-[2px] rounded-[6px]"
                          style={{
                            width: "calc(50% - 2px)",
                            background: "var(--input-bg)",
                            boxShadow: "0 1px 3px rgba(0,0,0,.12)",
                            transform: locale === "en" ? "translateX(100%)" : "translateX(0)",
                            transition: "transform 240ms cubic-bezier(.22,.8,.36,1)",
                          }}
                          aria-hidden="true"
                        />
                        {(["ko", "en"] as const).map((option) => (
                          <button
                            key={option}
                            type="button"
                            aria-pressed={locale === option}
                            className="relative z-10 flex-1 border-none rounded-[6px] py-1.5 text-[12px] cursor-pointer"
                            style={{
                              background: "transparent",
                              color: locale === option ? "var(--gray-text)" : "var(--secondary-text)",
                              transition: "color 180ms ease",
                            }}
                            onClick={() => setLocale(option)}
                          >
                            {option === "ko" ? "한국어" : "English"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
              )}
            </div>
          </div>

          <div className="px-4 pb-3">
            <div className="relative">
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" fill="none" stroke="var(--icon)" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSubmittedLinkedChannelId(null);
                }}
                onPaste={(event) => {
                  const pastedText = event.clipboardData.getData("text");
                  const start = event.currentTarget.selectionStart ?? query.length;
                  const end = event.currentTarget.selectionEnd ?? query.length;
                  const nextValue = `${query.slice(0, start)}${pastedText}${query.slice(end)}`;
                  if (!submitLinkedChannelSearch(nextValue)) return;
                  event.preventDefault();
                  setQuery(nextValue);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  if (!submitLinkedChannelSearch(query)) return;
                  event.preventDefault();
                }}
                onBlur={(event) => {
                  submitLinkedChannelSearch(event.currentTarget.value);
                }}
                placeholder={t("dashboardSearch")}
                className="w-full h-10 border-none rounded-[12px] outline-none text-[17px] text-left"
                style={{ background: "var(--input-bg)", padding: "0 36px 0 42px", boxSizing: "border-box", color: "var(--gray-text)" }}
              />
              {hasSearchQuery && (
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 rounded-full"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--meta)", lineHeight: 1 }}
                  onClick={() => { setQuery(""); setSubmittedLinkedChannelId(null); }}
                  aria-label="Clear"
                >
                  <CloseIcon />
                </button>
              )}
            </div>
            {hasSearchQuery && (
              <p
                className="mt-1.5 mb-0 px-1 text-[11px] leading-[1.35]"
                style={{ color: "var(--meta)" }}
                aria-live="polite"
              >
                {isAddressQuery
                  ? linkedChannelId ? t("dashboardAddressMatchedHint") : t("dashboardAddressSearchHint")
                  : t("dashboardJoinedSearchHint")}
              </p>
            )}
          </div>

          {editing && (
            <div className="px-4 py-3 flex items-center justify-between border-t" style={{ background: "var(--header-bg)", borderColor: "var(--hairline)" }}>
              <span className="text-[14px]" style={{ color: "var(--meta)" }}>{t("dashboardSelected").replace("{count}", String(selectedIds.size))}</span>
              <button
                type="button"
                disabled={!selectedIds.size || deleting}
                className="border-none bg-transparent text-[15px] font-medium"
                style={{ color: selectedIds.size ? "#ff3b30" : "#c7c7cc", cursor: selectedIds.size && !deleting ? "pointer" : "default" }}
                onClick={deleteSelected}
              >
                {deleting ? t("loading") : t("delete")}
              </button>
            </div>
          )}
        </header>

        {isPlatformAdmin && (
          <PlatformOperationalHealthCard
            health={operationalHealth}
            loading={operationalHealthLoading}
            error={operationalHealthError}
            onRefresh={() => void loadOperationalHealth(true)}
            onExpandedChange={setOperationalHealthExpanded}
          />
        )}

        {isPlatformAdmin && platformDashboard?.support_stats && (
          <section className="px-4 pt-3 pb-1">
            <div className="rounded-[16px] p-3 flex flex-wrap gap-2" style={{ background: "var(--card)" }}>
              <button
                type="button"
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold border-none cursor-pointer"
                style={{ background: platformTicketFilter === "open" ? "#111827" : "var(--bg)", color: platformTicketFilter === "open" ? "#fff" : "var(--gray-text)" }}
                onClick={() => togglePlatformTicketFilter("open")}
              >
                {t("supportStatsOpen").replace("{count}", String(platformDashboard.support_stats.open_count))}
              </button>
              <button
                type="button"
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold border-none cursor-pointer"
                style={{ background: platformTicketFilter === "needs_reply" ? "#c2410c" : "#fff7ed", color: platformTicketFilter === "needs_reply" ? "#fff" : "#c2410c" }}
                onClick={() => togglePlatformTicketFilter("needs_reply")}
              >
                {t("supportStatsNeedsReply").replace("{count}", String(platformDashboard.support_stats.waiting_for_admin_count))}
              </button>
              <button
                type="button"
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold border-none cursor-pointer"
                style={{ background: platformTicketFilter === "waiting_user" ? "#3730a3" : "#eef2ff", color: platformTicketFilter === "waiting_user" ? "#fff" : "#3730a3" }}
                onClick={() => togglePlatformTicketFilter("waiting_user")}
              >
                {t("supportStatsWaitingUser").replace("{count}", String(platformDashboard.support_stats.waiting_for_user_count))}
              </button>
              <button
                type="button"
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold border-none cursor-pointer"
                style={{ background: platformTicketFilter === "unread" ? "#1d4ed8" : "#eff6ff", color: platformTicketFilter === "unread" ? "#fff" : "#1d4ed8" }}
                onClick={() => togglePlatformTicketFilter("unread")}
              >
                {t("supportStatsUnread").replace("{count}", String(platformDashboard.support_stats.unread_for_admin_count))}
              </button>
              <button
                type="button"
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold border-none cursor-pointer"
                style={{ background: platformTicketFilter === "stale" ? "#be123c" : "#fff1f2", color: platformTicketFilter === "stale" ? "#fff" : "#be123c" }}
                onClick={() => togglePlatformTicketFilter("stale")}
              >
                {t("supportStatsStale").replace("{count}", String(platformDashboard.support_stats.stale_24h_count))}
              </button>
              <button
                type="button"
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold border-none cursor-pointer"
                style={{ background: platformTicketFilter === "critical" ? "#b91c1c" : "#fef2f2", color: platformTicketFilter === "critical" ? "#fff" : "#b91c1c" }}
                onClick={() => togglePlatformTicketFilter("critical")}
              >
                {t("supportStatsCritical").replace("{count}", String(platformDashboard.support_stats.stale_72h_count))}
              </button>
              {platformDashboard.support_stats.oldest_open_duration_minutes > 0 && (
                <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: "var(--bg)", color: "var(--meta)" }}>
                  {t("supportStatsOldest").replace("{duration}", formatDurationMinutes(platformDashboard.support_stats.oldest_open_duration_minutes, locale))}
                </span>
              )}
            </div>
          </section>
        )}

        {platformDashboardError ? (
          <section className="px-8 py-24 text-center">
            <h2 className="m-0 text-[19px] font-semibold">{t("dashboardPlatformLoadFailed")}</h2>
            <p className="mt-2 mb-5 text-[14px] leading-[1.5]" style={{ color: "var(--meta)" }}>
              {t("dashboardPlatformLoadFailedDesc")}
            </p>
            <button
              type="button"
              className="border-none bg-transparent cursor-pointer text-[15px] font-medium"
              style={{ color: "#007aff" }}
              onClick={() => void loadPlatformDashboard()}
            >
              {t("dashboardRetry")}
            </button>
          </section>
        ) : empty ? (
          <section className="px-8 py-24 text-center" style={{ paddingBottom: `calc(6rem + ${listBottomPadding})` }}>
            <div className="mx-auto mb-4 flex items-center justify-center">
              <ThemeLogo alt="" width={72} height={72} className="h-[72px] w-[72px]" />
            </div>
            <h2 className="m-0 text-[19px] font-semibold">
              {query
                ? t("dashboardNoSearchResults")
                : isPlatformAdmin
                  ? t("dashboardPlatformEmptyTitle")
                  : t("dashboardNoRecent")}
            </h2>
            {!query && (
              <p className="mt-2 mb-5 text-[14px] leading-[1.5]" style={{ color: "var(--meta)" }}>
                {isPlatformAdmin
                  ? t("dashboardPlatformEmptyDesc")
                  : isLoggedIn
                    ? t("dashboardEmptyDesc")
                    : t("dashboardRecentDesc")}
              </p>
            )}
            {!query && isLoggedIn && !isPlatformAdmin && <button className="border-none bg-transparent cursor-pointer text-[15px] font-medium" style={{ color: "#007aff" }} onClick={openCreateFlow}>{t("dashboardFirstChannel")}</button>}
          </section>
        ) : (
          <section style={{ paddingBottom: listBottomPadding }}>
            {activeItems.map((item, index) => {
              const previousItem = activeItems[index - 1];
              const showSectionLabel = (() => {
                if (index > 0 && previousItem?.group === item.group) return false;
                if (item.group === "reports" || item.group === "tickets") return true;
                if (item.group === "support-preview" || item.group === "search-result") return false;
                if (platformDashboard) return false;
                return isLoggedIn && ownedChannelIds.size > 0;
              })();
              const canEditItem = item.kind === "channel" && (item.group === "owned" || item.group === "joined");
              const canDeleteSupportItem = item.group === "support-preview" && !!item.supportThreadId;
              const canSwipeItem = !editing && (canEditItem || canDeleteSupportItem);
              const canCopyItem = canEditItem;
              const swipeActionWidth = canEditItem ? 152 : canDeleteSupportItem ? 76 : 0;
              return (
              <div
                key={item.id}
                ref={(element) => {
                  if (element) channelItemRefs.current.set(item.id, element);
                  else channelItemRefs.current.delete(item.id);
                }}
              >
                {showSectionLabel && (
                  <div
                    className={`${index === 0 ? "pt-3" : "pt-5"} px-4 pb-1.5 text-[12px] font-semibold`}
                    style={{ color: "var(--meta)", background: "var(--bg)" }}
                  >
                    {item.group === "reports"
                      ? t("dashboardReportsSection")
                      : item.group === "tickets"
                        ? t("dashboardTicketsSection")
                        : item.owned
                          ? t("dashboardOwnedTab")
                          : t("dashboardJoinedChannels")}
                  </div>
                )}
                <div className="relative min-h-[74px] overflow-hidden">
                {canEditItem && (
                  <>
                    <button
                      type="button"
                      className="absolute inset-y-0 right-[76px] w-[76px] border-none cursor-pointer text-[13px] font-medium text-white"
                      style={{ background: "#8e8e93" }}
                      onClick={() => item.owned ? toggleOwnedPinned(item.id) : togglePinned(item.id)}
                    >
                      {item.pinned ? t("dashboardUnpin") : t("dashboardPin")}
                    </button>
                  </>
                )}
                {(canEditItem || canDeleteSupportItem) && (
                  <button
                    type="button"
                    disabled={deleting}
                    className="absolute inset-y-0 right-0 w-[76px] border-none cursor-pointer text-[13px] font-medium text-white"
                    style={{ background: "#ff3b30" }}
                    onClick={() => {
                      if (canDeleteSupportItem && item.supportThreadId) {
                        setPendingDelete({ kind: "support-thread", threadId: item.supportThreadId });
                      } else if (item.owned) {
                        setPendingDelete({ kind: "owned-single", channelIds: [item.id] });
                      } else {
                        removeRecent(item.id);
                        setSwipe({ id: null, offset: 0 });
                      }
                    }}
                  >
                    {canDeleteSupportItem ? t("delete") : item.owned ? t("dashboardDeleteChannel") : t("delete")}
                  </button>
                )}
                <div
                  className="relative z-10 flex items-center min-h-[74px] pl-4 cursor-pointer"
                  style={{
                    touchAction: canSwipeItem ? "pan-y" : "auto",
                    transform: `translateX(${canSwipeItem && swipe.id === item.id ? swipe.offset : 0}px)`,
                    transition: draggingId === item.id ? "none" : "transform 180ms ease-out",
                    background: "var(--bg)",
                  }}
                  onPointerDown={canSwipeItem ? (event) => startSwipe(event, item.id, swipeActionWidth, canCopyItem) : undefined}
                  onPointerMove={canSwipeItem ? (event) => moveSwipe(event, item.id) : undefined}
                  onPointerUp={canSwipeItem ? () => finishSwipe(item.id) : undefined}
                  onPointerCancel={canSwipeItem ? () => finishSwipe(item.id) : undefined}
                  onContextMenu={canCopyItem ? (event) => {
                    event.preventDefault();
                    clearChannelLongPress();
                    suppressClickRef.current = item.id;
                    void copyChannelLink(item.id);
                  } : undefined}
                  onClick={() => {
                    if (editing) {
                      if (!canEditItem) return;
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      });
                      return;
                    }
                    if (suppressClickRef.current === item.id) {
                      suppressClickRef.current = null;
                      return;
                    }
                    if (swipe.id === item.id && swipe.offset < 0) {
                      setSwipe({ id: null, offset: 0 });
                      return;
                    }
                    router.push(item.route);
                  }}
                >
                  {editing && canEditItem && (
                    <span
                      className="mr-3 w-[22px] h-[22px] rounded-full flex-shrink-0 flex items-center justify-center"
                      style={{
                        border: selectedIds.has(item.id) ? "none" : "1.5px solid #c7c7cc",
                        background: selectedIds.has(item.id) ? "#007aff" : "var(--bg)",
                        color: "#fff",
                      }}
                      aria-hidden="true"
                    >
                      {selectedIds.has(item.id) ? "✓" : ""}
                    </span>
                  )}
                  {item.group === "tickets" && item.supportIcon ? (
                    <div
                      className="w-[50px] h-[50px] rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden"
                      style={{
                        background: item.supportIconBg || "var(--card)",
                        color: item.supportIconColor || "var(--bubble-sent, #3598fe)",
                      }}
                      dangerouslySetInnerHTML={{
                        __html: item.supportIcon.replace(/<svg/, `<svg style="width:24px;height:24px"`),
                      }}
                    />
                  ) : item.group === "support-preview" && item.profileImage === "/logo.svg" ? (
                    <div className="w-[50px] h-[50px] rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden" style={{ backgroundColor: item.bubbleColor || "#111827" }}>
                      <ThemeLogo alt="" width={26} height={26} className="h-[26px] w-[26px]" />
                    </div>
                  ) : (
                    <div className="w-[50px] h-[50px] rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden text-white font-semibold text-[17px]" style={{ backgroundColor: item.bubbleColor || "#007aff", backgroundImage: item.profileImage ? `url("${item.profileImage}")` : undefined, backgroundPosition: "center", backgroundSize: "cover" }}>
                      {!item.profileImage && item.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="self-stretch min-w-0 flex-1 ml-3.5 pr-4 py-2 flex flex-col justify-center border-b" style={{ borderColor: "var(--hairline)" }}>
                    <div className="flex min-w-0 items-center">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <h2 className="m-0 truncate text-[16px] font-semibold">{item.name}</h2>
                        {item.group === "tickets" && item.supportActorType && (
                          <span className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "#f3f4f6", color: "#4b5563" }}>
                            {item.supportActorType === "guest" ? t("supportActorGuest") : t("supportActorLoggedIn")}
                          </span>
                        )}
                        {item.kind === "support" && item.supportWaitingOn === "platform_admin" && (
                          <span className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "#fff7ed", color: "#c2410c" }}>
                            {item.group === "tickets" ? t("supportNeedsReply") : t("supportWaitingBadge")}
                          </span>
                        )}
                        {item.group === "tickets" && item.supportWaitingOn === "user" && (
                          <span className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "#eef2ff", color: "#3730a3" }}>
                            {t("supportWaitingUserBadge")}
                          </span>
                        )}
                        {item.kind === "support" && item.supportUnread && (
                          <span className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "#eff6ff", color: "#1d4ed8" }}>
                            {item.group === "tickets" ? t("supportUnreadBadge") : t("supportNewReplyBadge")}
                          </span>
                        )}
                        {item.group === "tickets" && item.supportStaleLevel === "stale" && (
                          <span className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "#fff1f2", color: "#be123c" }}>
                            {t("supportStaleBadge")}
                          </span>
                        )}
                        {item.group === "tickets" && item.supportStaleLevel === "critical" && (
                          <span className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "#fef2f2", color: "#b91c1c" }}>
                            {t("supportCriticalBadge")}
                          </span>
                        )}
                        {item.group === "tickets" && !item.pinned && (
                          <span className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "var(--card)", color: "var(--meta)" }}>
                            {t("dashboardTicketClosed")}
                          </span>
                        )}
                        {item.hasPasscode && (
                          <svg
                            viewBox="0 0 24 24"
                            className="w-3.5 h-3.5 flex-shrink-0"
                            fill="none"
                            stroke="#8e8e93"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            role="img"
                            aria-label={t("passcodeRequired")}
                          >
                            <rect x="5" y="10" width="14" height="11" rx="2" />
                            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                          </svg>
                        )}
                        {item.pinned && (
                          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 flex-shrink-0" fill="#007aff" aria-label={t("dashboardPin")} role="img">
                            <path d="M14.5 3.5 20 9l-2 2-1.2-1.2-3.3 3.3.4 3.4-1.4 1.4-3.4-3.4L5 18.6 3.4 17l4.1-4.1-3.4-3.4 1.4-1.4 3.4.4 3.3-3.3L11 4l2-2 1.5 1.5Z" />
                          </svg>
                        )}
                        {item.liveActive && (
                          <span className="flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-full" style={{ background: "#fff0f0" }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#c0392b", animation: "livePulse 1.5s infinite" }} />
                            <span className="text-[10px] font-semibold" style={{ color: "#c0392b" }}>LIVE</span>
                          </span>
                        )}
                      </div>
                      <span className="ml-3 text-[13px] whitespace-nowrap" style={{ color: "var(--meta)" }}>{item.time}</span>
                      <span className="ml-2 text-[19px] font-light leading-none" style={{ color: "#c7c7cc" }}>›</span>
                    </div>
                    <div className="mt-1 flex min-w-0 items-center">
                      <p className="m-0 min-w-0 flex-1 truncate text-[14px]" style={{ color: copiedChannelId === item.id ? "#007aff" : "var(--meta)" }}>
                        {copiedChannelId === item.id ? t("dashboardCopied") : item.meta}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              </div>
              );
            })}
            {isPlatformAdmin && platformDashboard?.open_pagination?.has_more && !query && !platformTicketFilter && (
              <div className="px-4 py-4 text-center">
                <button
                  type="button"
                  disabled={loadingMorePlatformTickets}
                  className="border-none bg-transparent text-[14px] font-medium cursor-pointer disabled:cursor-default disabled:opacity-60"
                  style={{ color: "#007aff" }}
                  onClick={() => void loadMorePlatformTickets()}
                >
                  {loadingMorePlatformTickets ? t("supportLoadingMore") : t("supportLoadMore")}
                </button>
              </div>
            )}
          </section>
        )}

        <LegalFooter />
      </div>

      {showCreate && isLoggedIn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-5" style={{ background: "rgba(0,0,0,.35)", backdropFilter: "blur(4px)" }} onMouseDown={(event) => { if (event.target === event.currentTarget && !creating) setShowCreate(false); }}>
          <div className="w-full max-w-[390px] rounded-[20px] p-6" style={{ background: "var(--bg)", color: "var(--gray-text)", boxShadow: "0 24px 70px rgba(0,0,0,.22)" }}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="m-0 text-[19px] font-semibold">{t("onboardingTitle")}</h2>
              {createFieldsValid && (
                <button
                  type="button"
                  disabled={creating}
                  className="border-none bg-transparent p-0 text-[15px] font-medium"
                  style={{ color: "#007aff", cursor: creating ? "wait" : "pointer", opacity: creating ? 0.6 : 1 }}
                  onClick={() => void handleCreate()}
                >
                  {creating ? t("loading") : t("create")}
                </button>
              )}
            </div>
            <label className="block text-[12px] font-medium mb-1.5">{t("channelName")}</label>
            <input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={30} className="w-full rounded-[11px] outline-none text-[15px] mb-4" style={{ border: "1px solid var(--input-border)", padding: "11px 12px", boxSizing: "border-box", background: "var(--input-bg)", color: "var(--gray-text)" }} />
            <label className="block text-[12px] font-medium mb-1.5">{t("channelSlug")}</label>
            <div className="flex items-center rounded-[11px]" style={{ border: "1px solid var(--input-border)", background: "var(--input-bg)" }}>
              <span className="pl-3 text-[13px]" style={{ color: "var(--meta)" }}>/ch/</span>
              <input value={newSlug} onChange={(event) => setNewSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} maxLength={30} placeholder="my-channel" className="min-w-0 flex-1 border-none outline-none text-[15px]" style={{ padding: "11px 12px 11px 2px", background: "transparent" }} onKeyDown={(event) => { if (event.key === "Enter" && !creating && createFieldsValid) void handleCreate(); }} />
            </div>
            <div className="mt-1.5 text-[11px]" style={{ color: "var(--meta)" }}>{t("onboardingSlugHint")}</div>
            {createError && (
              <div className="mt-2 text-[12px]" style={{ color: "#ff3b30" }}>{createError}</div>
            )}
          </div>
        </div>
      )}

      {showFirstOnboarding && isLoggedIn && (
        <FirstChannelOnboarding
          onCreated={async () => { await loadChannels(); }}
          onClose={() => setShowFirstOnboarding(false)}
          onBetaCapacityReached={() => {
            setShowFirstOnboarding(false);
            setShowBetaCapacityNotice(true);
          }}
        />
      )}

      {showGuestOnboarding && !isLoggedIn && (
        <GuestOnboarding
          onClose={closeGuestOnboarding}
        />
      )}

      {showUserGuide && (
        <UserGuidePanel onClose={() => setShowUserGuide(false)} />
      )}

      {showAdminGuide && (
        <AdminGuidePanel onClose={() => setShowAdminGuide(false)} />
      )}

      {showLogin && !isLoggedIn && (
        <LoginDialog onClose={closeLogin} initialError={loginError} initialTab={loginInitialTab} />
      )}

      {showBetaNotice && isLoggedIn && !showFirstOnboarding && !pendingLocalChannels && (
        <BetaNoticeDialog onClose={closeBetaNotice} />
      )}

      {showBetaCapacityNotice && (
        <ConfirmDialog
          title={t("betaCapacityTitle")}
          message={t("betaCapacityDescription")}
          confirmLabel={t("betaCapacityConfirm")}
          onConfirm={() => setShowBetaCapacityNotice(false)}
          onCancel={() => setShowBetaCapacityNotice(false)}
          showCancel={false}
        />
      )}

      {!isPlatformAdmin && (
        <DashboardHelpMenu
          isLoggedIn={isLoggedIn}
          onOpenUserGuide={() => setShowUserGuide(true)}
          onOpenSupport={() => router.push("/support")}
          onOpenAdminGuide={() => setShowAdminGuide(true)}
        />
      )}

      {isLoggedIn && !isPlatformAdmin && !editing && ownedChannelIds.size < 5 && (
        <button
          type="button"
          className="fixed z-40 w-14 h-14 rounded-full border-none cursor-pointer flex items-center justify-center text-white"
          style={{
            right: "max(20px, calc((100vw - 480px) / 2 + 20px))",
            bottom: "max(20px, env(safe-area-inset-bottom))",
            background: "rgba(0,122,255,.82)",
            border: "none",
            boxShadow: "none",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
          onClick={() => void openCreateFlow()}
          disabled={checkingChannelCapacity}
          aria-label={t("createChannel")}
        >
          <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.kind === "support-thread" ? t("supportDeleteTicket") : t("dashboardDeleteChannel")}
          message={pendingDelete.kind === "support-thread" ? t("supportDeleteConfirm") : t("dashboardDeleteOwnedConfirm")}
          confirmLabel={t("delete")}
          confirmColor="#ff3b30"
          onConfirm={() => {
            const request = pendingDelete;
            setPendingDelete(null);
            if (request.kind === "support-thread") {
              void performDeleteSupportThread(request.threadId);
            } else if (request.kind === "owned-single") {
              void performDeleteSingleOwned(request.channelIds[0]);
            } else {
              void performDeleteSelected(request.channelIds);
            }
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {deleteError && (
        <ConfirmDialog
          title={deleteError.title}
          message={deleteError.message}
          confirmLabel={t("confirm")}
          onConfirm={() => setDeleteError(null)}
          onCancel={() => setDeleteError(null)}
          showCancel={false}
        />
      )}

      {showDeleteAccountConfirm && (
        <ConfirmDialog
          title={t("deleteAccount")}
          message={t("deleteAccountConfirm")}
          confirmLabel={deletingAccount ? t("loading") : t("deleteAccount")}
          confirmColor="#ff3b30"
          onConfirm={() => void deleteAccount()}
          onCancel={() => setShowDeleteAccountConfirm(false)}
          closeOnBackdrop={!deletingAccount}
          disabled={deletingAccount}
        />
      )}

      {showDeleteAccountError && (
        <ConfirmDialog
          title={t("deleteAccount")}
          message={t("deleteAccountFailed")}
          confirmLabel={t("confirm")}
          onConfirm={() => setShowDeleteAccountError(false)}
          onCancel={() => setShowDeleteAccountError(false)}
          showCancel={false}
        />
      )}

      {pendingLocalChannels && (
        <ConfirmDialog
          title={t("dashboardLocalMigrationTitle")}
          message={`${t("dashboardLocalMigrationMessage").replace("{count}", String(pendingLocalChannels.length))}${localMigrationError ? `<br><span style="color:#ff3b30">${t("dashboardLocalMigrationError")}</span>` : ""}`}
          confirmLabel={migratingLocalChannels ? t("loading") : t("dashboardLocalMigrationConnect")}
          cancelLabel={t("dashboardLocalMigrationSkip")}
          onConfirm={() => void connectLocalChannels()}
          onCancel={skipLocalChannelMigration}
          closeOnBackdrop={false}
          disabled={migratingLocalChannels}
        />
      )}
    </main>
  );
}

export default function DashboardPage() {
  return (
    <Providers>
      <DashboardPageContent />
      <VisitSurvey />
    </Providers>
  );
}
