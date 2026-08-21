"use client";

import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { fetchInit, fetchOwnerModerationState } from "@/lib/api-chat";
import {
  completeChatPerformanceCycle,
  finishChatPerformanceRequest,
  startChatPerformanceCycle,
  startChatPerformanceRequest,
} from "@/lib/chat-performance";
import { recordAccountRecentChannel, updateCachedAccountRecentChannelVisit } from "@/lib/account-recent-channels";
import { normalizeBubbleColor } from "@/lib/bubble-color";
import { clearChannelLocalState, syncChannelInstance } from "@/lib/channel-local-state";
import {
  clearChannelBackground,
  readChannelAppearance,
  storeChannelAppearance,
} from "@/lib/channel-background-cache";
import { recordRecentChannel } from "@/lib/recent-channels";
import type { OwnerPlanState, ViewerPlanState } from "@/lib/owner-plan";
import { mergeServerMessageSnapshot } from "./chatMessageUtils";
import type { Message, MessagePageCursor } from "./chatTypes";
import type { Channel, InitData, PasscodeGateState } from "./chatViewTypes";
import type {
  ChatTimelineItem,
  UnifiedTimelineCursor,
} from "./chatTimelineState";

interface BannerState {
  text: string;
  color: string;
}

interface ApplyInitDataOptions {
  preserveHistory?: boolean;
  skipTimeline?: boolean;
}

interface UseChatChannelBootstrapArgs {
  channelId: string;
  channel: Channel | null;
  authUserId: string | null;
  isLoggedIn: boolean;
  isOwner: boolean;
  inLiveModeRef: MutableRefObject<boolean>;
  initRequestIdRef: MutableRefObject<number>;
  applyInitDataRef: MutableRefObject<(data: InitData, options?: ApplyInitDataOptions) => void>;
  applyEmojiPresetsSnapshot: (snapshot: string | null | undefined) => void;
  applyLiveSnapshot: (live: InitData["live"]) => void;
  setUid: Dispatch<SetStateAction<string>>;
  setChannel: Dispatch<SetStateAction<Channel | null>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setInitialPageStartCursor: Dispatch<SetStateAction<MessagePageCursor | null>>;
  setInitialPageEndCursor: Dispatch<SetStateAction<MessagePageCursor | null>>;
  setHistoryMode: Dispatch<SetStateAction<"latest" | "context">>;
  setNewerMessageCount: Dispatch<SetStateAction<number>>;
  setBlockedUsers: Dispatch<SetStateAction<{ uid: string; reason: string }[]>>;
  setViewerBlocked: Dispatch<SetStateAction<boolean>>;
  setViewerModerationStatus: Dispatch<SetStateAction<InitData["viewerModerationStatus"]>>;
  setViewerAccess: Dispatch<SetStateAction<InitData["viewerAccess"]>>;
  setUnifiedTimelineEnabled: (enabled: boolean) => void;
  applyUnifiedTimelineBootstrap: (
    items: ChatTimelineItem[],
    pageStartCursor: UnifiedTimelineCursor | null,
    pageEndCursor: UnifiedTimelineCursor | null,
    hasMoreBefore: boolean,
    preserveHistory: boolean,
  ) => void;
  setDmMessages: Dispatch<SetStateAction<Message[]>>;
  setActiveNotice: Dispatch<SetStateAction<string>>;
  setWelcomeConfig: Dispatch<SetStateAction<string>>;
  setPetitionEnabled: Dispatch<SetStateAction<boolean>>;
  setDmEnabled: Dispatch<SetStateAction<boolean>>;
  setOwnerModeration: Dispatch<SetStateAction<InitData["ownerModeration"] | undefined>>;
  setOwnerPlan: Dispatch<SetStateAction<OwnerPlanState | null>>;
  setViewerPlan: Dispatch<SetStateAction<ViewerPlanState | null>>;
  setLocalBubbleColor: Dispatch<SetStateAction<string | null>>;
  setBanner: Dispatch<SetStateAction<BannerState | null>>;
  setPasscodeGate: Dispatch<SetStateAction<PasscodeGateState | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setShowChannelDeleted: Dispatch<SetStateAction<boolean>>;
  setReportsChannelView: (enabled: boolean) => void;
  text: {
    adminDataAuthFailed: string;
    roomAuthExpired: string;
    passcodeChanged: string;
  };
}

interface UseChatChannelBootstrapResult {
  applyInitData: (data: InitData, options?: ApplyInitDataOptions) => void;
  loadNormalChannelData: () => Promise<void>;
  loadLiveChannelData: () => Promise<void>;
  refreshOwnerModeration: () => void;
  showPasscodeGate: (notice?: string, bannerText?: string) => void;
  clearRoomAccessBanner: () => void;
}

function reconcileBubbleOverride(
  channelId: string,
  input: {
    previousAppearanceVersion?: string | null;
    previousBubbleColor?: string | null;
    nextAppearanceVersion?: string | null;
    nextBubbleColor?: string | null;
    personalBubbleColorEnabled: boolean;
  },
  setLocalBubbleColor: Dispatch<SetStateAction<string | null>>,
): { bubbleColor: string | null; clearedStaleOverride: boolean } {
  if (typeof window === "undefined") {
    return { bubbleColor: null, clearedStaleOverride: false };
  }
  if (!input.personalBubbleColorEnabled) {
    setLocalBubbleColor(null);
    return { bubbleColor: null, clearedStaleOverride: false };
  }

  const storedBubbleColor = localStorage.getItem(`bubbleColor_${channelId}`);
  const normalizedStoredBubbleColor = storedBubbleColor
    ? normalizeBubbleColor(storedBubbleColor)
    : null;
  if (storedBubbleColor && normalizedStoredBubbleColor && normalizedStoredBubbleColor !== storedBubbleColor) {
    localStorage.setItem(`bubbleColor_${channelId}`, normalizedStoredBubbleColor);
  }

  const appearanceChanged = Boolean(
    input.previousAppearanceVersion
    && input.nextAppearanceVersion
    && input.previousAppearanceVersion !== input.nextAppearanceVersion
  );
  const previousBubbleColor = normalizeBubbleColor(input.previousBubbleColor);
  const nextBubbleColor = normalizeBubbleColor(input.nextBubbleColor);
  if (
    appearanceChanged
    && normalizedStoredBubbleColor
    && normalizedStoredBubbleColor === previousBubbleColor
    && normalizedStoredBubbleColor !== nextBubbleColor
  ) {
    localStorage.removeItem(`bubbleColor_${channelId}`);
    setLocalBubbleColor(null);
    return { bubbleColor: null, clearedStaleOverride: true };
  }

  return {
    bubbleColor: normalizedStoredBubbleColor,
    clearedStaleOverride: false,
  };
}

export function useChatChannelBootstrap({
  channelId,
  channel,
  authUserId,
  isLoggedIn,
  isOwner,
  inLiveModeRef,
  initRequestIdRef,
  applyInitDataRef,
  applyEmojiPresetsSnapshot,
  applyLiveSnapshot,
  setUid,
  setChannel,
  setMessages,
  setInitialPageStartCursor,
  setInitialPageEndCursor,
  setHistoryMode,
  setNewerMessageCount,
  setBlockedUsers,
  setViewerBlocked,
  setViewerModerationStatus,
  setViewerAccess,
  setUnifiedTimelineEnabled,
  applyUnifiedTimelineBootstrap,
  setDmMessages,
  setActiveNotice,
  setWelcomeConfig,
  setPetitionEnabled,
  setDmEnabled,
  setOwnerModeration,
  setOwnerPlan,
  setViewerPlan,
  setLocalBubbleColor,
  setBanner,
  setPasscodeGate,
  setLoading,
  setShowChannelDeleted,
  setReportsChannelView,
  text,
}: UseChatChannelBootstrapArgs): UseChatChannelBootstrapResult {
  const applyInitData = useCallback((data: InitData, options?: ApplyInitDataOptions) => {
    if (
      data.unifiedTimelineEnabled === true
      && (
        data.unifiedTimeline?.contract_version !== 1
        || !Array.isArray(data.unifiedTimeline.items)
      )
    ) {
      throw new Error("Unsupported unified timeline bootstrap contract");
    }

    if (typeof data.anonymousUid === "string" && data.anonymousUid) {
      setUid(data.anonymousUid);
    }

    const channelWasRecreated = syncChannelInstance(channelId, data.channel.instance_id);
    if (channelWasRecreated) {
      setLocalBubbleColor(null);
      document.documentElement.style.setProperty(
        "--bubble-sent",
        normalizeBubbleColor(data.channel.bubble_color),
      );
    }

    const channelBubbleColor = normalizeBubbleColor(data.channel.bubble_color);
    const cachedAppearance = readChannelAppearance(channelId);
    const previousAppearanceVersion = cachedAppearance?.appearanceVersion || channel?.appearance_version || null;
    const previousBubbleColor = cachedAppearance?.bubbleColor || channel?.bubble_color || null;
    const {
      bubbleColor: savedBubbleColor,
      clearedStaleOverride,
    } = reconcileBubbleOverride(channelId, {
      previousAppearanceVersion,
      previousBubbleColor,
      nextAppearanceVersion: data.channel.appearance_version,
      nextBubbleColor: data.channel.bubble_color,
      personalBubbleColorEnabled: data.viewerPlan?.features.personalBubbleColor === true,
    }, setLocalBubbleColor);
    if (
      !cachedAppearance
      || cachedAppearance.instanceId !== data.channel.instance_id
      || cachedAppearance.appearanceVersion !== data.channel.appearance_version
    ) {
      storeChannelAppearance(channelId, data.channel);
    }
    setChannel({ ...data.channel, bubble_color: channelBubbleColor });
    if (clearedStaleOverride || data.viewerPlan?.features.personalBubbleColor !== true) {
      document.documentElement.style.setProperty("--bubble-sent", channelBubbleColor);
    }

    if (isLoggedIn) {
      if (authUserId) {
        updateCachedAccountRecentChannelVisit(authUserId, {
          id: channelId,
          name: data.channel.name,
          profileImage: data.channel.profile_image,
          bubbleColor: savedBubbleColor || channelBubbleColor,
          hasPasscode: data.hasPasscode === true,
          ownerName: data.channel.owner_name || "",
          ownerUid: data.channel.owner_uid,
        });
      }
      void recordAccountRecentChannel(channelId)
        .then(({ record }) => {
          if (data.viewerPlan?.features.personalBubbleColor !== true) return;
          if (!record?.bubble_color) return;
          const accountBubbleColor = normalizeBubbleColor(record.bubble_color);
          if (
            clearedStaleOverride
            && previousBubbleColor
            && accountBubbleColor === normalizeBubbleColor(previousBubbleColor)
            && accountBubbleColor !== channelBubbleColor
          ) {
            return;
          }
          setLocalBubbleColor(accountBubbleColor);
          localStorage.setItem(`bubbleColor_${channelId}`, accountBubbleColor);
          document.documentElement.style.setProperty("--bubble-sent", accountBubbleColor);
        })
        .catch(() => {
          // A temporary sync failure must not block channel entry.
        });
    } else {
      recordRecentChannel({
        id: channelId,
        name: data.channel.name,
        profileImage: data.channel.profile_image,
        bubbleColor: savedBubbleColor || channelBubbleColor,
        hasPasscode: data.hasPasscode === true,
        ownerName: data.channel.owner_name || "",
      });
    }

    const unifiedTimeline = data.unifiedTimelineEnabled === true
      && data.unifiedTimeline?.contract_version === 1
      ? data.unifiedTimeline
      : null;
    setUnifiedTimelineEnabled(Boolean(unifiedTimeline));
    if (unifiedTimeline && !options?.skipTimeline) {
      applyUnifiedTimelineBootstrap(
        unifiedTimeline.items,
        unifiedTimeline.page_start_cursor,
        unifiedTimeline.page_end_cursor,
        unifiedTimeline.has_more,
        options?.preserveHistory === true,
      );
      if (!options?.preserveHistory) {
        setHistoryMode("latest");
        setNewerMessageCount(0);
      }
    } else if (!unifiedTimeline) {
      if (options?.preserveHistory) {
        setMessages((previous) => mergeServerMessageSnapshot(previous, data.messages || []));
      } else {
        setMessages(data.messages || []);
        setInitialPageStartCursor(data.page_start_cursor || null);
        setInitialPageEndCursor(data.page_end_cursor || null);
        setHistoryMode("latest");
        setNewerMessageCount(0);
      }
      setDmMessages((data.dm || []).map((dm) => ({ ...dm, dm: true })));
    }
    setBlockedUsers(data.blocked || []);
    setViewerBlocked(data.viewerBlocked ?? false);
    setViewerModerationStatus(data.viewerModerationStatus ?? null);
    setViewerAccess(data.viewerAccess ?? "standard");
    setReportsChannelView(Boolean(data.isReportsChannel));
    setActiveNotice(data.bannerNotice || "");
    setWelcomeConfig(data.welcomeConfig || "");
    setPetitionEnabled(data.petitionEnabled ?? true);
    setDmEnabled(data.dmEnabled ?? true);
    setOwnerModeration(data.ownerModeration);
    setViewerPlan(data.viewerPlan || null);

    if (data.adminDataStatus === "unauthorized") {
      setBanner({ text: text.adminDataAuthFailed, color: "#d32f2f" });
    }

    applyEmojiPresetsSnapshot(data.emojiPresets);
    applyLiveSnapshot(data.live);
  }, [
    applyEmojiPresetsSnapshot,
    applyUnifiedTimelineBootstrap,
    applyLiveSnapshot,
    authUserId,
    channel,
    channelId,
    isLoggedIn,
    setActiveNotice,
    setBanner,
    setBlockedUsers,
    setChannel,
    setDmEnabled,
    setDmMessages,
    setHistoryMode,
    setInitialPageEndCursor,
    setInitialPageStartCursor,
    setLocalBubbleColor,
    setMessages,
    setNewerMessageCount,
    setOwnerModeration,
    setViewerPlan,
    setPetitionEnabled,
    setReportsChannelView,
    setUid,
    setViewerAccess,
    setViewerBlocked,
    setViewerModerationStatus,
    setUnifiedTimelineEnabled,
    setWelcomeConfig,
    text.adminDataAuthFailed,
  ]);

  useEffect(() => {
    applyInitDataRef.current = applyInitData;
  }, [applyInitData, applyInitDataRef]);

  const loadNormalChannelData = useCallback(async () => {
    const data = await fetchInit(channelId) as InitData;
    applyInitData(data);
  }, [applyInitData, channelId]);

  const loadLiveChannelData = useCallback(async () => {
    setMessages([]);
    setDmMessages([]);
    setActiveNotice("");
    const data = await fetchInit(`${channelId}_live`) as InitData;
    applyInitData(data);
  }, [applyInitData, channelId, setActiveNotice, setDmMessages, setMessages]);

  const refreshOwnerModeration = useCallback(() => {
    if (!isOwner) return;
    const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
    fetchOwnerModerationState(fetchChannel).then((data) => {
      const frozenState = data.channel?.is_frozen;
      if (data.channel) {
        const previousChannel = channel;
        const {
          bubbleColor: nextLocalBubbleColor,
        } = reconcileBubbleOverride(channelId, {
          previousAppearanceVersion: previousChannel?.appearance_version,
          previousBubbleColor: previousChannel?.bubble_color,
          nextAppearanceVersion: data.channel?.appearance_version,
          nextBubbleColor: data.channel?.bubble_color,
          personalBubbleColorEnabled: data.ownerPlan?.hasPlus === true,
        }, setLocalBubbleColor);
        const nextChannel = previousChannel ? {
          ...previousChannel,
          ...data.channel,
          bubble_color: data.channel.bubble_color
            ? normalizeBubbleColor(data.channel.bubble_color)
            : previousChannel.bubble_color,
          is_frozen: frozenState ?? previousChannel.is_frozen,
        } : null;
        if (nextChannel) {
          storeChannelAppearance(channelId, nextChannel);
          if (!nextLocalBubbleColor && nextChannel.bubble_color) {
            document.documentElement.style.setProperty("--bubble-sent", nextChannel.bubble_color);
          }
          setChannel(nextChannel);
        }
      } else if (frozenState !== undefined) {
        setChannel((previous) => previous ? { ...previous, is_frozen: frozenState } : previous);
      }
      setOwnerModeration(data.ownerModeration);
      setOwnerPlan(data.ownerPlan || null);
    }).catch(() => {});
  }, [channel, channelId, inLiveModeRef, isOwner, setChannel, setLocalBubbleColor, setOwnerModeration, setOwnerPlan]);

  useEffect(() => {
    if (!isOwner) {
      setOwnerPlan(null);
      return;
    }
    refreshOwnerModeration();
  }, [isOwner, refreshOwnerModeration, setOwnerPlan]);

  useEffect(() => {
    const shouldResumeLive =
      localStorage.getItem(`inLiveMode_${channelId}`) === "true" &&
      localStorage.getItem(`liveActive_${channelId}`) === "true";
    const initChannel = shouldResumeLive ? `${channelId}_live` : channelId;
    const requestId = ++initRequestIdRef.current;
    const traceCycleId = startChatPerformanceCycle(channelId, "bootstrap", {
      resumedLive: initChannel !== channelId,
    });

    startChatPerformanceRequest(channelId, traceCycleId, "init");
    fetchInit(initChannel)
      .then(async (data: InitData) => {
        finishChatPerformanceRequest(channelId, traceCycleId, "init");
        if (requestId !== initRequestIdRef.current) {
          completeChatPerformanceCycle(channelId, traceCycleId, "superseded");
          return;
        }
        if (typeof data.anonymousUid === "string" && data.anonymousUid) {
          setUid(data.anonymousUid);
        }

        if (data.hasPasscode && !data.messages && !data.unifiedTimeline) {
          clearChannelBackground(channelId);
          setPasscodeGate({
            name: data.channel.name,
            profile_image: data.channel.profile_image,
            bubble_color: normalizeBubbleColor(data.channel.bubble_color),
            passcodeHint: data.passcodeHint,
          });
          setLoading(false);
          completeChatPerformanceCycle(channelId, traceCycleId, "passcode-gated");
          return;
        }

        setPasscodeGate(null);
        applyInitData(data);

        if (!data.live?.active && initChannel !== channelId) {
          startChatPerformanceRequest(channelId, traceCycleId, "init");
          const normalData = await fetchInit(channelId) as InitData;
          finishChatPerformanceRequest(channelId, traceCycleId, "init");
          if (requestId !== initRequestIdRef.current) {
            completeChatPerformanceCycle(channelId, traceCycleId, "superseded");
            return;
          }
          applyInitData(normalData);
        }

        setLoading(false);
        completeChatPerformanceCycle(channelId, traceCycleId, "settled");
      })
      .catch((error) => {
        finishChatPerformanceRequest(channelId, traceCycleId, "init");
        if (requestId !== initRequestIdRef.current) {
          completeChatPerformanceCycle(channelId, traceCycleId, "superseded");
          return;
        }
        console.error(error);
        if (error instanceof Error && error.message.includes("Init failed: 404")) {
          clearChannelLocalState(channelId);
          setShowChannelDeleted(true);
        }
        setLoading(false);
        completeChatPerformanceCycle(channelId, traceCycleId, "failed");
      });
    return () => {
      if (initRequestIdRef.current === requestId) {
        initRequestIdRef.current += 1;
      }
      completeChatPerformanceCycle(channelId, traceCycleId, "superseded");
    };
  }, [
    applyInitData,
    channelId,
    initRequestIdRef,
    setLoading,
    setPasscodeGate,
    setShowChannelDeleted,
    setUid,
  ]);

  const showPasscodeGate = useCallback((notice?: string, bannerText?: string) => {
    const fallbackGate = {
      name: channel?.name || "",
      profile_image: channel?.profile_image || null,
      bubble_color: normalizeBubbleColor(channel?.bubble_color),
      passcodeHint: channel?.passcode_hint || "",
      notice,
    };

    const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
    fetchInit(fetchChannel).then((data: InitData) => {
      if (data.hasPasscode && !data.messages && !data.unifiedTimeline) {
        setPasscodeGate({
          name: data.channel.name,
          profile_image: data.channel.profile_image,
          bubble_color: normalizeBubbleColor(data.channel.bubble_color),
          passcodeHint: data.passcodeHint,
          notice,
        });
        return;
      }
      setPasscodeGate(null);
      applyInitData(data);
    }).catch(() => {
      setPasscodeGate(fallbackGate);
    });

    if (bannerText) {
      setBanner({ text: bannerText, color: "#d32f2f" });
    }
  }, [applyInitData, channel, channelId, inLiveModeRef, setBanner, setPasscodeGate]);

  const clearRoomAccessBanner = useCallback(() => {
    setBanner((current) => {
      if (!current) return current;
      if (current.text === text.roomAuthExpired || current.text === text.passcodeChanged) {
        return null;
      }
      return current;
    });
  }, [setBanner, text.passcodeChanged, text.roomAuthExpired]);

  return {
    applyInitData,
    loadNormalChannelData,
    loadLiveChannelData,
    refreshOwnerModeration,
    showPasscodeGate,
    clearRoomAccessBanner,
  };
}
