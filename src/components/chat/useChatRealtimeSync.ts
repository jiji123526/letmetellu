"use client";

import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import {
  clearRoomToken,
  decorateMediaUrl,
  decorateMessageMedia,
  decorateProtectedMediaUrl,
} from "@/lib/api-core";
import {
  fetchDmThreads,
  fetchInit,
  fetchMessages,
} from "@/lib/api-chat";
import {
  completeChatPerformanceCycle,
  finishChatPerformanceRequest,
  startChatPerformanceCycle,
  startChatPerformanceRequest,
} from "@/lib/chat-performance";
import { clearChannelLocalState } from "@/lib/channel-local-state";
import { patchChannelAppearance } from "@/lib/channel-background-cache";
import { removeRecentChannel, updateRecentChannelAppearance } from "@/lib/recent-channels";
import { spawnEmoji } from "./EmojiBar";
import { mergeServerMessageSnapshot } from "./chatMessageUtils";
import { shareInFlightRequest } from "./chatSingleFlight";
import type { Message, PetitionMeta, ReportMeta } from "./chatTypes";
import type {
  ChatTimelineSource,
} from "./chatTimelineState";
import type { Channel, InitData, PasscodeGateState } from "./chatViewTypes";

interface BannerState {
  text: string;
  color: string;
}

interface GalleryItem {
  id: string;
  image: string;
  created_at: string;
}

interface EndLiveSessionOptions {
  clearSeen?: boolean;
  showEndedPopup?: boolean;
}

interface SyncLiveSessionOptions {
  title?: string;
  sessionId?: string;
  expiresAt?: string | null;
}

interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

interface UseChatRealtimeSyncArgs {
  channelId: string;
  connected: boolean;
  uid: string;
  isOwner: boolean;
  isLoggedIn: boolean;
  localBubbleColor: string | null;
  unifiedTimelineEnabled: boolean;
  subscribe: (handler: (event: RealtimeEvent) => void) => () => void;
  send: (data: Record<string, unknown>) => void;
  inLiveModeRef: MutableRefObject<boolean>;
  historyModeRef: MutableRefObject<"latest" | "context">;
  isNearBottomRef: MutableRefObject<boolean>;
  hasMoreNewerMessagesRef: MutableRefObject<boolean>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  pendingReactionUpdatesRef: MutableRefObject<Map<string, string>>;
  reactionFrameRef: MutableRefObject<number | null>;
  applyInitData: (
    data: InitData,
    options?: { preserveHistory?: boolean; skipTimeline?: boolean },
  ) => void;
  applyLiveSnapshot: (live: InitData["live"]) => void;
  liveActive: boolean;
  liveSessionId: string;
  showPasscodeGate: (notice?: string, bannerText?: string) => void;
  clearRoomAccessBanner: () => void;
  refreshOwnerModeration: () => void;
  loadNormalChannelData: () => Promise<void>;
  endLiveSessionLocally: (options?: EndLiveSessionOptions) => boolean;
  handleLiveStartedEvent: (options: SyncLiveSessionOptions) => void;
  applyEmojiPresetsSnapshot: (rawPresets: string | null | undefined) => void;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  upsertTimelineItems: (
    source: ChatTimelineSource,
    messages: Message[],
    requiredRootId?: string,
  ) => void;
  removeTimelineThread: (source: ChatTimelineSource, rootId: string) => void;
  setNewerMessageCount: Dispatch<SetStateAction<number>>;
  setGalleryItems: Dispatch<SetStateAction<GalleryItem[]>>;
  setChannel: Dispatch<SetStateAction<Channel | null>>;
  setActiveNotice: Dispatch<SetStateAction<string>>;
  setWelcomeConfig: Dispatch<SetStateAction<string>>;
  setPetitionEnabled: Dispatch<SetStateAction<boolean>>;
  setDmEnabled: Dispatch<SetStateAction<boolean>>;
  setOwnerModeration: Dispatch<SetStateAction<InitData["ownerModeration"] | undefined>>;
  setViewerModerationStatus: Dispatch<SetStateAction<InitData["viewerModerationStatus"]>>;
  setDmMessages: Dispatch<SetStateAction<Message[]>>;
  setPasscodeGate: Dispatch<SetStateAction<PasscodeGateState | null>>;
  setViewerBlocked: Dispatch<SetStateAction<boolean>>;
  setBlockedUsers: Dispatch<SetStateAction<{ uid: string; reason: string }[]>>;
  setBanner: Dispatch<SetStateAction<BannerState | null>>;
  setShowChannelDeleted: Dispatch<SetStateAction<boolean>>;
  text: {
    deletedMessage: string;
    roomAuthExpired: string;
    passcodeChanged: string;
    adminDataAuthFailed: string;
  };
}

export function useChatRealtimeSync({
  channelId,
  connected,
  uid,
  isOwner,
  isLoggedIn,
  localBubbleColor,
  unifiedTimelineEnabled,
  subscribe,
  send,
  inLiveModeRef,
  historyModeRef,
  isNearBottomRef,
  hasMoreNewerMessagesRef,
  messagesEndRef,
  pendingReactionUpdatesRef,
  reactionFrameRef,
  applyInitData,
  applyLiveSnapshot,
  liveActive,
  liveSessionId,
  showPasscodeGate,
  clearRoomAccessBanner,
  refreshOwnerModeration,
  loadNormalChannelData,
  endLiveSessionLocally,
  handleLiveStartedEvent,
  applyEmojiPresetsSnapshot,
  setMessages,
  upsertTimelineItems,
  removeTimelineThread,
  setNewerMessageCount,
  setGalleryItems,
  setChannel,
  setActiveNotice,
  setWelcomeConfig,
  setPetitionEnabled,
  setDmEnabled,
  setOwnerModeration,
  setViewerModerationStatus,
  setDmMessages,
  setPasscodeGate,
  setViewerBlocked,
  setBlockedUsers,
  setBanner,
  setShowChannelDeleted,
  text,
}: UseChatRealtimeSyncArgs) {
  const {
    deletedMessage,
    roomAuthExpired,
    passcodeChanged,
    adminDataAuthFailed,
  } = text;
  const pendingContextMessageIdsRef = useRef(new Set<string>());
  const dmRefreshRequestIdRef = useRef(0);
  const unifiedRefreshPromiseRef = useRef<Promise<void> | null>(null);
  useEffect(() => {
    dmRefreshRequestIdRef.current += 1;
    unifiedRefreshPromiseRef.current = null;
  }, [channelId]);

  const getViewingChannelId = useCallback(() => {
    return inLiveModeRef.current ? `${channelId}_live` : channelId;
  }, [channelId, inLiveModeRef]);

  const refreshLatestMessages = useCallback(async (traceCycleId?: string) => {
    const fetchChannel = getViewingChannelId();
    if (traceCycleId) {
      startChatPerformanceRequest(channelId, traceCycleId, "messages");
    }
    try {
      const data = await fetchMessages(fetchChannel);
      if (data.messages) {
        setMessages((previous) => mergeServerMessageSnapshot(previous, data.messages));
      }
    } finally {
      if (traceCycleId) {
        finishChatPerformanceRequest(channelId, traceCycleId, "messages");
      }
    }
  }, [channelId, getViewingChannelId, setMessages]);

  const fetchTrackedInit = useCallback(async (
    fetchChannel: string,
    traceCycleId?: string,
  ): Promise<InitData> => {
    if (traceCycleId) {
      startChatPerformanceRequest(channelId, traceCycleId, "init");
    }
    try {
      return await fetchInit(fetchChannel) as InitData;
    } finally {
      if (traceCycleId) {
        finishChatPerformanceRequest(channelId, traceCycleId, "init");
      }
    }
  }, [channelId]);

  const applyLightweightInitData = useCallback((data: InitData) => {
    if (!data.channel || data.messages === undefined) return;
    setChannel(data.channel);
    if (historyModeRef.current === "latest") {
      setMessages((previous) => mergeServerMessageSnapshot(previous, data.messages || []));
    } else if ((data.messages || []).length > 0) {
      hasMoreNewerMessagesRef.current = true;
    }
    if (data.bannerNotice !== undefined) setActiveNotice(data.bannerNotice || "");
    if (data.welcomeConfig !== undefined) setWelcomeConfig(data.welcomeConfig || "");
    if (data.petitionEnabled !== undefined) setPetitionEnabled(data.petitionEnabled);
    if (data.dmEnabled !== undefined) setDmEnabled(data.dmEnabled);
    setOwnerModeration(data.ownerModeration);
    setViewerModerationStatus(data.viewerModerationStatus ?? null);
    applyLiveSnapshot(data.live);
  }, [
    applyLiveSnapshot,
    hasMoreNewerMessagesRef,
    historyModeRef,
    setActiveNotice,
    setChannel,
    setDmEnabled,
    setMessages,
    setOwnerModeration,
    setPetitionEnabled,
    setViewerModerationStatus,
    setWelcomeConfig,
  ]);

  const applyReconnectInitData = useCallback((data: InitData) => {
    if (data.unifiedTimelineEnabled && data.unifiedTimeline) {
      if (historyModeRef.current === "context") {
        hasMoreNewerMessagesRef.current = true;
        applyInitData(data, { preserveHistory: true, skipTimeline: true });
      } else {
        applyInitData(data, { preserveHistory: true });
      }
      return;
    }
    if (isOwner) {
      if (historyModeRef.current === "context" && (data.messages || []).length > 0) {
        hasMoreNewerMessagesRef.current = true;
      }
      applyInitData(data, { preserveHistory: true });
      return;
    }
    applyLightweightInitData(data);
  }, [
    applyInitData,
    applyLightweightInitData,
    hasMoreNewerMessagesRef,
    historyModeRef,
    isOwner,
  ]);

  const refreshLatestTimeline = useCallback(async (traceCycleId?: string) => {
    if (unifiedTimelineEnabled) {
      const data = await fetchTrackedInit(getViewingChannelId(), traceCycleId);
      applyReconnectInitData(data);
      return;
    }
    await refreshLatestMessages(traceCycleId);
  }, [
    applyReconnectInitData,
    fetchTrackedInit,
    getViewingChannelId,
    refreshLatestMessages,
    unifiedTimelineEnabled,
  ]);
  const reconcileCurrentLiveSession = useCallback(async (traceCycleId?: string) => {
    const wasInLiveMode = inLiveModeRef.current;
    const fetchChannel = wasInLiveMode ? `${channelId}_live` : channelId;
    const data = await fetchTrackedInit(fetchChannel, traceCycleId);
    const serverLive = data.live?.active ? data.live : null;
    const serverSessionId = serverLive?.sessionId || "";
    const sameSession = Boolean(
      serverLive
      && (!liveSessionId || serverSessionId === liveSessionId),
    );

    if (wasInLiveMode && !sameSession) {
      endLiveSessionLocally({
        clearSeen: true,
        showEndedPopup: !serverLive,
      });
      const normalData = await fetchTrackedInit(channelId, traceCycleId);
      applyInitData(normalData);
      if (serverLive) {
        handleLiveStartedEvent({
          title: serverLive.title,
          sessionId: serverSessionId,
          expiresAt: serverLive.expiresAt || null,
        });
      }
      return { shouldJoinLive: false, sessionId: "" };
    }

    applyReconnectInitData(data);
    return {
      shouldJoinLive: wasInLiveMode && sameSession,
      sessionId: serverSessionId,
    };
  }, [
    applyInitData,
    applyReconnectInitData,
    channelId,
    endLiveSessionLocally,
    fetchTrackedInit,
    handleLiveStartedEvent,
    inLiveModeRef,
    liveSessionId,
  ]);

  const synchronizeLiveSession = useCallback(async (traceCycleId?: string) => {
    const result = await reconcileCurrentLiveSession(traceCycleId);
    if (result.shouldJoinLive && result.sessionId) {
      send({ type: "join-live", sessionId: result.sessionId });
    }
  }, [reconcileCurrentLiveSession, send]);
  const refreshUnifiedTimelineOnce = useCallback(() => {
    return shareInFlightRequest(
      unifiedRefreshPromiseRef,
      () => inLiveModeRef.current
        ? synchronizeLiveSession()
        : refreshLatestTimeline(),
    );
  }, [inLiveModeRef, refreshLatestTimeline, synchronizeLiveSession]);

  useEffect(() => {
    return subscribe((event) => {
      const settleTraceRequest = (traceCycleId: string | null, request: Promise<void>) => {
        if (!traceCycleId) return;
        void request.then(
          () => completeChatPerformanceCycle(channelId, traceCycleId, "settled"),
          () => completeChatPerformanceCycle(channelId, traceCycleId, "failed"),
        );
      };

      if (event.type === "message-new") {
        const msg = decorateMessageMedia(event.message as Message);
        const viewingChannel = getViewingChannelId();
        if (msg.channel_id === viewingChannel) {
          if (msg.reply_to) {
            upsertTimelineItems("message", [msg], msg.reply_to);
            return;
          }
          if (historyModeRef.current === "context") {
            if (pendingContextMessageIdsRef.current.has(msg.id)) return;
            if (pendingContextMessageIdsRef.current.size >= 500) {
              const oldestId = pendingContextMessageIdsRef.current.values().next().value;
              if (oldestId) pendingContextMessageIdsRef.current.delete(oldestId);
            }
            pendingContextMessageIdsRef.current.add(msg.id);
            hasMoreNewerMessagesRef.current = true;
            setNewerMessageCount((count) => count + 1);
            return;
          }
          const shouldFollowNewMessage = isNearBottomRef.current;
          upsertTimelineItems("message", [msg]);
          if (shouldFollowNewMessage) {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
              });
            });
          }
        }
      }

      if (event.type === "message-edited") {
        const id = event.message_id as string;
        setMessages((previous) => previous.map((message) =>
          message.id === id
            ? {
                ...message,
                text: event.text as string,
                edited: true,
                report_meta: event.report_meta ? event.report_meta as ReportMeta : message.report_meta,
                petition_meta: event.petition_meta ? event.petition_meta as PetitionMeta : message.petition_meta,
              }
            : message
        ));
      }

      if (event.type === "message-deleted") {
        const id = event.message_id as string;
        const deletedIds = new Set(
          Array.isArray(event.deleted_ids) ? event.deleted_ids as string[] : [id]
        );
        setGalleryItems((previous) => previous.filter((item) => !deletedIds.has(item.id)));
        if (event.soft) {
          setMessages((previous) => {
            const hasReplies = previous.some((message) => message.reply_to === id);
            if (hasReplies) {
              return previous.map((message) =>
                message.id === id ? { ...message, deleted: true, text: deletedMessage, image: null } : message
              );
            }
            return previous.filter((message) => message.id !== id);
          });
        } else {
          removeTimelineThread("message", id);
        }
      }

      if (event.type === "messages-sync" && historyModeRef.current === "latest") {
        void (unifiedTimelineEnabled
          ? refreshUnifiedTimelineOnce()
          : refreshLatestTimeline()
        ).catch(() => {});
      }

      if (event.type === "reconnected") {
        const traceCycleId = typeof event.traceCycleId === "string" ? event.traceCycleId : null;
        settleTraceRequest(
          traceCycleId,
          synchronizeLiveSession(traceCycleId || undefined),
        );
      }

      if (event.type === "dm-new") {
        const dm = decorateMessageMedia(event.dm as Message);
        const viewingChannel = getViewingChannelId();
        if (dm.channel_id === viewingChannel) {
          upsertTimelineItems("dm", [{ ...dm, dm: true }]);
        }
      }

      if (event.type === "dm-deleted") {
        const dmId = event.dm_id as string;
        removeTimelineThread("dm", dmId);
      }

      if (event.type === "dm-threads-changed") {
        if (unifiedTimelineEnabled) {
          void refreshUnifiedTimelineOnce().catch(() => {});
          return;
        }
        const viewingChannel = getViewingChannelId();
        const requestId = ++dmRefreshRequestIdRef.current;
        void fetchDmThreads(viewingChannel)
          .then((data) => {
            if (
              requestId !== dmRefreshRequestIdRef.current
              || viewingChannel !== getViewingChannelId()
              || !Array.isArray(data.dm)
            ) return;
            setDmMessages(data.dm.map((message: Message) => ({ ...message, dm: true })));
          })
          .catch(() => {});
      }

      if (event.type === "freeze-change") {
        const isLiveFreeze = !!event.live;
        if (isLiveFreeze && inLiveModeRef.current) {
          setChannel((previous) => previous ? { ...previous, is_frozen: event.frozen ? 1 : 0 } : null);
        } else if (!isLiveFreeze && !inLiveModeRef.current) {
          setChannel((previous) => previous ? { ...previous, is_frozen: event.frozen ? 1 : 0 } : null);
          if (event.moderation && event.frozen) {
            setViewerModerationStatus("frozen");
          } else if (event.moderation && !event.frozen) {
            setViewerModerationStatus((previous) => previous === "frozen" ? null : previous);
          }
        }
        if (isOwner) refreshOwnerModeration();
      }

      if (event.type === "moderation-state-change" && !event.live) {
        setViewerModerationStatus(event.status === "frozen" ? "frozen" : null);
        if (isOwner) refreshOwnerModeration();
      }

      if (event.type === "profile-change") {
        const nextProfileImage = event.profile_image !== undefined
          ? decorateMediaUrl(event.profile_image as string | null)
          : undefined;
        const nextBackgroundImage = event.background_image !== undefined
          ? decorateProtectedMediaUrl(event.background_image as string | null)
          : undefined;
        updateRecentChannelAppearance(channelId, {
          ...(event.name ? { name: event.name as string } : {}),
          ...(nextProfileImage !== undefined ? { profileImage: nextProfileImage } : {}),
          ...(event.bubble_color && !localBubbleColor ? { bubbleColor: event.bubble_color as string } : {}),
        });
        patchChannelAppearance(channelId, {
          bubble_color: event.bubble_color as string | undefined,
          appearance_version: event.appearance_version as string | undefined,
          background_type: event.background_type as Channel["background_type"],
          background_color: event.background_color as string | null | undefined,
          background_image: event.background_image as string | null | undefined,
          background_overlay: event.background_overlay as number | undefined,
          background_blur: event.background_blur !== undefined
            ? event.background_blur ? 1 : 0
            : undefined,
        });
        setChannel((previous) => {
          if (!previous) return null;
          const updated = { ...previous };
          if (event.name) updated.name = event.name as string;
          if (nextProfileImage !== undefined) updated.profile_image = nextProfileImage;
          if (event.bubble_color) updated.bubble_color = event.bubble_color as string;
          if (event.appearance_version) updated.appearance_version = event.appearance_version as string;
          if (event.show_on_profile !== undefined) updated.show_on_profile = event.show_on_profile ? 1 : 0;
          if (event.background_type !== undefined) updated.background_type = event.background_type as Channel["background_type"];
          if (event.background_color !== undefined) updated.background_color = event.background_color as string | null;
          if (nextBackgroundImage !== undefined) updated.background_image = nextBackgroundImage;
          if (event.background_overlay !== undefined) updated.background_overlay = event.background_overlay as number;
          if (event.background_blur !== undefined) updated.background_blur = event.background_blur ? 1 : 0;
          return updated;
        });
      }

      if (event.type === "emoji-fx") {
        spawnEmoji(event.emoji as string, event.x as number, event.h as number);
      }

      if (event.type === "reaction-changed") {
        const msgId = event.message_id as string;
        const newReactions = event.reactions as string;
        pendingReactionUpdatesRef.current.set(msgId, newReactions);
        if (reactionFrameRef.current === null) {
          reactionFrameRef.current = requestAnimationFrame(() => {
            reactionFrameRef.current = null;
            const updates = new Map(pendingReactionUpdatesRef.current);
            pendingReactionUpdatesRef.current.clear();
            setMessages((previous) => {
              let changed = false;
              const next = previous.map((message) => {
                const reactions = updates.get(message.id);
                if (reactions === undefined || reactions === message.reactions) return message;
                changed = true;
                return { ...message, reactions };
              });
              return changed ? next : previous;
            });
          });
        }
      }

      if (event.type === "room-auth-failed") {
        clearRoomToken(channelId);
        if (!isOwner) {
          showPasscodeGate(roomAuthExpired, roomAuthExpired);
        }
      }

      if (event.type === "room-authenticated") {
        clearRoomAccessBanner();
      }

      if (event.type === "admin-auth-failed" && isOwner) {
        setBanner({ text: adminDataAuthFailed, color: "#d32f2f" });
      }

      if (event.type === "room-access-opened") {
        clearRoomAccessBanner();
        setPasscodeGate(null);
        void synchronizeLiveSession().catch(() => {});
      }

      if (event.type === "room-access-revoked") {
        clearRoomToken(channelId);
        if (!isOwner) {
          showPasscodeGate(passcodeChanged);
        }
      }

      if (event.type === "user-blocked") {
        const blockedUid = event.uid as string;
        if (blockedUid === uid) {
          setViewerBlocked(true);
        }
        if (isOwner) {
          setBlockedUsers((previous) => {
            if (previous.some((item) => item.uid === blockedUid)) return previous;
            return [...previous, { uid: blockedUid, reason: "" }];
          });
        }
      }

      if (event.type === "user-unblocked") {
        const unblockedUid = event.uid as string;
        if (unblockedUid === uid) {
          setViewerBlocked(false);
        }
        setBlockedUsers((previous) => previous.filter((item) => item.uid !== unblockedUid));
      }

      if (event.type === "petition-changed") {
        setPetitionEnabled(!!event.enabled);
      }

      if (event.type === "dm-toggle-changed") {
        setDmEnabled(!!event.enabled);
      }

      if (event.type === "live-ended") {
        const wasInLiveMode = endLiveSessionLocally({
          clearSeen: true,
          showEndedPopup: inLiveModeRef.current,
        });
        if (wasInLiveMode) {
          void loadNormalChannelData().catch(() => {});
        }
      }

      if (event.type === "live-started") {
        handleLiveStartedEvent({
          title: typeof event.title === "string" ? event.title : undefined,
          sessionId: typeof event.sessionId === "string" ? event.sessionId : "",
          expiresAt: typeof event.expiresAt === "string" ? event.expiresAt : null,
        });
      }

      if (event.type === "notice-changed") {
        const isLiveNotice = !!event.live;
        if (isLiveNotice && inLiveModeRef.current) {
          setActiveNotice((event.notice as string) || "");
        } else if (!isLiveNotice && !inLiveModeRef.current) {
          setActiveNotice((event.notice as string) || "");
        }
      }

      if (event.type === "rules-changed") {
        setChannel((previous) => previous ? { ...previous, notice: event.rules as string } : null);
      }

      if (event.type === "channel-deleted") {
        clearChannelLocalState(channelId);
        if (!isLoggedIn) removeRecentChannel(channelId);
        setShowChannelDeleted(true);
      }

      if (event.type === "emoji-presets-changed") {
        applyEmojiPresetsSnapshot(typeof event.emojis === "string" ? event.emojis : null);
      }
    });
  }, [
    subscribe,
    channelId,
    uid,
    isOwner,
    isLoggedIn,
    localBubbleColor,
    send,
    inLiveModeRef,
    historyModeRef,
    hasMoreNewerMessagesRef,
    isNearBottomRef,
    messagesEndRef,
    pendingReactionUpdatesRef,
    reactionFrameRef,
    applyInitData,
    showPasscodeGate,
    clearRoomAccessBanner,
    refreshOwnerModeration,
    loadNormalChannelData,
    endLiveSessionLocally,
    handleLiveStartedEvent,
    applyEmojiPresetsSnapshot,
    setMessages,
    upsertTimelineItems,
    removeTimelineThread,
    setNewerMessageCount,
    setGalleryItems,
    setChannel,
    setActiveNotice,
    setWelcomeConfig,
    setPetitionEnabled,
    setDmEnabled,
    setOwnerModeration,
    setViewerModerationStatus,
    setDmMessages,
    setPasscodeGate,
    setViewerBlocked,
    setBlockedUsers,
    setBanner,
    setShowChannelDeleted,
    getViewingChannelId,
    refreshLatestMessages,
    refreshLatestTimeline,
    refreshUnifiedTimelineOnce,
    unifiedTimelineEnabled,
    synchronizeLiveSession,
    deletedMessage,
    roomAuthExpired,
    passcodeChanged,
    adminDataAuthFailed,
  ]);

  useEffect(() => {
    let lastHidden = 0;
    const handler = () => {
      if (document.visibilityState === "hidden") {
        lastHidden = Date.now();
        return;
      }
      const hiddenDurationMs = Date.now() - lastHidden;
      if (!lastHidden) return;
      if (!connected) return;
      const shouldSynchronizeLive = liveActive || inLiveModeRef.current;
      const shouldRefreshMessages = hiddenDurationMs > 5 * 60 * 1000
        && historyModeRef.current !== "context";
      if (!shouldSynchronizeLive && !shouldRefreshMessages) return;
      const traceCycleId = startChatPerformanceCycle(channelId, "visibility-resume", {
        hiddenForMs: hiddenDurationMs,
      });
      const refresh = shouldSynchronizeLive
        ? synchronizeLiveSession(traceCycleId)
        : refreshLatestTimeline(traceCycleId);
      void refresh.then(
        () => completeChatPerformanceCycle(channelId, traceCycleId, "settled"),
        () => completeChatPerformanceCycle(channelId, traceCycleId, "failed"),
      );
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [
    channelId,
    connected,
    historyModeRef,
    inLiveModeRef,
    liveActive,
    refreshLatestTimeline,
    synchronizeLiveSession,
  ]);
}
