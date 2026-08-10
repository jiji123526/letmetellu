"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { getStoredUid } from "@/lib/api-core";
import { adminAction, fetchInit, fetchOwnerChannels } from "@/lib/api-chat";
import { useRealtime } from "@/hooks/useRealtime";
import { useAuth } from "@/hooks/useAuth";
import { useAutoUpdate } from "@/hooks/useAutoUpdate";
import { useLocale } from "@/hooks/useLocale";
import { removeRecentChannel } from "@/lib/recent-channels";
import { normalizeBubbleColor } from "@/lib/bubble-color";
import { clearChannelLocalState } from "@/lib/channel-local-state";
import { readChannelBackground } from "@/lib/channel-background-cache";
import { useChatHistoryNavigation } from "./useChatHistoryNavigation";
import { useChatModeration } from "./useChatModeration";
import type { Message } from "./chatTypes";
import type { Channel, InitData, PasscodeGateState } from "./chatViewTypes";
import { useChatLiveSession } from "./useChatLiveSession";
import { useChatReplyParents } from "./useChatReplyParents";
import { useChatReportsSearch } from "./useChatReportsSearch";
import { useChatComposerState, type PendingPhoto } from "./useChatComposerState";
import { useChatMessageMutations } from "./useChatMessageMutations";
import { useChatInteractions } from "./useChatInteractions";
import { useChatAdminChannelActions } from "./useChatAdminChannelActions";
import { useChatChannelSettings } from "./useChatChannelSettings";
import { useChatContextMenuActions } from "./useChatContextMenuActions";
import { useChatOverlayCallbacks } from "./useChatOverlayCallbacks";
import { ChatViewTopChrome } from "./ChatViewTopChrome";
import { ChatViewMessagePane } from "./ChatViewMessagePane";
import { ChatViewBottomShell } from "./ChatViewBottomShell";
import { ChatViewLayerStack } from "./ChatViewLayerStack";
import {
  ChatViewDeletedState,
  ChatViewExpandedPostOverlay,
  ChatViewLoadingState,
  ChatViewPasscodeGate,
} from "./ChatViewStateScreens";
import { useChatChannelBootstrap } from "./useChatChannelBootstrap";
import { useChatRealtimeSync } from "./useChatRealtimeSync";

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

export function ChatView({ channelId }: { channelId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<{ uid: string; reason: string }[]>([]);
  const [viewerBlocked, setViewerBlocked] = useState(false);
  const [dmMessages, setDmMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [cachedBackground] = useState(() => readChannelBackground(channelId));
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
    const storedColor = localStorage.getItem(`bubbleColor_${channelId}`);
    return storedColor ? normalizeBubbleColor(storedColor) : null;
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

  const { connected, showReconnectNotice, presence, liveCount, subscribe, send } = useRealtime(channelId, uid);
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
  const adminUi = useChatAdminChannelActions({
    channelId,
    channel,
    channelName: channel?.name,
    ownerChannelCount,
    inLiveMode,
    liveActive,
    bubbleColor: localBubbleColor || channel?.bubble_color || "#3598fe",
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
  } = adminUi;
  const {
    unavailableReplyParentIds,
    isResolvingReplyParents,
  } = useChatReplyParents({
    channelId,
    inLiveMode,
    enabled: !loading && !passcodeGate && !showChannelDeleted,
    messages,
    messagesContainerRef,
    messagesEndRef,
    setMessages,
  });
  const {
    showSearch,
    searchState,
    searchResultIdSet,
    reportsOwnerFilter,
    reportedMsgIds,
    isReportsOwnerView,
    restrictedChannels,
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
    unavailableReplyParentIds,
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

  const bubbleColor = localBubbleColor || channel?.bubble_color || "#3598fe";
  const settingsActions = useChatChannelSettings({
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
  } = settingsActions;

  // Sync bubble color to CSS variable so var(--bubble-sent) works everywhere
  useEffect(() => {
    document.documentElement.style.setProperty("--bubble-sent", bubbleColor);
  }, [bubbleColor]);
  const {
    historyModeRef,
    isNearBottomRef,
    handleScroll,
    scrollToBottom,
    positionAtLatest,
    scrollToMessage,
    restoreRefreshPosition,
  } = useChatHistoryNavigation({
    channelId,
    messages,
    historyMode,
    enabled: !loading && !passcodeGate && !showChannelDeleted,
    messagesContainerRef,
    messagesEndRef,
    inLiveModeRef,
    setMessages,
    setHistoryMode,
    setNewerMessageCount,
    setShowScrollBtn,
    setBanner,
  });

  const loadLiveChannelAtLatest = useCallback(async () => {
    await loadLiveChannelData();
    positionAtLatest();
  }, [loadLiveChannelData, positionAtLatest]);

  useChatRealtimeSync({
    channelId,
    connected,
    uid,
    isOwner,
    isAdmin,
    isLoggedIn,
    localBubbleColor,
    subscribe,
    send,
    inLiveModeRef,
    historyModeRef,
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
    text: {
      deletedMessage: t("deletedMessage"),
      roomAuthExpired: t("roomAuthExpired"),
      passcodeChanged: t("passcodeChanged"),
      adminDataAuthFailed: t("adminDataAuthFailed"),
    },
  });

  // Position the initial channel view at the latest message once. Subsequent
  // message mutations (new/edit/delete/reaction/refetch) preserve scroll.
  useEffect(() => {
    initialScrollDoneRef.current = false;
  }, [channelId]);

  useEffect(() => {
    if (loading || passcodeGate || isResolvingReplyParents || initialScrollDoneRef.current) return;
    initialScrollDoneRef.current = true;
    let cancelled = false;
    void restoreRefreshPosition().then((restored) => {
      if (cancelled || restored) return;
      requestAnimationFrame(() => {
        if (!cancelled) {
          messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
        }
      });
    });
    return () => { cancelled = true; };
  }, [isResolvingReplyParents, loading, passcodeGate, restoreRefreshPosition]);

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
    isSending,
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
    replyingToId: replyingTo?.id,
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
    loadLiveChannelData: loadLiveChannelAtLatest,
    dismissLivePopup,
    setShowModerationPetitionDialog,
    closeFullViewImage,
    closeGallery,
  });

  // Passcode gate — show overlay if channel requires passcode
  if (passcodeGate && !isOwner) {
    return (
      <ChatViewPasscodeGate
        channelId={channelId}
        passcodeGate={passcodeGate}
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
      <ChatViewDeletedState
        title={t("channelDeletedTitle")}
        message={t("channelDeletedMessage")}
        confirmLabel={t("goToDashboard")}
        onConfirm={() => {
          if (!isLoggedIn) removeRecentChannel(channelId);
          window.location.href = "/dashboard";
        }}
      />
    );
  }

  if (loading) {
    return <ChatViewLoadingState background={cachedBackground} />;
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
          void scrollToMessage(msgId);
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
        showReconnectNotice={showReconnectNotice}
        onJoinLive={() => {
          enterLiveMode();
          void loadLiveChannelAtLatest().catch(() => {});
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

      <ChatViewExpandedPostOverlay expandedPost={expandedPost} onClose={closeExpandedPost} />

      <ChatViewBottomShell
        channelId={channelId}
        historyMode={historyMode}
        showScrollBtn={showScrollBtn}
        newerMessageCount={newerMessageCount}
        latestMessagesLabel={locale === "ko" ? "최신 메시지" : "Latest"}
        onScrollToBottom={scrollToBottom}
        banner={banner}
        replyingTo={replyingTo}
        onCloseReply={clearReplyingTo}
        pendingPhotos={pendingPhotos}
        onRemovePendingPhoto={removePendingPhoto}
        ownerModerationBlocked={ownerModerationBlocked}
        ownerModerationBannerText={ownerModerationBannerText}
        ownerCanSubmitPetition={ownerCanSubmitPetition}
        submitModerationPetitionLabel={t("submitModerationPetition")}
        onOpenModerationPetition={() => setShowModerationPetitionDialog(true)}
        viewerModerationBlocked={viewerModerationBlocked}
        moderationFrozenBannerLabel={t("moderationFrozenBanner")}
        photoInputRef={photoInputRef}
        onPhotoSelect={handlePhotoSelect}
        onOpenPlusMenu={setPlusMenu}
        isUserBlocked={isUserBlocked}
        hasPetitioned={hasPetitioned}
        petitionEnabled={petitionEnabled}
        isFrozen={!!channel?.is_frozen}
        effectiveAdmin={effectiveAdmin}
        dmMode={dmMode}
        input={input}
        textareaRef={textareaRef}
        onInputChange={handleInputChange}
        onKeyDown={handleKeyDown}
        ownerSuspendedInputLabel={t("ownerSuspendedInput")}
        moderationFrozenInputLabel={t("moderationFrozenInput")}
        frozenInputLabel={t("frozenInput")}
        blockedInputLabel={t("blockedInput")}
        petitionInputLabel={t("petitionInput")}
        sentToAdminLabel={t("sentToAdmin")}
        messageInputLabel={t("messageInput")}
        inLiveMode={inLiveMode}
        emojiPresets={emojiPresets}
        onBroadcastEmoji={(emoji, x, h) => {
          send({ type: "emoji-fx", emoji, x, h });
        }}
        onSend={handleSend}
        isSending={isSending}
        bubbleColor={bubbleColor}
      />

      <ChatViewLayerStack
        channelId={channelId}
        channel={channel}
        bubbleColor={bubbleColor}
        welcomeConfig={welcomeConfig}
        activeNotice={activeNotice}
        locale={locale}
        timeZone={timeZone}
        effectiveAdmin={effectiveAdmin}
        isAdmin={isAdmin}
        ownerModerationBlocked={ownerModerationBlocked}
        canUseAdminMutations={canUseAdminMutations}
        petitionEnabled={petitionEnabled}
        dmEnabled={dmEnabled}
        blockedUsers={blockedUsers}
        galleryItems={galleryItems}
        galleryHasMore={galleryHasMore}
        emojiPicker={emojiPicker}
        plusMenu={plusMenu}
        dmMode={dmMode}
        liveActive={liveActive}
        inLiveMode={inLiveMode}
        reportsOwnerFilter={reportsOwnerFilter}
        isReportsOwnerView={isReportsOwnerView}
        showModerationPetitionDialog={showModerationPetitionDialog}
        submittingModerationPetition={submittingModerationPetition}
        fullViewImage={fullViewImage}
        linksChannelId={inLiveModeRef.current ? `${channelId}_live` : channelId}
        showLiveTitlePrompt={showLiveTitlePrompt}
        showEndLiveConfirm={showEndLiveConfirm}
        liveEndTitle={t("liveEndTitle")}
        liveEndMessage={t("liveEndMessage")}
        liveEndConfirmLabel={t("liveEndBtn")}
        showLiveEnded={showLiveEnded}
        showLivePopup={showLivePopup}
        liveTitle={liveTitle}
        onReportFilterSelect={toggleReportsOwnerFilter}
        contextMenu={contextMenu}
        contextMenuActions={contextMenuActions}
        overlayCallbacks={overlayCallbacks}
        adminUi={adminUi}
        settingsActions={settingsActions}
        onReaction={handleReaction}
        onOpenEmojiPicker={openEmojiPicker}
        onCloseContextMenu={closeContextMenu}
        onModerationPetitionSubmit={handleModerationPetitionSubmit}
        onCloseEmojiPicker={closeEmojiPicker}
        onCloseFullViewImage={closeFullViewImage}
      />
    </div>
  );
}
