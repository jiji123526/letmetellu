"use client";

import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { clearRoomToken, decorateMediaUrl, decorateMessageMedia, decorateProtectedMediaUrl, fetchInit, fetchOwnerChannels, getStoredUid, adminAction, fetchMessages } from "@/lib/api";
import { useRealtime } from "@/hooks/useRealtime";
import { useAuth } from "@/hooks/useAuth";
import { useAutoUpdate } from "@/hooks/useAutoUpdate";
import { useLocale } from "@/hooks/useLocale";
import { ContextMenu } from "./ContextMenu";
import { ReplyBar } from "./ReplyBar";
import { ScrollToBottom } from "./ScrollToBottom";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmojiBar, spawnEmoji } from "./EmojiBar";
import { PasscodeOverlay } from "./PasscodeOverlay";
import { removeRecentChannel, updateRecentChannelAppearance } from "@/lib/recent-channels";
import { clearChannelLocalState } from "@/lib/channel-local-state";
import { useChatHistoryNavigation } from "./useChatHistoryNavigation";
import { useChatModeration } from "./useChatModeration";
import {
  mergeServerMessageSnapshot,
} from "./chatMessageUtils";
import type { Message, PetitionMeta, ReportMeta } from "./chatTypes";
import type { Channel, InitData, PasscodeGateState } from "./chatViewTypes";
import { useChatLiveSession } from "./useChatLiveSession";
import { useChatReportsSearch } from "./useChatReportsSearch";
import { useChatComposerState, type PendingPhoto } from "./useChatComposerState";
import { useChatMessageMutations } from "./useChatMessageMutations";
import { useChatInteractions } from "./useChatInteractions";
import { useChatAdminChannelActions } from "./useChatAdminChannelActions";
import { useChatChannelSettings } from "./useChatChannelSettings";
import { ChatViewOverlays } from "./ChatViewOverlays";
import { useChatContextMenuActions } from "./useChatContextMenuActions";
import { useChatOverlayCallbacks } from "./useChatOverlayCallbacks";
import { ChatViewTopChrome } from "./ChatViewTopChrome";
import { ChatViewMessagePane } from "./ChatViewMessagePane";
import { useChatChannelBootstrap } from "./useChatChannelBootstrap";

function getInitialUid(): string {
  if (typeof window === "undefined") return "ssr";
  return getStoredUid() || "anon";
}

function compressImage(file: File, maxWidth: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width, h = img.height;
      if (w > maxWidth) { h = (maxWidth / w) * h; w = maxWidth; }
      w = Math.round(w);
      h = Math.round(h);
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => resolve({ blob: blob!, width: w, height: h }), "image/jpeg", quality);
    };
    img.src = URL.createObjectURL(file);
  });
}

function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}

// Skeleton loading
function SkeletonLoading() {
  const rows = [
    { side: "recv", width: "25%" }, { side: "recv", width: "45%" },
    { side: "sent", width: "35%" }, { side: "recv", width: "40%" },
    { side: "sent", width: "25%" }, { side: "sent", width: "55%" },
    { side: "recv", width: "30%" }, { side: "sent", width: "40%" },
    { side: "recv", width: "55%" }, { side: "sent", width: "25%" },
  ];
  return (
    <div className="flex flex-col gap-[3px] p-3 animate-pulse">
      {rows.map((row, i) => (
        <div key={i} className={`flex ${row.side === "sent" ? "justify-end" : "justify-start"}`}>
          <div
            className="rounded-[18px]"
            style={{
              width: row.width,
              height: "calc(var(--bubble-font-size) * 1.38 + 20px)",
              background: row.side === "sent" ? "var(--bubble-sent)" : "var(--gray-bubble)",
              opacity: row.side === "sent" ? 0.5 : 1,
            }}
          />
        </div>
      ))}
    </div>
  );
}

export function ChatView({ channelId }: { channelId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<{ uid: string; reason: string }[]>([]);
  const [viewerBlocked, setViewerBlocked] = useState(false);
  const [dmMessages, setDmMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [passcodeGate, setPasscodeGate] = useState<PasscodeGateState | null>(null);
  const [uid, setUid] = useState(getInitialUid);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [historyMode, setHistoryMode] = useState<"latest" | "context">("latest");
  const [newerMessageCount, setNewerMessageCount] = useState(0);
  const [galleryItems, setGalleryItems] = useState<{ id: string; image: string; created_at: string }[]>([]);
  const [galleryHasMore, setGalleryHasMore] = useState(true);
  const galleryLoading = useRef(false);
  const [showChannelDeleted, setShowChannelDeleted] = useState(false);
  const [ownerChannelCount, setOwnerChannelCount] = useState(0);
  const { isOwner, isLoggedIn, userId: authUserId } = useAuth(channel?.owner_uid);
  const { t, locale, timeZone } = useLocale();
  const [manualAdmin] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("isAdmin") === "true";
  });
  const isAdmin = isOwner || manualAdmin;
  const [adminViewAsUser, setAdminViewAsUser] = useState(false);

  useEffect(() => {
    if (!channel?.id) return;
    let active = true;
    fetchOwnerChannels(channelId)
      .then((data) => {
        if (active) {
          setOwnerChannelCount((data.channels || []).length);
        }
      })
      .catch(() => { if (active) setOwnerChannelCount(0); });
    return () => { active = false; };
  }, [channel?.id, channel?.show_on_profile, channelId]);
  const [activeNotice, setActiveNotice] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(`activeNotice_${channelId}`) || "";
  });
  const [welcomeConfig, setWelcomeConfig] = useState("");
  const [petitionEnabled, setPetitionEnabled] = useState(true);
  const [dmEnabled, setDmEnabled] = useState(true);
  const [ownerModeration, setOwnerModeration] = useState<InitData["ownerModeration"]>();
  const [viewerModerationStatus, setViewerModerationStatus] = useState<InitData["viewerModerationStatus"]>(null);
  const [viewerAccess, setViewerAccess] = useState<InitData["viewerAccess"]>("standard");
  const [localBubbleColor, setLocalBubbleColor] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(`bubbleColor_${channelId}`);
  });
  const [plusMenu, setPlusMenu] = useState<DOMRect | null>(null);
  const [dmMode, setDmMode] = useState(false);
  const [banner, setBanner] = useState<{ text: string; color: string } | null>(null);
  const [showModerationPetitionDialog, setShowModerationPetitionDialog] = useState(false);
  useEffect(() => {
    setViewerAccess("standard");
  }, [channelId]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const initRequestIdRef = useRef(0);
  const initialScrollDoneRef = useRef(false);
  const pendingReactionUpdatesRef = useRef(new Map<string, string>());
  const reactionFrameRef = useRef<number | null>(null);
  const applyInitDataRef = useRef<(data: InitData) => void>(() => {});

  const processPendingPhoto = useCallback(async (file: File): Promise<PendingPhoto> => {
    if (file.type === "image/gif") {
      const previewUrl = URL.createObjectURL(file);
      const dims = await getImageDimensions(file);
      return { blob: file, previewUrl, width: dims.width, height: dims.height };
    }

    const { blob, width, height } = await compressImage(file, 1200, 0.8);
    const previewUrl = URL.createObjectURL(blob);
    return { blob, previewUrl, width, height };
  }, []);

  useEffect(() => () => {
    if (reactionFrameRef.current !== null) {
      cancelAnimationFrame(reactionFrameRef.current);
    }
  }, []);

  useEffect(() => {
    const handleIdentityChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ uid: string }>).detail;
      if (detail?.uid) setUid(detail.uid);
    };
    window.addEventListener("anonymous-identity-changed", handleIdentityChanged);
    return () => window.removeEventListener("anonymous-identity-changed", handleIdentityChanged);
  }, []);

  const { connected, presence, liveCount, subscribe, send } = useRealtime(channelId, uid);
  const effectiveAdmin = isAdmin && !adminViewAsUser;
  const {
    input,
    replyingTo,
    editingMsg,
    pendingPhotos,
    setReplyingTo,
    setPendingPhotos,
    handleInputChange,
    resetInput,
    restoreInput,
    focusTextarea,
    clearReplyingTo,
    openEditDialog,
    closeEditDialog,
    handlePhotoSelect,
    removePendingPhoto,
    consumeComposerState,
  } = useChatComposerState({
    textareaRef,
    processPhotoFile: processPendingPhoto,
  });
  const {
    contextMenu,
    fullViewImage,
    expandedPost,
    emojiPicker,
    openExpandedPost,
    closeExpandedPost,
    openContextMenu,
    closeContextMenu,
    handleTouchStart,
    handleTouchEnd,
    openMessageImage,
    openGalleryImage,
    closeFullViewImage,
    openEmojiPicker,
    closeEmojiPicker,
  } = useChatInteractions({
    effectiveAdmin,
    uid,
    messagesContainerRef,
  });

  // Auto-reload when new version is deployed (only when user has no draft)
  useAutoUpdate(!!(input || pendingPhotos.length > 0 || replyingTo || dmMode));

  const handleLiveModePresenceChange = useCallback((nextInLiveMode: boolean) => {
    send({ type: nextInLiveMode ? "join-live" : "leave-live" });
  }, [send]);

  const fetchLiveState = useCallback(() => {
    return fetchInit(`${channelId}_live`) as Promise<InitData>;
  }, [channelId]);

  const handleExpiredLiveEnded = useCallback(async () => {
    const normalData = await fetchInit(channelId) as InitData;
    applyInitDataRef.current(normalData);
  }, [channelId]);

  const {
    liveActive,
    inLiveMode,
    liveTitle,
    liveCountdownNotice,
    showLivePopup,
    showLiveEnded,
    showLiveTitlePrompt,
    showEndLiveConfirm,
    emojiPresets,
    liveLastMinuteBannerText,
    liveLastMinuteLabel,
    inLiveModeRef,
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
  } = useChatLiveSession({
    channelId,
    locale,
    texts: {
      liveTitle: t("liveTitle"),
      liveCountdownBanner: t("liveCountdownBanner"),
      liveCountdownLabel: t("liveCountdownLabel"),
    },
    fetchLiveState,
    onExpiredLiveEnded: handleExpiredLiveEnded,
    onLiveModePresenceChange: handleLiveModePresenceChange,
  });
  const {
    headerMenu,
    showSettings,
    showNotice,
    showGallery,
    showLinks,
    showAdminPanel,
    showOwnerChannels,
    showChannelReportDialog,
    showNoticeEdit,
    showEmojiPreset,
    submittingChannelReport,
    openHeaderMenu,
    closeHeaderMenu,
    openSettings,
    closeSettings,
    openNotice,
    closeNotice,
    openLinks,
    closeLinks,
    openAdminPanel,
    closeAdminPanel,
    openOwnerChannels,
    closeOwnerChannels,
    openChannelReportDialog,
    closeChannelReportDialog,
    openNoticeEdit,
    closeNoticeEdit,
    openEmojiPreset,
    closeEmojiPreset,
    openGallery,
    closeGallery,
    loadMoreGallery,
    handleAdminFreezeToggle,
    handleAdminLiveToggle,
    handleShareChannel,
    handleChannelReportSubmit,
  } = useChatAdminChannelActions({
    channelId,
    channel,
    channelName: channel?.name,
    ownerChannelCount,
    inLiveMode,
    liveActive,
    bubbleColor: localBubbleColor || channel?.bubble_color || "#3b8df0",
    galleryItems,
    galleryHasMore,
    galleryLoadingRef: galleryLoading,
    setChannel,
    setBanner,
    setGalleryItems,
    setGalleryHasMore,
    onOpenLiveTitlePrompt: () => setShowLiveTitlePrompt(true),
    onOpenEndLiveConfirm: () => setShowEndLiveConfirm(true),
    text: {
      chatUnfrozen: t("chatUnfrozen"),
      chatFrozen: t("chatFrozen"),
      channelLinkCopied: t("channelLinkCopied"),
      channelShareFailed: t("channelShareFailed"),
      channelReported: t("channelReported"),
      reportAlreadySubmitted: t("reportAlreadySubmitted"),
      reportOwnerCannot: t("reportOwnerCannot"),
      reportChannelFailed: t("reportChannelFailed"),
    },
  });
  const {
    showSearch,
    searchState,
    searchResultIdSet,
    reportsOwnerFilter,
    reportedMsgIds,
    isReportsOwnerView,
    restrictedChannels,
    blockedUidSet,
    reportedTargetIds,
    threadedMessages,
    toggleSearch,
    closeSearch,
    setSearchState,
    setReportsChannelView,
    toggleReportsOwnerFilter,
    reportMessage,
    unreportMessage,
    isMessageReported,
  } = useChatReportsSearch({
    channelId,
    uid,
    inLiveMode,
    messages,
    dmMessages,
    blockedUsers,
    effectiveAdmin,
    setMessages,
    setBanner,
    text: {
      reportPrefix: t("reportPrefix"),
      reported: t("reported"),
      unreported: t("unreported"),
    },
  });

  const {
    applyInitData,
    loadNormalChannelData,
    loadLiveChannelData,
    refreshOwnerModeration,
    showPasscodeGate,
    clearRoomAccessBanner,
  } = useChatChannelBootstrap({
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
    text: {
      adminDataAuthFailed: t("adminDataAuthFailed"),
      roomAuthExpired: t("roomAuthExpired"),
      passcodeChanged: t("passcodeChanged"),
    },
  });

  const bubbleColor = localBubbleColor || channel?.bubble_color || "#3b8df0";
  const {
    handleViewerColorChange,
    handleToggleView,
    handlePetitionToggle,
    handleDmToggle: handleDmSettingsToggle,
    handleShowOnProfileToggle,
    handleColorChange,
    handleBackgroundChange,
    handleNameChange,
    handleProfileImageChange,
    handlePasscodeChange,
    handleNoticeChange: handleRulesNoticeChange,
    handleWelcomeChange,
    handleUnblock,
    handleNoticeEditSave,
  } = useChatChannelSettings({
    channelId,
    bubbleColor,
    inLiveMode,
    isLoggedIn,
    petitionEnabled,
    dmEnabled,
    setAdminViewAsUser,
    setPetitionEnabled,
    setDmEnabled,
    setActiveNotice,
    setWelcomeConfig,
    setBlockedUsers,
    setLocalBubbleColor,
    setChannel,
    setBanner,
    text: {
      petitionAllowed: t("petitionAllowed"),
      petitionBlocked: t("petitionBlocked"),
      dmAllowed: t("dmAllowed"),
      dmBlocked: t("dmBlocked"),
      channelShownOnProfile: t("channelShownOnProfile"),
      channelHiddenFromProfile: t("channelHiddenFromProfile"),
      backgroundChanged: t("backgroundChanged"),
      nameChanged: t("nameChanged"),
      profileChanged: t("profileChanged"),
      rulesChanged: t("rulesChanged"),
      welcomeChanged: t("welcomeChanged"),
      chatUnfrozen: t("chatUnfrozen"),
      noticePosted: t("noticePosted"),
    },
  });

  // Sync bubble color to CSS variable so var(--bubble-sent) works everywhere
  useEffect(() => {
    document.documentElement.style.setProperty("--bubble-sent", bubbleColor);
  }, [bubbleColor]);
  const {
    historyModeRef,
    isNearBottomRef,
    handleScroll,
    scrollToBottom,
    scrollToMessage,
  } = useChatHistoryNavigation({
    channelId,
    messages,
    historyMode,
    messagesContainerRef,
    messagesEndRef,
    inLiveModeRef,
    setMessages,
    setHistoryMode,
    setNewerMessageCount,
    setShowScrollBtn,
    setBanner,
  });

  // Debounce not needed — local patching handles most events, reconnect does full refetch

  // Listen for realtime updates
  useEffect(() => {
    return subscribe((event) => {
      // New message — append to local array
      if (event.type === "message-new") {
        const msg = decorateMessageMedia(event.message as Message);
        // Only add if it belongs to the channel we're viewing
        const viewingChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
        if (msg.channel_id === viewingChannel) {
          if (historyModeRef.current === "context") {
            setNewerMessageCount((count) => count + 1);
            return;
          }
          const shouldFollowNewMessage = isNearBottomRef.current;
          setMessages((prev) => {
            // Avoid duplicates (e.g. our own message already shown optimistically)
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          if (shouldFollowNewMessage) {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
              });
            });
          }
        }
      }
      // Message edited — patch text in place
      if (event.type === "message-edited") {
        const id = event.message_id as string;
        setMessages((prev) => prev.map((m) =>
          m.id === id
            ? {
                ...m,
                text: event.text as string,
                edited: true,
                report_meta: event.report_meta ? event.report_meta as ReportMeta : m.report_meta,
                petition_meta: event.petition_meta ? event.petition_meta as PetitionMeta : m.petition_meta,
              }
            : m
        ));
      }
      // Message deleted — remove or mark as deleted
      if (event.type === "message-deleted") {
        const id = event.message_id as string;
        const deletedIds = new Set(
          Array.isArray(event.deleted_ids) ? event.deleted_ids as string[] : [id]
        );
        setGalleryItems((prev) => prev.filter((item) => !deletedIds.has(item.id)));
        if (event.soft) {
          // User soft-delete (own message with replies) — keep as placeholder if has replies
          setMessages((prev) => {
            const hasReplies = prev.some((m) => m.reply_to === id);
            if (hasReplies) {
              return prev.map((m) => m.id === id ? { ...m, deleted: true, text: t("deletedMessage"), image: null } : m);
            }
            return prev.filter((m) => m.id !== id);
          });
        } else {
          // Admin hard-delete — remove message and its replies entirely
          setMessages((prev) => prev.filter((m) => m.id !== id && m.reply_to !== id));
        }
      }
      // Reconnect or bulk sync — full refetch as safety net
      if (event.type === "reconnected" || event.type === "messages-sync") {
        if (historyModeRef.current === "latest") {
          const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
          fetchMessages(fetchChannel).then((data) => {
            if (data.messages) {
              setMessages((previous) => mergeServerMessageSnapshot(previous, data.messages));
            }
          }).catch(() => {});
        }
      }
      // A reconnect can happen while a settings broadcast is in flight (and
      // local Wrangler restarts its isolated Durable Object during development).
      // Refresh channel configuration as well as messages so non-admin viewers
      // do not keep a stale profile or background until a manual reload.
      if (event.type === "reconnected" && !isOwner && !isAdmin) {
        const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
        fetchInit(fetchChannel).then((data: InitData) => {
          if (!data.channel || data.messages === undefined) return;
          setChannel(data.channel);
          if (data.bannerNotice !== undefined) setActiveNotice(data.bannerNotice || "");
          if (data.welcomeConfig !== undefined) setWelcomeConfig(data.welcomeConfig || "");
          if (data.petitionEnabled !== undefined) setPetitionEnabled(data.petitionEnabled);
          if (data.dmEnabled !== undefined) setDmEnabled(data.dmEnabled);
          setOwnerModeration(data.ownerModeration);
          setViewerModerationStatus(data.viewerModerationStatus ?? null);
        }).catch(() => {});
      }
      // Re-send join-live on reconnect so DO has accurate count
      if (event.type === "reconnected" && inLiveModeRef.current) {
        send({ type: "join-live" });
      }
      if (event.type === "dm-new") {
        const dm = decorateMessageMedia(event.dm as Message);
        const viewingChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
        if (dm.channel_id === viewingChannel) {
          setDmMessages((prev) => {
            if (prev.some((d) => d.id === dm.id)) return prev;
            return [...prev, { ...dm, dm: true }];
          });
        }
      }
      if (event.type === "dm-deleted") {
        const dmId = event.dm_id as string;
        setDmMessages((prev) => prev.filter((d) => d.id !== dmId));
      }
      if (event.type === "freeze-change") {
        const isLiveFreeze = !!event.live;
        if (isLiveFreeze && inLiveModeRef.current) {
          setChannel((prev) => prev ? { ...prev, is_frozen: event.frozen ? 1 : 0 } : null);
        } else if (!isLiveFreeze && !inLiveModeRef.current) {
          setChannel((prev) => prev ? { ...prev, is_frozen: event.frozen ? 1 : 0 } : null);
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
        setChannel((prev) => {
          if (!prev) return null;
          const updated = { ...prev };
          if (event.name) updated.name = event.name as string;
          if (nextProfileImage !== undefined) updated.profile_image = nextProfileImage;
          if (event.bubble_color) updated.bubble_color = event.bubble_color as string;
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
          showPasscodeGate(t("roomAuthExpired"), t("roomAuthExpired"));
        }
      }
      if (event.type === "room-authenticated") {
        clearRoomAccessBanner();
      }
      if (event.type === "admin-authenticated") {
        const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
        fetchInit(fetchChannel).then((data: InitData) => {
          applyInitData(data);
        }).catch(() => {});
      }
      if (event.type === "admin-auth-failed" && isOwner) {
        setBanner({ text: t("adminDataAuthFailed"), color: "#d32f2f" });
      }
      if (event.type === "room-access-opened") {
        clearRoomAccessBanner();
        setPasscodeGate(null);
        const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
        fetchInit(fetchChannel).then((data: InitData) => {
          applyInitData(data);
        }).catch(() => {});
      }
      if (event.type === "room-access-revoked") {
        clearRoomToken(channelId);
        if (!isOwner) {
          showPasscodeGate(t("passcodeChanged"));
        }
      }
      if (event.type === "user-blocked") {
        const blockedUid = event.uid as string;
        if (blockedUid === uid) {
          setViewerBlocked(true);
        }
        if (isOwner) {
          setBlockedUsers((prev) => {
            if (prev.some((b) => b.uid === blockedUid)) return prev;
            return [...prev, { uid: blockedUid, reason: "" }];
          });
        }
      }
      if (event.type === "user-unblocked") {
        const unblockedUid = event.uid as string;
        if (unblockedUid === uid) {
          setViewerBlocked(false);
        }
        setBlockedUsers((prev) => prev.filter((b) => b.uid !== unblockedUid));
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
        // Only apply if the notice matches user's current mode
        if (isLiveNotice && inLiveModeRef.current) {
          setActiveNotice((event.notice as string) || "");
        } else if (!isLiveNotice && !inLiveModeRef.current) {
          setActiveNotice((event.notice as string) || "");
        }
      }
      if (event.type === "rules-changed") {
        setChannel((prev) => prev ? { ...prev, notice: event.rules as string } : null);
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
    send,
    isOwner,
    isAdmin,
    isLoggedIn,
    uid,
    t,
    channel,
    applyInitData,
    localBubbleColor,
    showPasscodeGate,
    clearRoomAccessBanner,
    refreshOwnerModeration,
    historyModeRef,
    isNearBottomRef,
    endLiveSessionLocally,
    loadNormalChannelData,
    handleLiveStartedEvent,
    applyEmojiPresetsSnapshot,
    inLiveModeRef,
  ]);

  // Refetch on tab focus only if backgrounded for >5 minutes (safety net for missed broadcasts)
  useEffect(() => {
    let lastHidden = 0;
    const handler = () => {
      if (document.visibilityState === "hidden") {
        lastHidden = Date.now();
      } else if (document.visibilityState === "visible" && lastHidden && Date.now() - lastHidden > 5 * 60 * 1000) {
        if (!connected) return;
        if (historyModeRef.current === "context") return;
        const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
        fetchMessages(fetchChannel).then((data) => {
          if (data.messages) {
            setMessages((previous) => mergeServerMessageSnapshot(previous, data.messages));
          }
        });
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [channelId, connected, historyModeRef]);

  // Position the initial channel view at the latest message once. Subsequent
  // message mutations (new/edit/delete/reaction/refetch) preserve scroll.
  useEffect(() => {
    initialScrollDoneRef.current = false;
  }, [channelId]);

  useEffect(() => {
    if (loading || passcodeGate || initialScrollDoneRef.current) return;
    initialScrollDoneRef.current = true;
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    });
  }, [loading, passcodeGate]);

  // Effective admin state (false when viewing as user)
  const {
    ownerModerationBlocked,
    viewerModerationBlocked,
    canUseAdminMutations,
    ownerCanSubmitPetition,
    ownerModerationBannerText,
    reportActionPendingId,
    submittingModerationPetition,
    handleReportAction,
    handlePetitionAction,
    handleModerationPetitionSubmit,
  } = useChatModeration({
    channelId,
    isOwner,
    effectiveAdmin,
    dmMode,
    channelFrozen: !!channel?.is_frozen,
    viewerModerationStatus,
    ownerModeration,
    setOwnerModeration,
    setMessages,
    setBanner,
    setShowModerationPetitionDialog,
    refreshOwnerModeration,
    text: {
      ownerSuspendedPetitionOpen: t("ownerSuspendedPetitionOpen"),
      ownerSuspendedPetitionRejected: t("ownerSuspendedPetitionRejected"),
      ownerSuspendedBanner: t("ownerSuspendedBanner"),
      reportResolvedBanner: t("reportResolvedBanner"),
      reportDismissedBanner: t("reportDismissedBanner"),
      warnOwnerSentBanner: t("warnOwnerSentBanner"),
      channelFrozenByModerationBanner: t("channelFrozenByModerationBanner"),
      channelUnfrozenByModerationBanner: t("channelUnfrozenByModerationBanner"),
      channelDeletedByModerationBanner: t("channelDeletedByModerationBanner"),
      reportAlreadyProcessed: t("reportAlreadyProcessed"),
      channelAlreadyFrozen: t("channelAlreadyFrozen"),
      channelNotFrozen: t("channelNotFrozen"),
      freezeBeforeDelete: t("freezeBeforeDelete"),
      petitionPendingReview: t("petitionPendingReview"),
      reportActionFailed: t("reportActionFailed"),
      petitionAccepted: t("petitionAccepted"),
      petitionRejected: t("petitionRejected"),
      petitionAlreadyProcessed: t("petitionAlreadyProcessed"),
      petitionActionFailed: t("petitionActionFailed"),
      moderationPetitionSubmitted: t("moderationPetitionSubmitted"),
      petitionExists: t("petitionExists"),
      petitionUnavailable: t("petitionUnavailable"),
      petitionRequired: t("petitionRequired"),
      moderationPetitionFailed: t("moderationPetitionFailed"),
    },
  });

  // Check if current user is blocked
  const isUserBlocked = !effectiveAdmin && (
    viewerBlocked
    || blockedUsers.some((b) => b.uid === uid)
  );
  const {
    hasPetitioned,
    handleSend,
    handleKeyDown,
    handleReaction,
    handleDelete,
    handleEditSave,
  } = useChatMessageMutations({
    channelId,
    uid,
    authUserId,
    effectiveAdmin,
    dmMode,
    inLiveMode,
    input,
    pendingPhotos,
    messages,
    dmMessages,
    blockedUsers,
    petitionEnabled,
    ownerModerationBlocked,
    viewerModerationStatus,
    channelFrozen: !!channel?.is_frozen,
    isUserBlocked,
    setDmMode,
    setPendingPhotos,
    setMessages,
    setDmMessages,
    setGalleryItems,
    setBanner,
    refreshOwnerModeration,
    textareaRef,
    inLiveModeRef,
    resetInput,
    restoreInput,
    consumeComposerState,
    text: {
      messageTooLong: t("messageTooLong"),
      bannedWord: t("bannedWord"),
      rateLimited: t("rateLimited"),
      blocked: t("blocked"),
      petitionExists: t("petitionExists"),
      ownerSuspendedBanner: t("ownerSuspendedBanner"),
      moderationFrozenBanner: t("moderationFrozenBanner"),
      chatFrozen: t("chatFrozen"),
      dmDisabledMessage: t("dmDisabledMessage"),
      sendFailed: t("sendFailed"),
      blockReason: t("blockReason"),
      petitionPrefix: t("petitionPrefix"),
      petitionSent: t("petitionSent"),
      sentToAdmin: t("sentToAdmin"),
      deletedMessage: t("deletedMessage"),
    },
  });

  const contextMenuActions = useChatContextMenuActions({
    channelId,
    inLiveMode,
    effectiveAdmin,
    ownerModerationBlocked,
    canUseAdminMutations,
    contextMenu,
    messages,
    dmMessages,
    blockedUsers,
    reportActionPendingId,
    setReplyingTo,
    focusTextarea,
    reportMessage,
    unreportMessage,
    isMessageReported,
    handleDelete,
    setMessages,
    setDmMessages,
    setBanner,
    setBlockedUsers,
    openEditDialog,
    handleReportAction,
    handlePetitionAction,
    text: {
      deleteLabel: t("delete"),
      anonLabel: t("anon"),
      anonBlockedLabel: t("anonBlocked"),
      anonUnblockedLabel: t("anonUnblocked"),
      reportDismissedBanner: t("reportDismissedBanner"),
    },
  });

  const overlayCallbacks = useChatOverlayCallbacks({
    channelId,
    messages,
    photoInputRef,
    submittingModerationPetition,
    openGalleryImage,
    closeLinks,
    scrollToMessage,
    handleReaction,
    closeEmojiPicker,
    setDmMode,
    setPlusMenu,
    startLiveLocally,
    setMessages,
    setDmMessages,
    setActiveNotice,
    setBanner,
    liveStartedBannerText: t("liveStarted"),
    syncLiveSessionDetails,
    setShowLiveTitlePrompt,
    setShowEndLiveConfirm,
    endLiveSessionLocally,
    loadNormalChannelData,
    setShowLiveEnded,
    enterLiveMode,
    loadLiveChannelData,
    dismissLivePopup,
    setShowModerationPetitionDialog,
    closeFullViewImage,
    closeGallery,
  });

  // Passcode gate — show overlay if channel requires passcode
  if (passcodeGate && !isOwner) {
    return (
      <PasscodeOverlay
        channelId={channelId}
        channelName={passcodeGate.name}
        profileImage={passcodeGate.profile_image}
        bubbleColor={passcodeGate.bubble_color || "#3b8df0"}
        passcodeHint={passcodeGate.passcodeHint}
        notice={passcodeGate.notice}
        onSuccess={() => {
          // A passcode unlock always enters the normal channel first. Live
          // availability is synchronized by applyInitData and the user can
          // explicitly enter live mode from its join banner.
          exitLiveMode();
          setLoading(true);
          setPasscodeGate(null);
          const requestId = ++initRequestIdRef.current;
          fetchInit(channelId).then((data: InitData) => {
            if (requestId !== initRequestIdRef.current) return;
            clearRoomAccessBanner();
            applyInitData(data);
            setLoading(false);
          }).catch((error) => {
            if (requestId !== initRequestIdRef.current) return;
            if (error instanceof Error && error.message.includes("Init failed: 404")) {
              clearChannelLocalState(channelId);
              setPasscodeGate(null);
              setShowChannelDeleted(true);
              setLoading(false);
              return;
            }
            // Restore the gate instead of leaving the page stuck on loading
            // when the authenticated init request fails.
            setPasscodeGate(passcodeGate);
            setLoading(false);
          });
        }}
      />
    );
  }

  if (showChannelDeleted) {
    return (
      <div className="h-dvh max-w-[480px] mx-auto relative md:border-x" style={{ background: "var(--bg)", color: "var(--gray-text)", borderColor: "var(--hairline)" }}>
        <ConfirmDialog
          title={t("channelDeletedTitle")}
          message={t("channelDeletedMessage")}
          confirmLabel={t("goToDashboard")}
          onConfirm={() => {
            if (!isLoggedIn) removeRecentChannel(channelId);
            window.location.href = "/dashboard";
          }}
          onCancel={() => {}}
          showCancel={false}
          closeOnBackdrop={false}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-dvh max-w-[480px] mx-auto flex flex-col md:border-x" style={{ background: "var(--bg)", borderColor: "var(--hairline)" }}>
        <header
          className="flex items-center px-4 border-b relative"
          style={{
            background: "var(--header-bg)",
            backdropFilter: "saturate(180%) blur(20px)",
            WebkitBackdropFilter: "saturate(180%) blur(20px)",
            borderColor: "var(--hairline)",
            padding: "10px 16px",
          }}
        >
          <div className="flex-1 flex flex-col items-center gap-[6px]">
            <div className="rounded-full" style={{ width: "calc(var(--bubble-font-size) + 24px)", height: "calc(var(--bubble-font-size) + 24px)", background: "var(--gray-bubble)" }} />
            <div className="h-3 w-16 rounded" style={{ background: "var(--gray-bubble)" }} />
          </div>
        </header>
        <div className="flex-1 overflow-hidden"><SkeletonLoading /></div>
      </div>
    );
  }

  const hasChannelRules = Boolean(channel?.notice && channel.notice !== "[]");

  return (
    <div className="h-dvh max-w-[480px] mx-auto flex flex-col relative md:border-x" style={{ background: "var(--bg)", color: "var(--gray-text)", borderColor: "var(--hairline)" }}>
      <ChatViewTopChrome
        channelId={channelId}
        channelName={channel?.name || ""}
        channelProfileImage={channel?.profile_image || null}
        ownerChannelCount={ownerChannelCount}
        bubbleColor={bubbleColor}
        hasChannelRules={hasChannelRules}
        showSearch={showSearch}
        searchMessages={effectiveAdmin ? [...messages, ...dmMessages] : messages}
        onSearchNavigate={(msgId) => {
          const el = document.getElementById(`msg-${msgId}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
        onSearchState={setSearchState}
        onCloseSearch={closeSearch}
        onDashboard={() => { window.location.href = "/dashboard"; }}
        onOpenNotice={openNotice}
        onOpenOwnerChannels={openOwnerChannels}
        onShareChannel={handleShareChannel}
        onToggleSearch={toggleSearch}
        onOpenHeaderMenu={openHeaderMenu}
        onScrollToTop={() => {
          messagesContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        }}
        editingText={editingMsg?.text || null}
        onSaveEdit={(newText) => {
          if (!editingMsg) return;
          void handleEditSave(editingMsg.id, newText);
        }}
        onCloseEdit={closeEditDialog}
        isAdmin={isAdmin}
        adminViewAsUser={adminViewAsUser}
        onReturnToAdmin={() => setAdminViewAsUser(false)}
        liveActive={liveActive}
        inLiveMode={inLiveMode}
        liveTitle={liveTitle}
        liveCount={liveCount}
        liveLastMinuteLabel={liveLastMinuteLabel}
        liveLastMinuteBannerText={liveLastMinuteBannerText}
        liveCountdownNotice={liveCountdownNotice}
        effectiveAdmin={effectiveAdmin}
        connected={connected}
        onJoinLive={() => {
          enterLiveMode();
          void loadLiveChannelData().catch(() => {});
        }}
        onExitLive={() => {
          if (effectiveAdmin) {
            setShowEndLiveConfirm(true);
          } else {
            exitLiveMode();
            void loadNormalChannelData().catch(() => {});
          }
        }}
      />

      <ChatViewMessagePane
        channelId={channelId}
        inLiveMode={inLiveMode}
        backgroundType={channel?.background_type || "default"}
        backgroundColor={channel?.background_color || null}
        backgroundImage={channel?.background_image || null}
        backgroundOverlay={channel?.background_overlay ?? 14}
        backgroundBlur={channel?.background_blur === 1}
        activeNotice={activeNotice}
        onDismissNotice={() => setActiveNotice("")}
        liveCount={liveCount}
        messagesContainerRef={messagesContainerRef}
        messagesEndRef={messagesEndRef}
        onScroll={handleScroll}
        isReportsOwnerView={isReportsOwnerView}
        restrictedChannels={restrictedChannels}
        restrictedChannelsTitle={t("restrictedChannelsTitle")}
        reportModerationFrozenLabel={t("reportModerationFrozen")}
        reportModerationSuspendedLabel={t("reportModerationSuspended")}
        reportOpenBadgeLabel={t("reportOpenBadge")}
        petitionOpenBadgeLabel={t("petitionOpenBadge")}
        viewReportedChannelLabel={t("viewReportedChannel")}
        threadedMessages={threadedMessages}
        effectiveAdmin={effectiveAdmin}
        uid={uid}
        authUserId={authUserId}
        bubbleColor={bubbleColor}
        reportedMsgIds={reportedMsgIds}
        reportedTargetIds={reportedTargetIds}
        blockedUidSet={blockedUidSet}
        searchQuery={searchState.query}
        searchResultIdSet={searchResultIdSet}
        activeSearchId={searchState.activeId}
        deletedMessageLabel={t("deletedMessage")}
        editedMessageLabel={t("edited")}
        locale={locale}
        timeZone={timeZone}
        onLongPress={openContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onOpenImage={openMessageImage}
        onExpand={openExpandedPost}
        onReaction={handleReaction}
        onEmojiPicker={openEmojiPicker}
      />

      {/* Long-message reader, constrained to the visible chat field. */}
      {expandedPost && (
        <div
          className="fixed z-[500] flex items-center justify-center"
          style={{
            top: expandedPost.top,
            left: expandedPost.left,
            width: expandedPost.width,
            height: expandedPost.height,
            padding: "12px",
            background: "rgba(0,0,0,0.42)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
          }}
          onClick={closeExpandedPost}
        >
          <div
            style={{ background: "var(--bg)", borderRadius: "18px", maxWidth: "400px", width: "100%", maxHeight: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "12px 16px", borderBottom: "1px solid var(--hairline)" }}>
              <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--meta)", fontSize: "18px", lineHeight: 1 }} onClick={closeExpandedPost}>✕</button>
            </div>
            <div style={{ padding: "16px", fontSize: "var(--bubble-font-size)", lineHeight: 1.6, color: "var(--gray-text)", overflowY: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {expandedPost.text}
            </div>
          </div>
        </div>
      )}

      {/* Scroll to bottom */}
      <ScrollToBottom
        visible={historyMode === "context" || showScrollBtn}
        unreadCount={historyMode === "context" ? newerMessageCount : undefined}
        label={historyMode === "context" ? (locale === "ko" ? "최신 메시지" : "Latest") : undefined}
        onClick={scrollToBottom}
      />

      {/* Toast banner */}
      {banner && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[550] text-white font-normal px-4 py-[10px] rounded-[12px] text-center max-w-[90%]"
          style={{
            bottom: "80px",
            background: banner.color.startsWith("var(") ? banner.color : `${banner.color}dd`,
            backdropFilter: "saturate(180%) blur(12px)",
            WebkitBackdropFilter: "saturate(180%) blur(12px)",
            fontSize: "var(--bubble-font-size)",
            boxShadow: "0 6px 20px rgba(0,0,0,.25)",
          }}
        >
          {banner.text}
        </div>
      )}

      {/* Reply bar */}
      <ReplyBar replyingTo={replyingTo} onClose={clearReplyingTo} />

      {/* Photo preview */}
      {pendingPhotos.length > 0 && (
        <div
          className="flex-none flex items-center gap-2"
          style={{
            padding: "8px 16px",
            background: "var(--composer-bg)",
            borderTop: "0.5px solid var(--hairline)",
          }}
        >
          <div className="flex gap-2 overflow-x-auto flex-1">
            {pendingPhotos.map((p, i) => (
              <div key={i} className="relative flex-shrink-0">
                <img
                  src={p.previewUrl}
                  className="block rounded-[10px]"
                  style={{ width: "56px", height: "56px", objectFit: "cover" }}
                />
                <button
                  className="absolute flex items-center justify-center border-none cursor-pointer"
                  style={{
                    top: "-4px",
                    right: "-4px",
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    background: "rgba(0,0,0,.6)",
                    color: "#fff",
                    fontSize: "11px",
                    lineHeight: 1,
                  }}
                  onClick={() => removePendingPhoto(i)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Frozen banner */}
      {ownerModerationBlocked && (
        <div
          className="flex-none flex items-center justify-between gap-3"
          style={{
            padding: "10px 14px",
            background: "rgba(139,92,246,.08)",
            borderTop: "0.5px solid rgba(139,92,246,.18)",
            color: "#5b21b6",
          }}
        >
          <div style={{ fontSize: "calc(var(--bubble-font-size) - 4px)", lineHeight: 1.45 }}>
            {ownerModerationBannerText}
          </div>
          {ownerCanSubmitPetition && (
            <button
              type="button"
              className="flex-none border-none cursor-pointer"
              style={{
                borderRadius: "999px",
                background: "#8b5cf6",
                color: "#fff",
                padding: "8px 12px",
                fontSize: "calc(var(--bubble-font-size) - 5px)",
                fontFamily: "inherit",
                lineHeight: 1,
              }}
              onClick={() => setShowModerationPetitionDialog(true)}
            >
              {t("submitModerationPetition")}
            </button>
          )}
        </div>
      )}

      {viewerModerationBlocked && (
        <div
          className="flex-none flex items-center gap-3"
          style={{
            padding: "10px 14px",
            background: "rgba(139,92,246,.08)",
            borderTop: "0.5px solid rgba(139,92,246,.18)",
            color: "#5b21b6",
          }}
        >
          <div style={{ fontSize: "calc(var(--bubble-font-size) - 4px)", lineHeight: 1.45 }}>
            {t("moderationFrozenBanner")}
          </div>
        </div>
      )}

      {/* Composer */}
      <footer
        className="flex-none flex items-end gap-2"
        style={{
          padding: "8px 10px calc(8px + env(safe-area-inset-bottom))",
          background: "var(--composer-bg)",
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          borderTop: "0.5px solid var(--hairline)",
        }}
      >
          {/* Hidden photo input */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={handlePhotoSelect}
          />

          <button
            className="flex-none border-none bg-transparent p-0 flex items-center justify-center cursor-pointer self-center"
            style={{ color: "var(--meta)", width: "32px", height: "32px", opacity: ((isUserBlocked && (hasPetitioned || !petitionEnabled)) || ownerModerationBlocked) ? 0.3 : 1, pointerEvents: ((isUserBlocked && (hasPetitioned || !petitionEnabled)) || ownerModerationBlocked) ? "none" : "auto" }}
            onClick={(e) => setPlusMenu(e.currentTarget.getBoundingClientRect())}
          >
            <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 11px)", height: "calc(var(--bubble-font-size) + 11px)" }}>
              <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M12 7v10M7 12h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>

          <div
            className="flex-1 flex items-center relative"
            style={{
              minHeight: "calc(var(--bubble-font-size) + 19px)",
              padding: "0 6px 0 calc(var(--bubble-font-size) * 0.824)",
              background: ownerModerationBlocked
                ? "rgba(139,92,246,.06)"
                : (channel?.is_frozen && !effectiveAdmin && !dmMode)
                ? "rgba(0,0,0,.03)"
                : isUserBlocked
                  ? "rgba(255,59,48,.05)"
                  : dmMode ? "rgba(155,89,182,.05)" : "var(--input-bg)",
              border: ownerModerationBlocked
                ? "1px solid rgba(139,92,246,.28)"
                : (channel?.is_frozen && !effectiveAdmin && !dmMode)
                ? "1px solid #ccc"
                : isUserBlocked
                  ? "1px solid #d32f2f"
                  : dmMode ? "1px solid #7b3fa0" : "1px solid var(--input-border)",
              borderRadius: "20px",
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={ownerModerationBlocked || !!(channel?.is_frozen && !effectiveAdmin && !dmMode) || (isUserBlocked && (hasPetitioned || !petitionEnabled))}
              rows={1}
              placeholder={
                ownerModerationBlocked
                  ? t("ownerSuspendedInput")
                  : viewerModerationBlocked
                  ? t("moderationFrozenInput")
                  : (channel?.is_frozen && !effectiveAdmin && !dmMode)
                  ? t("frozenInput")
                  : isUserBlocked
                    ? (hasPetitioned || !petitionEnabled ? t("blockedInput") : t("petitionInput"))
                    : (channel?.is_frozen && effectiveAdmin)
                      ? t("frozenInput")
                      : dmMode
                        ? t("sentToAdmin")
                        : t("messageInput")
              }
              className="flex-1 border-none bg-transparent outline-none resize-none"
              style={{
                fontSize: "var(--bubble-font-size)",
                color: ownerModerationBlocked || (channel?.is_frozen && !effectiveAdmin && !dmMode) ? "#999" : "var(--gray-text)",
                padding: "8px 0",
                caretColor: "var(--tint)",
                fontFamily: "inherit",
                lineHeight: 1.4,
                maxHeight: "80px",
                overflowY: "auto",
              }}
            />
            {/* Emoji bar trigger (live mode only) */}
            {inLiveMode && !isUserBlocked && !ownerModerationBlocked && (
              <EmojiBar channelId={channelId} presets={emojiPresets} onBroadcast={(emoji, x, h) => {
                send({ type: "emoji-fx", emoji, x, h });
              }} />
            )}
            {(input.trim() || pendingPhotos.length > 0) && !ownerModerationBlocked && !(channel?.is_frozen && !effectiveAdmin && !dmMode) && (
              <button
                onClick={handleSend}
                className="flex-none flex items-center justify-center border-none cursor-pointer"
                style={{
                  width: "calc(var(--bubble-font-size) + 9px)",
                  height: "calc(var(--bubble-font-size) + 9px)",
                  borderRadius: "50%",
                  background: dmMode ? "#7b3fa0" : bubbleColor,
                }}
              >
                <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) - 1px)", height: "calc(var(--bubble-font-size) - 1px)" }}>
                  <path d="M12 20V5m0 0l-6 6m6-6l6 6" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </footer>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          msg={contextMenu.msg}
          isSent={contextMenu.isSent}
          anchorRect={contextMenu.rect}
          bubbleEl={contextMenu.bubbleEl}
          isAdmin={effectiveAdmin}
          onReaction={handleReaction}
          onReply={contextMenuActions.onReply}
          onReport={contextMenuActions.onReport}
          onUnreport={contextMenuActions.onUnreport}
          isReported={contextMenuActions.isReported}
          onDelete={contextMenuActions.onDelete}
          onDeleteWithReplies={contextMenuActions.onDeleteWithReplies}
          onEdit={contextMenuActions.onEdit}
          onBlock={contextMenuActions.onBlock}
          isBlockedUser={contextMenuActions.isBlockedUser}
          onDismissReportMessage={contextMenuActions.onDismissReportMessage}
          onReportAction={contextMenuActions.onReportAction}
          onPetitionAction={contextMenuActions.onPetitionAction}
          reportActionPending={contextMenuActions.reportActionPending}
          onEmojiPicker={openEmojiPicker}
          onClose={closeContextMenu}
          isMyMessage={contextMenu.isOwn}
        />
      )}

      <ChatViewOverlays
        channelId={channelId}
        channelName={channel?.name || ""}
        channelProfileImage={channel?.profile_image || null}
        channelNotice={channel?.notice || "[]"}
        bubbleColor={bubbleColor}
        welcomeConfig={welcomeConfig}
        activeNotice={activeNotice}
        locale={locale}
        timeZone={timeZone}
        effectiveAdmin={effectiveAdmin}
        showModerationPetitionDialog={showModerationPetitionDialog}
        submittingModerationPetition={submittingModerationPetition}
        headerMenu={headerMenu}
        showChannelReportDialog={showChannelReportDialog}
        submittingChannelReport={submittingChannelReport}
        showOwnerChannels={showOwnerChannels}
        showSettings={showSettings}
        showGallery={showGallery}
        galleryItems={galleryItems}
        galleryHasMore={galleryHasMore}
        showLinks={showLinks}
        linksChannelId={inLiveModeRef.current ? `${channelId}_live` : channelId}
        showAdminPanel={showAdminPanel}
        petitionEnabled={petitionEnabled}
        dmEnabled={dmEnabled}
        blockedUsers={blockedUsers}
        emojiPicker={emojiPicker}
        plusMenu={plusMenu}
        dmMode={dmMode}
        isFrozen={!!channel?.is_frozen}
        liveActive={liveActive}
        inLiveMode={inLiveMode}
        reportsOwnerFilter={reportsOwnerFilter}
        isReportsOwnerView={isReportsOwnerView}
        showLiveTitlePrompt={showLiveTitlePrompt}
        showEndLiveConfirm={showEndLiveConfirm}
        liveEndTitle={t("liveEndTitle")}
        liveEndMessage={t("liveEndMessage")}
        liveEndConfirmLabel={t("liveEndBtn")}
        showLiveEnded={showLiveEnded}
        showLivePopup={showLivePopup}
        liveTitle={liveTitle}
        showEmojiPreset={showEmojiPreset}
        showNoticeEdit={showNoticeEdit}
        showNotice={showNotice}
        fullViewImage={fullViewImage}
        currentColor={bubbleColor}
        backgroundType={channel?.background_type || "default"}
        backgroundColor={channel?.background_color || null}
        backgroundImage={channel?.background_image || null}
        backgroundOverlay={channel?.background_overlay ?? 14}
        backgroundBlur={channel?.background_blur === 1}
        passcodeHint={channel?.passcode_hint || ""}
        showOnProfile={channel?.show_on_profile === 1}
        onHeaderSettings={openSettings}
        onHeaderGallery={openGallery}
        onHeaderLinks={openLinks}
        onHeaderReportChannel={!isAdmin ? openChannelReportDialog : undefined}
        onCloseHeaderMenu={closeHeaderMenu}
        onChannelReportSubmit={handleChannelReportSubmit}
        onCloseChannelReportDialog={closeChannelReportDialog}
        onModerationPetitionSubmit={handleModerationPetitionSubmit}
        onCloseModerationPetitionDialog={overlayCallbacks.closeModerationPetitionDialog}
        onCloseOwnerChannels={closeOwnerChannels}
        onViewerColorChange={handleViewerColorChange}
        onSettingsAdmin={effectiveAdmin && !ownerModerationBlocked ? openAdminPanel : undefined}
        onCloseSettings={closeSettings}
        onLoadMoreGallery={loadMoreGallery}
        onViewGalleryImage={overlayCallbacks.viewGalleryImage}
        onCloseGallery={closeGallery}
        onNavigateFromLinks={overlayCallbacks.navigateFromLinks}
        onCloseLinks={closeLinks}
        onToggleView={handleToggleView}
        onPetitionToggle={handlePetitionToggle}
        onDmToggle={handleDmSettingsToggle}
        onShowOnProfileToggle={handleShowOnProfileToggle}
        onColorChange={handleColorChange}
        onBackgroundChange={handleBackgroundChange}
        onNameChange={handleNameChange}
        onProfileImageChange={handleProfileImageChange}
        onPasscodeChange={handlePasscodeChange}
        onRulesNoticeChange={handleRulesNoticeChange}
        onWelcomeChange={handleWelcomeChange}
        onUnblock={handleUnblock}
        onCloseAdminPanel={closeAdminPanel}
        onEmojiSelect={overlayCallbacks.handleOverlayEmojiSelect}
        onCloseEmojiPicker={closeEmojiPicker}
        onPlusPhoto={overlayCallbacks.openPlusPhotoPicker}
        onPlusDmToggle={overlayCallbacks.togglePlusDmMode}
        onFreezeToggle={canUseAdminMutations ? handleAdminFreezeToggle : undefined}
        onLiveToggle={canUseAdminMutations ? handleAdminLiveToggle : undefined}
        onPlusNotice={canUseAdminMutations ? openNoticeEdit : undefined}
        onPlusEmojiPreset={openEmojiPreset}
        onReportFilterSelect={toggleReportsOwnerFilter}
        onClosePlusMenu={overlayCallbacks.closePlusMenu}
        onLiveStart={overlayCallbacks.startLiveFromPrompt}
        onCloseLiveTitlePrompt={overlayCallbacks.closeLiveTitlePrompt}
        onConfirmEndLive={overlayCallbacks.confirmEndLive}
        onCancelEndLive={overlayCallbacks.cancelEndLive}
        onCloseLiveEnded={overlayCallbacks.closeLiveEnded}
        onJoinLivePopup={overlayCallbacks.joinLivePopup}
        onDismissLivePopup={overlayCallbacks.dismissLivePopup}
        onCloseEmojiPreset={closeEmojiPreset}
        onNoticeEditSave={handleNoticeEditSave}
        onCloseNoticeEdit={closeNoticeEdit}
        onCloseNotice={closeNotice}
        onCloseFullViewImage={closeFullViewImage}
        onJumpFromGalleryImage={overlayCallbacks.jumpFromGalleryImage}
      />
    </div>
  );
}
