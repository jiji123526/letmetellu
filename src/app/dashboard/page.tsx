"use client";

import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLocale } from "@/hooks/useLocale";
import { clearStoredSupportTicketPreview, decorateMediaUrl, fetchPlatformDashboard, fetchSupportState, readStoredSupportTicketPreview, storeSupportTicketPreview, type PlatformDashboardResponse } from "@/lib/api";
import { clearRecentChannels, getRecentChannels, removeRecentChannel, toggleRecentChannelPinned, type RecentChannel } from "@/lib/recent-channels";
import { clearChannelLocalState } from "@/lib/channel-local-state";
import { parseServerDate } from "@/lib/chat-date";
import { FirstChannelOnboarding } from "@/components/dashboard/FirstChannelOnboarding";
import { GuestOnboarding } from "@/components/dashboard/GuestOnboarding";
import { ConfirmDialog } from "@/components/chat/ConfirmDialog";
import { UserGuidePanel } from "@/components/chat/UserGuidePanel";
import { AdminGuidePanel } from "@/components/admin/AdminGuidePanel";
import { DashboardHelpMenu } from "@/components/dashboard/DashboardHelpMenu";
import { LoginDialog } from "@/components/dashboard/LoginDialog";
import { LegalFooter } from "@/components/legal/LegalFooter";
import {
  fetchAccountRecentChannels,
  mergeAccountRecentChannels,
  removeAccountRecentChannel,
  setAccountRecentChannelPinned,
} from "@/lib/account-recent-channels";

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
}

interface DashboardListItem {
  id: string;
  group: "reports" | "tickets" | "owned" | "joined" | "support-preview";
  kind: "channel" | "support";
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

function getChannelPreviewColor(channelId: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  try {
    return localStorage.getItem(`bubbleColor_${channelId}`) || fallback;
  } catch {
    return fallback;
  }
}

function getChannelIdFromLink(value: string) {
  const match = value.trim().match(/^(?:(?:https?:\/\/[^/\s]+|letmetellu\.vercel\.app))?\/ch\/([a-z0-9-]{3,30})\/?(?:[?#].*)?$/i);
  return match?.[1]?.toLowerCase() || null;
}

function looksLikeChannelAddress(value: string) {
  return /^(?:(?:https?:\/\/[^/\s]+|letmetellu\.vercel\.app))?\/ch\//i.test(value.trim());
}

function localMigrationSignature(channels: RecentChannel[]) {
  return channels.map((channel) => channel.id).sort().join(",");
}

export default function DashboardPage() {
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
  const [pendingDelete, setPendingDelete] = useState<{ mode: "single" | "selected"; channelIds: string[] } | null>(null);
  const [showDeleteError, setShowDeleteError] = useState(false);
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [showDeleteAccountError, setShowDeleteAccountError] = useState(false);
  const [platformDashboard, setPlatformDashboard] = useState<PlatformDashboardResponse | null>(null);
  const [supportPreview, setSupportPreview] = useState<SupportDashboardPreview | null>(() => readStoredSupportTicketPreview());
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [prioritizedOwnedId, setPrioritizedOwnedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return localStorage.getItem("letmetellu_prioritized_owned_channel"); } catch { return null; }
  });
  const channelItemRefs = useRef(new Map<string, HTMLDivElement>());
  const previousItemPositionsRef = useRef(new Map<string, number>());
  const [swipe, setSwipe] = useState<{ id: string | null; offset: number }>({ id: null, offset: 0 });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const swipeStartRef = useRef<{ id: string; x: number; y: number; startOffset: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const channelLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copiedChannelId, setCopiedChannelId] = useState<string | null>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const linkedChannelId = submittedLinkedChannelId;
  const hasSearchQuery = query.trim().length > 0;
  const isAddressQuery = looksLikeChannelAddress(query);
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
    const syncViewportHeight = () => {
      setViewportHeight(window.innerHeight);
    };
    syncViewportHeight();
    window.addEventListener("resize", syncViewportHeight);
    return () => window.removeEventListener("resize", syncViewportHeight);
  }, []);

  const loadChannels = useCallback(async () => {
    const response = await fetch("/api/user", { cache: "no-store" });
    const data = await response.json() as { channels?: Channel[] };
    setChannels((data.channels || []).map((channel) => ({
      ...channel,
      profile_image: decorateMediaUrl(channel.profile_image),
    })));
  }, []);

  const loadLocalRecentChannels = useCallback(async () => {
    const stored = getRecentChannels();
    setRecentChannels(stored);
    if (stored.length === 0) return;
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
      setRecentChannels(getRecentChannels());
    } catch {
      // Keep locally stored channels when validation is temporarily unavailable.
    }
  }, []);

  const loadAccountRecentChannels = useCallback(async (userId: string) => {
    const migrationKey = `letmetellu_recent_channels_migrated_${userId}`;
    try {
      const accountChannels = await fetchAccountRecentChannels();
      setRecentChannels(accountChannels);
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
    }
  }, []);

  const loadPlatformDashboard = useCallback(async () => {
    if (status !== "authenticated") {
      setPlatformDashboard(null);
      return;
    }
    try {
      const result = await fetchPlatformDashboard();
      if (result._status === 403 || result._status === 404 || result._status >= 400) {
        setPlatformDashboard(null);
        return;
      }
      setPlatformDashboard({
        reportsInbox: result.reportsInbox ?? null,
        tickets: result.tickets || [],
      });
    } catch {
      setPlatformDashboard(null);
    }
  }, [status]);

  const loadSupportPreview = useCallback(async () => {
    if (status === "loading") {
      return;
    }
    try {
      const result = await fetchSupportState();
      if (result._status >= 400 || !result.thread) {
        clearStoredSupportTicketPreview();
        setSupportPreview(null);
        return;
      }
      const latestMessage = result.messages?.[result.messages.length - 1] || null;
      const preview = {
        threadId: result.thread.id,
        topicLabel: result.thread.entry_topic_label,
        preview: result.thread.last_message || latestMessage?.text || result.thread.summary,
        updatedAt: result.thread.updated_at,
      };
      storeSupportTicketPreview(preview);
      setSupportPreview(preview);
    } catch {
      setSupportPreview(status === "unauthenticated" ? readStoredSupportTicketPreview() : null);
    }
  }, [status]);

  const connectLocalChannels = async () => {
    if (!pendingLocalChannels || !session?.user?.id || migratingLocalChannels) return;
    const migrationKey = `letmetellu_recent_channels_migrated_${session.user.id}`;
    setMigratingLocalChannels(true);
    setLocalMigrationError(false);
    try {
      await mergeAccountRecentChannels(pendingLocalChannels);
      const accountChannels = await fetchAccountRecentChannels();
      setRecentChannels(accountChannels);
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (status === "authenticated" && session?.user?.id) {
        void Promise.all([
          loadChannels(),
          loadAccountRecentChannels(session.user.id),
          loadPlatformDashboard(),
          loadSupportPreview(),
        ]).finally(() => setLoading(false));
      } else if (status === "unauthenticated") {
        void Promise.all([
          loadLocalRecentChannels(),
          loadSupportPreview(),
        ]);
        setPlatformDashboard(null);
        setLoading(false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [status, session?.user?.id, loadChannels, loadLocalRecentChannels, loadAccountRecentChannels, loadPlatformDashboard, loadSupportPreview]);

  useEffect(() => {
    if (status === "loading") return;
    const timer = window.setInterval(() => {
      if (status === "authenticated") {
        void loadPlatformDashboard();
      }
      void loadSupportPreview();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status, loadPlatformDashboard, loadSupportPreview]);

  useEffect(() => {
    if (status === "loading") return;
    const refresh = () => {
      if (status === "authenticated") {
        void loadPlatformDashboard();
      }
      void loadSupportPreview();
    };
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [status, loadPlatformDashboard, loadSupportPreview]);

  useEffect(() => {
    if (status === "loading") return;
    const refresh = () => {
      if (status === "authenticated") {
        void loadPlatformDashboard();
      }
      void loadSupportPreview();
    };
    window.addEventListener("support-ticket-changed", refresh as EventListener);
    return () => {
      window.removeEventListener("support-ticket-changed", refresh as EventListener);
    };
  }, [status, loadPlatformDashboard, loadSupportPreview]);

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
          bubbleColor: previewColor(channel.id, channel.bubble_color || "#3b8df0"),
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
        bubbleColor: channel.bubbleColor || "#3b8df0",
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
          bubbleColor: previewColor(channel.id, channel.bubbleColor || "#3b8df0"),
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
    const items: DashboardListItem[] = [...ownedItems, ...fallbackOwnedItems, ...recentItems];
    if (linkedChannel && !items.some((item) => item.id === linkedChannel.id)) {
      items.push({
        group: "joined",
        kind: "channel",
        route: `/ch/${linkedChannel.id}`,
        id: linkedChannel.id,
        name: linkedChannel.name,
        profileImage: linkedChannel.profile_image,
        bubbleColor: previewColor(linkedChannel.id, linkedChannel.bubble_color || "#3b8df0"),
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
          parseServerDate(platformDashboard.reportsInbox.last_report_at || platformDashboard.reportsInbox.created_at)?.getTime() || Date.now(),
          locale,
        ),
        owned: false,
        pinned: false,
        activityAt: platformDashboard.reportsInbox.last_report_at || platformDashboard.reportsInbox.created_at,
        liveActive: false,
      });
    }
    if (platformDashboard?.tickets?.length) {
      const ticketItems = platformDashboard.tickets.map((ticket) => ({
        id: `ticket-${ticket.id}`,
        group: "tickets" as const,
        kind: "support" as const,
        route: `/support?thread=${encodeURIComponent(ticket.id)}&admin=1`,
        name: ticket.entry_topic_label,
        profileImage: null,
        bubbleColor: ticket.status === "open" ? "#111827" : "#6b7280",
        hasPasscode: false,
        ownerName: ticket.user_label,
        meta: ticket.last_message || ticket.summary,
        time: formatRelativeTime(
          parseServerDate(ticket.updated_at)?.getTime() || Date.now(),
          locale,
        ),
        owned: false,
        pinned: ticket.status === "open",
        activityAt: ticket.updated_at,
        liveActive: false,
      }));
      platformItems.push(...ticketItems);
    }
    if (platformItems.length > 0) {
      items.unshift(...platformItems);
    }
    if (supportPreview && !platformDashboard) {
      const supportItem: DashboardListItem = {
        id: `support-${supportPreview.threadId}`,
        group: "support-preview",
        kind: "support",
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
  }, [channels, recentChannels, query, locale, prioritizedOwnedId, linkedChannel, linkedChannelId, status, ownedChannelIds, platformDashboard, supportPreview, t]);

  useLayoutEffect(() => {
    const nextPositions = new Map<string, number>();
    channelItemRefs.current.forEach((element, id) => {
      const nextTop = element.getBoundingClientRect().top;
      nextPositions.set(id, nextTop);
      const previousTop = previousItemPositionsRef.current.get(id);
      if (previousTop === undefined || previousTop === nextTop) return;
      element.animate(
        [
          { transform: `translateY(${previousTop - nextTop}px)` },
          { transform: "translateY(0)" },
        ],
        {
          duration: 320,
          easing: "cubic-bezier(.22,.8,.36,1)",
        },
      );
    });
    previousItemPositionsRef.current = nextPositions;
  }, [activeItems]);

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

  const openCreateFlow = useCallback(() => {
    setCreateError("");
    setShowCreate(ownedChannelIds.size > 0);
    setShowFirstOnboarding(ownedChannelIds.size === 0);
  }, [ownedChannelIds]);

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
    openCreateFlow();
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
      await loadChannels();
      if (status === "authenticated" && session?.user?.id) {
        await loadAccountRecentChannels(session.user.id);
      } else {
        setRecentChannels(getRecentChannels());
      }
      setSelectedIds(new Set());
      setEditing(false);
    } catch {
      setShowDeleteError(true);
    } finally {
      setDeleting(false);
    }
  };

  const deleteSelected = () => {
    if (!selectedIds.size || deleting) return;
    const channelIds = [...selectedIds];
    const includesOwned = channelIds.some((id) => ownedChannelIds.has(id));
    if (includesOwned) {
      setPendingDelete({ mode: "selected", channelIds });
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
      setShowDeleteError(true);
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

  const startSwipe = (event: ReactPointerEvent<HTMLDivElement>, channelId: string) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    swipeStartRef.current = {
      id: channelId,
      x: event.clientX,
      y: event.clientY,
      startOffset: swipe.id === channelId ? swipe.offset : 0,
      moved: false,
    };
    setDraggingId(channelId);
    if (swipe.id !== channelId) setSwipe({ id: channelId, offset: 0 });
    clearChannelLongPress();
    channelLongPressTimerRef.current = setTimeout(() => {
      const start = swipeStartRef.current;
      if (!start || start.id !== channelId || start.moved) return;
      start.moved = true;
      suppressClickRef.current = true;
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
    const offset = Math.max(-152, Math.min(0, start.startOffset + deltaX));
    setSwipe({ id: channelId, offset });
  };

  const finishSwipe = (channelId: string) => {
    clearChannelLongPress();
    const start = swipeStartRef.current;
    if (!start || start.id !== channelId) return;
    suppressClickRef.current = suppressClickRef.current || start.moved;
    setSwipe((current) => ({
      id: current.id,
      offset: current.id === channelId && current.offset < -48 ? -152 : 0,
    }));
    swipeStartRef.current = null;
    setDraggingId(null);
  };

  if (status === "loading" || loading) {
    return <main className="dashboard-font-scaled min-h-dvh flex items-center justify-center" style={{ background: "var(--bg)", color: "var(--gray-text)" }}><span className="text-[14px]" style={{ color: "var(--meta)" }}>{t("loading")}</span></main>;
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
            {activeItems.length > 0 ? (
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
              <Image src="/logo.svg" alt="" width={48} height={48} className="h-12 w-12" />
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
                        <button className="w-full border-none cursor-pointer text-left px-4 py-3 text-[14px]" style={{ background: "transparent", color: "var(--tint)", borderBottom: "0.5px solid var(--hairline)" }} onClick={() => signOut({ callbackUrl: "/dashboard" })}>{t("logout")}</button>
                        <button className="w-full border-none cursor-pointer text-left px-4 py-3 text-[14px]" style={{ background: "transparent", color: "#ff453a", borderBottom: "0.5px solid var(--hairline)" }} onClick={() => { setShowAccount(false); setShowDeleteAccountConfirm(true); }}>{t("deleteAccount")}</button>
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
                  const channelId = getChannelIdFromLink(nextValue);
                  if (!channelId) return;
                  event.preventDefault();
                  setQuery(nextValue);
                  setLinkedChannel(null);
                  setSubmittedLinkedChannelId(channelId);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  const channelId = getChannelIdFromLink(query);
                  if (!channelId) return;
                  event.preventDefault();
                  setLinkedChannel(null);
                  setSubmittedLinkedChannelId(channelId);
                }}
                placeholder={t("dashboardSearch")}
                className="w-full h-10 border-none rounded-[12px] outline-none text-[17px] text-left"
                style={{ background: "var(--input-bg)", padding: "0 36px 0 42px", boxSizing: "border-box", color: "var(--gray-text)" }}
              />
              {hasSearchQuery && (
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 rounded-full"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--meta)", fontSize: "18px", lineHeight: 1 }}
                  onClick={() => { setQuery(""); setSubmittedLinkedChannelId(null); }}
                  aria-label="Clear"
                >
                  ✕
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
        </header>

        {empty ? (
          <section className="px-8 py-24 text-center" style={{ paddingBottom: `calc(6rem + ${listBottomPadding})` }}>
            <div className="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4" style={{ background: "var(--card)" }}>
              <Image src="/logo.svg" alt="" width={72} height={72} className="h-[72px] w-[72px]" />
            </div>
            <h2 className="m-0 text-[19px] font-semibold">{query ? t("dashboardNoSearchResults") : t("dashboardNoRecent")}</h2>
            {!query && <p className="mt-2 mb-5 text-[14px] leading-[1.5]" style={{ color: "var(--meta)" }}>{isLoggedIn ? t("dashboardEmptyDesc") : t("dashboardRecentDesc")}</p>}
            {!query && isLoggedIn && <button className="border-none bg-transparent cursor-pointer text-[15px] font-medium" style={{ color: "#007aff" }} onClick={openCreateFlow}>{t("dashboardFirstChannel")}</button>}
          </section>
        ) : (
          <section style={{ paddingBottom: listBottomPadding }}>
            {activeItems.map((item, index) => {
              const previousItem = activeItems[index - 1];
              const showSectionLabel = (() => {
                if (index > 0 && previousItem?.group === item.group) return false;
                if (item.group === "reports" || item.group === "tickets") return true;
                if (item.group === "support-preview") return false;
                if (platformDashboard) return false;
                return isLoggedIn && ownedChannelIds.size > 0;
              })();
              const canEditItem = item.kind === "channel" && (item.group === "owned" || item.group === "joined");
              const canSwipeItem = canEditItem && !editing;
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
                    <button
                      type="button"
                      disabled={deleting}
                      className="absolute inset-y-0 right-0 w-[76px] border-none cursor-pointer text-[13px] font-medium text-white"
                      style={{ background: "#ff3b30" }}
                      onClick={() => {
                        if (item.owned) {
                          setPendingDelete({ mode: "single", channelIds: [item.id] });
                        } else {
                          removeRecent(item.id);
                          setSwipe({ id: null, offset: 0 });
                        }
                      }}
                    >
                      {item.owned ? t("dashboardDeleteChannel") : t("delete")}
                    </button>
                  </>
                )}
                <div
                  className="relative z-10 flex items-center min-h-[74px] pl-4 cursor-pointer"
                  style={{
                    touchAction: canSwipeItem ? "pan-y" : "auto",
                    transform: `translateX(${canSwipeItem && swipe.id === item.id ? swipe.offset : 0}px)`,
                    transition: draggingId === item.id ? "none" : "transform 180ms ease-out",
                    background: "var(--bg)",
                  }}
                  onPointerDown={canSwipeItem ? (event) => startSwipe(event, item.id) : undefined}
                  onPointerMove={canSwipeItem ? (event) => moveSwipe(event, item.id) : undefined}
                  onPointerUp={canSwipeItem ? () => finishSwipe(item.id) : undefined}
                  onPointerCancel={canSwipeItem ? () => finishSwipe(item.id) : undefined}
                  onContextMenu={canSwipeItem ? (event) => {
                    event.preventDefault();
                    clearChannelLongPress();
                    suppressClickRef.current = true;
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
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
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
                  <div className="w-[50px] h-[50px] rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden text-white font-semibold text-[17px]" style={{ backgroundColor: item.bubbleColor || "#007aff", backgroundImage: item.profileImage ? `url("${item.profileImage}")` : undefined, backgroundPosition: "center", backgroundSize: "cover" }}>
                    {!item.profileImage && item.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="self-stretch min-w-0 flex-1 ml-3.5 pr-4 py-2 flex flex-col justify-center border-b" style={{ borderColor: "var(--hairline)" }}>
                    <div className="flex min-w-0 items-center">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <h2 className="m-0 truncate text-[16px] font-semibold">{item.name}</h2>
                        {item.kind === "support" && item.ownerName && (
                          <span className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "#eef2ff", color: "#3730a3" }}>
                            {item.ownerName}
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
          </section>
        )}

        <LegalFooter />

        {editing && (
          <div className="sticky bottom-0 z-30 px-4 py-3 flex items-center justify-between border-t" style={{ background: "var(--header-bg)", borderColor: "var(--hairline)", backdropFilter: "blur(20px)" }}>
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
        />
      )}

      {showGuestOnboarding && !isLoggedIn && (
        <GuestOnboarding
          onClose={closeGuestOnboarding}
          onGuide={() => {
            setShowGuestOnboarding(false);
            setShowUserGuide(true);
          }}
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

      <DashboardHelpMenu
        isLoggedIn={isLoggedIn}
        onOpenUserGuide={() => setShowUserGuide(true)}
        onOpenSupport={() => router.push("/support")}
        onOpenAdminGuide={() => setShowAdminGuide(true)}
      />

      {isLoggedIn && !editing && ownedChannelIds.size < 5 && (
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
          onClick={openCreateFlow}
          aria-label={t("createChannel")}
        >
          <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={t("dashboardDeleteChannel")}
          message={t("dashboardDeleteOwnedConfirm")}
          confirmLabel={t("delete")}
          confirmColor="#ff3b30"
          onConfirm={() => {
            const request = pendingDelete;
            setPendingDelete(null);
            if (request.mode === "single") {
              void performDeleteSingleOwned(request.channelIds[0]);
            } else {
              void performDeleteSelected(request.channelIds);
            }
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {showDeleteError && (
        <ConfirmDialog
          title={t("dashboardDeleteChannel")}
          message={t("dashboardDeleteFailed")}
          confirmLabel={t("confirm")}
          onConfirm={() => setShowDeleteError(false)}
          onCancel={() => setShowDeleteError(false)}
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
