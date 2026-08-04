"use client";

import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { fetchInit } from "@/lib/api";
import { recordAccountRecentChannel } from "@/lib/account-recent-channels";
import { clearChannelLocalState, syncChannelInstance } from "@/lib/channel-local-state";
import { recordRecentChannel } from "@/lib/recent-channels";
import type { Message } from "./chatTypes";
import type { Channel, InitData, PasscodeGateState } from "./chatViewTypes";

interface BannerState {
  text: string;
  color: string;
}

interface UseChatChannelBootstrapArgs {
  channelId: string;
  channel: Channel | null;
  isLoggedIn: boolean;
  isOwner: boolean;
  inLiveModeRef: MutableRefObject<boolean>;
  initRequestIdRef: MutableRefObject<number>;
  applyInitDataRef: MutableRefObject<(data: InitData) => void>;
  applyEmojiPresetsSnapshot: (snapshot: string | null | undefined) => void;
  applyLiveSnapshot: (live: InitData["live"]) => void;
  setUid: Dispatch<SetStateAction<string>>;
  setChannel: Dispatch<SetStateAction<Channel | null>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setHistoryMode: Dispatch<SetStateAction<"latest" | "context">>;
  setNewerMessageCount: Dispatch<SetStateAction<number>>;
  setBlockedUsers: Dispatch<SetStateAction<{ uid: string; reason: string }[]>>;
  setViewerBlocked: Dispatch<SetStateAction<boolean>>;
  setViewerModerationStatus: Dispatch<SetStateAction<InitData["viewerModerationStatus"]>>;
  setViewerAccess: Dispatch<SetStateAction<InitData["viewerAccess"]>>;
  setDmMessages: Dispatch<SetStateAction<Message[]>>;
  setActiveNotice: Dispatch<SetStateAction<string>>;
  setWelcomeConfig: Dispatch<SetStateAction<string>>;
  setPetitionEnabled: Dispatch<SetStateAction<boolean>>;
  setDmEnabled: Dispatch<SetStateAction<boolean>>;
  setOwnerModeration: Dispatch<SetStateAction<InitData["ownerModeration"] | undefined>>;
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
  applyInitData: (data: InitData) => void;
  loadNormalChannelData: () => Promise<void>;
  loadLiveChannelData: () => Promise<void>;
  refreshOwnerModeration: () => void;
  showPasscodeGate: (notice?: string, bannerText?: string) => void;
  clearRoomAccessBanner: () => void;
}

export function useChatChannelBootstrap({
  channelId,
  channel,
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
  setHistoryMode,
  setNewerMessageCount,
  setBlockedUsers,
  setViewerBlocked,
  setViewerModerationStatus,
  setViewerAccess,
  setDmMessages,
  setActiveNotice,
  setWelcomeConfig,
  setPetitionEnabled,
  setDmEnabled,
  setOwnerModeration,
  setLocalBubbleColor,
  setBanner,
  setPasscodeGate,
  setLoading,
  setShowChannelDeleted,
  setReportsChannelView,
  text,
}: UseChatChannelBootstrapArgs): UseChatChannelBootstrapResult {
  const applyInitData = useCallback((data: InitData) => {
    if (typeof data.anonymousUid === "string" && data.anonymousUid) {
      setUid(data.anonymousUid);
    }

    const channelWasRecreated = syncChannelInstance(channelId, data.channel.instance_id);
    if (channelWasRecreated) {
      setLocalBubbleColor(null);
      document.documentElement.style.setProperty(
        "--bubble-sent",
        data.channel.bubble_color || "#3b8df0",
      );
    }

    setChannel(data.channel);

    const savedBubbleColor = localStorage.getItem(`bubbleColor_${channelId}`);
    if (isLoggedIn) {
      void recordAccountRecentChannel(channelId)
        .then(({ record }) => {
          if (!record?.bubble_color) return;
          setLocalBubbleColor(record.bubble_color);
          localStorage.setItem(`bubbleColor_${channelId}`, record.bubble_color);
          document.documentElement.style.setProperty("--bubble-sent", record.bubble_color);
        })
        .catch(() => {
          // A temporary sync failure must not block channel entry.
        });
    } else {
      recordRecentChannel({
        id: channelId,
        name: data.channel.name,
        profileImage: data.channel.profile_image,
        bubbleColor: savedBubbleColor || data.channel.bubble_color || "#3b8df0",
        hasPasscode: data.hasPasscode === true,
        ownerName: data.channel.owner_name || "",
      });
    }

    setMessages(data.messages || []);
    setHistoryMode("latest");
    setNewerMessageCount(0);
    setBlockedUsers(data.blocked || []);
    setViewerBlocked(data.viewerBlocked ?? false);
    setViewerModerationStatus(data.viewerModerationStatus ?? null);
    setViewerAccess(data.viewerAccess ?? "standard");
    setReportsChannelView(Boolean(data.isReportsChannel));
    setDmMessages((data.dm || []).map((dm) => ({ ...dm, dm: true })));
    setActiveNotice(data.bannerNotice || "");
    setWelcomeConfig(data.welcomeConfig || "");
    setPetitionEnabled(data.petitionEnabled ?? true);
    setDmEnabled(data.dmEnabled ?? true);
    setOwnerModeration(data.ownerModeration);

    if (data.adminDataStatus === "unauthorized") {
      setBanner({ text: text.adminDataAuthFailed, color: "#d32f2f" });
    }

    applyEmojiPresetsSnapshot(data.emojiPresets);
    applyLiveSnapshot(data.live);
  }, [
    applyEmojiPresetsSnapshot,
    applyLiveSnapshot,
    channelId,
    isLoggedIn,
    setActiveNotice,
    setBanner,
    setBlockedUsers,
    setChannel,
    setDmEnabled,
    setDmMessages,
    setHistoryMode,
    setLocalBubbleColor,
    setMessages,
    setNewerMessageCount,
    setOwnerModeration,
    setPetitionEnabled,
    setReportsChannelView,
    setUid,
    setViewerAccess,
    setViewerBlocked,
    setViewerModerationStatus,
    setWelcomeConfig,
    text.adminDataAuthFailed,
  ]);

  applyInitDataRef.current = applyInitData;

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
    fetchInit(fetchChannel).then((data: InitData) => {
      if (data.channel) {
        setChannel((previous) => previous ? { ...previous, is_frozen: data.channel.is_frozen } : data.channel);
      }
      setOwnerModeration(data.ownerModeration);
    }).catch(() => {});
  }, [channelId, inLiveModeRef, isOwner, setChannel, setOwnerModeration]);

  useEffect(() => {
    const shouldResumeLive =
      localStorage.getItem(`inLiveMode_${channelId}`) === "true" &&
      localStorage.getItem(`liveActive_${channelId}`) === "true";
    const initChannel = shouldResumeLive ? `${channelId}_live` : channelId;
    const requestId = ++initRequestIdRef.current;

    fetchInit(initChannel)
      .then(async (data: InitData) => {
        if (requestId !== initRequestIdRef.current) return;
        if (typeof data.anonymousUid === "string" && data.anonymousUid) {
          setUid(data.anonymousUid);
        }

        if (data.hasPasscode && !data.messages) {
          setPasscodeGate({
            name: data.channel.name,
            profile_image: data.channel.profile_image,
            bubble_color: data.channel.bubble_color,
            passcodeHint: data.passcodeHint,
          });
          setLoading(false);
          return;
        }

        setPasscodeGate(null);
        applyInitData(data);

        if (!data.live?.active && initChannel !== channelId) {
          const normalData = await fetchInit(channelId) as InitData;
          if (requestId !== initRequestIdRef.current) return;
          applyInitData(normalData);
        }

        setLoading(false);
      })
      .catch((error) => {
        if (requestId !== initRequestIdRef.current) return;
        console.error(error);
        if (error instanceof Error && error.message.includes("Init failed: 404")) {
          clearChannelLocalState(channelId);
          setShowChannelDeleted(true);
        }
        setLoading(false);
      });
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
      bubble_color: channel?.bubble_color || "#3b8df0",
      passcodeHint: channel?.passcode_hint || "",
      notice,
    };

    const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
    fetchInit(fetchChannel).then((data: InitData) => {
      if (data.hasPasscode && !data.messages) {
        setPasscodeGate({
          name: data.channel.name,
          profile_image: data.channel.profile_image,
          bubble_color: data.channel.bubble_color,
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
