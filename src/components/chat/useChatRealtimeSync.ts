"use client";

import { useCallback, useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import {
  clearRoomToken,
  decorateMediaUrl,
  decorateMessageMedia,
  decorateProtectedMediaUrl,
  fetchInit,
  fetchMessages,
} from "@/lib/api";
import { clearChannelLocalState } from "@/lib/channel-local-state";
import { removeRecentChannel, updateRecentChannelAppearance } from "@/lib/recent-channels";
import { spawnEmoji } from "./EmojiBar";
import { mergeServerMessageSnapshot } from "./chatMessageUtils";
import type { Message, PetitionMeta, ReportMeta } from "./chatTypes";
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
  isAdmin: boolean;
  isLoggedIn: boolean;
  localBubbleColor: string | null;
  subscribe: (handler: (event: RealtimeEvent) => void) => () => void;
  send: (data: Record<string, unknown>) => void;
  inLiveModeRef: MutableRefObject<boolean>;
  historyModeRef: MutableRefObject<"latest" | "context">;
  isNearBottomRef: MutableRefObject<boolean>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  pendingReactionUpdatesRef: MutableRefObject<Map<string, string>>;
  reactionFrameRef: MutableRefObject<number | null>;
  applyInitData: (data: InitData) => void;
  showPasscodeGate: (notice?: string, bannerText?: string) => void;
  clearRoomAccessBanner: () => void;
  refreshOwnerModeration: () => void;
  loadNormalChannelData: () => Promise<void>;
  endLiveSessionLocally: (options?: EndLiveSessionOptions) => boolean;
  handleLiveStartedEvent: (options: SyncLiveSessionOptions) => void;
  applyEmojiPresetsSnapshot: (rawPresets: string | null | undefined) => void;
  setMessages: Dispatch<SetStateAction<Message[]>>;
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
  text,
}: UseChatRealtimeSyncArgs) {
  const {
    deletedMessage,
    roomAuthExpired,
    passcodeChanged,
    adminDataAuthFailed,
  } = text;

  const getViewingChannelId = useCallback(() => {
    return inLiveModeRef.current ? `${channelId}_live` : channelId;
  }, [channelId, inLiveModeRef]);

  const refreshLatestMessages = useCallback(() => {
    const fetchChannel = getViewingChannelId();
    fetchMessages(fetchChannel).then((data) => {
      if (data.messages) {
        setMessages((previous) => mergeServerMessageSnapshot(previous, data.messages));
      }
    }).catch(() => {});
  }, [getViewingChannelId, setMessages]);

  const refreshCurrentChannelInit = useCallback(() => {
    const fetchChannel = getViewingChannelId();
    fetchInit(fetchChannel).then((data: InitData) => {
      applyInitData(data);
    }).catch(() => {});
  }, [applyInitData, getViewingChannelId]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "message-new") {
        const msg = decorateMessageMedia(event.message as Message);
        const viewingChannel = getViewingChannelId();
        if (msg.channel_id === viewingChannel) {
          if (historyModeRef.current === "context") {
            setNewerMessageCount((count) => count + 1);
            return;
          }
          const shouldFollowNewMessage = isNearBottomRef.current;
          setMessages((previous) => {
            if (previous.some((message) => message.id === msg.id)) return previous;
            return [...previous, msg];
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
          setMessages((previous) => previous.filter((message) => message.id !== id && message.reply_to !== id));
        }
      }

      if ((event.type === "reconnected" || event.type === "messages-sync") && historyModeRef.current === "latest") {
        refreshLatestMessages();
      }

      if (event.type === "reconnected" && !isOwner && !isAdmin) {
        const fetchChannel = getViewingChannelId();
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

      if (event.type === "reconnected" && inLiveModeRef.current) {
        send({ type: "join-live" });
      }

      if (event.type === "dm-new") {
        const dm = decorateMessageMedia(event.dm as Message);
        const viewingChannel = getViewingChannelId();
        if (dm.channel_id === viewingChannel) {
          setDmMessages((previous) => {
            if (previous.some((message) => message.id === dm.id)) return previous;
            return [...previous, { ...dm, dm: true }];
          });
        }
      }

      if (event.type === "dm-deleted") {
        const dmId = event.dm_id as string;
        setDmMessages((previous) => previous.filter((message) => message.id !== dmId));
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
        setChannel((previous) => {
          if (!previous) return null;
          const updated = { ...previous };
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
          showPasscodeGate(roomAuthExpired, roomAuthExpired);
        }
      }

      if (event.type === "room-authenticated") {
        clearRoomAccessBanner();
      }

      if (event.type === "admin-authenticated") {
        refreshCurrentChannelInit();
      }

      if (event.type === "admin-auth-failed" && isOwner) {
        setBanner({ text: adminDataAuthFailed, color: "#d32f2f" });
      }

      if (event.type === "room-access-opened") {
        clearRoomAccessBanner();
        setPasscodeGate(null);
        refreshCurrentChannelInit();
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
    isAdmin,
    isLoggedIn,
    localBubbleColor,
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
    getViewingChannelId,
    refreshLatestMessages,
    refreshCurrentChannelInit,
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
      if (!lastHidden || Date.now() - lastHidden <= 5 * 60 * 1000) return;
      if (!connected) return;
      if (historyModeRef.current === "context") return;
      refreshLatestMessages();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [connected, historyModeRef, refreshLatestMessages]);
}
