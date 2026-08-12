"use client";

import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { adminAction } from "@/lib/api-chat";
import type { Message } from "./chatTypes";

interface BannerState {
  text: string;
  color: string;
}

interface GalleryMeta {
  id: string;
  created_at: string;
}

interface UseChatOverlayCallbacksArgs {
  channelId: string;
  messages: Message[];
  photoInputRef: RefObject<HTMLInputElement | null>;
  submittingModerationPetition: boolean;
  openGalleryImage: (src: string, meta: GalleryMeta, caption?: string) => void;
  scrollToMessage: (msgId: string, alignment?: "message" | "media") => Promise<void>;
  handleReaction: (messageId: string, emoji: string) => Promise<void>;
  closeEmojiPicker: () => void;
  setDmMode: Dispatch<SetStateAction<boolean>>;
  setPlusMenu: Dispatch<SetStateAction<DOMRect | null>>;
  startLiveLocally: (title: string) => void;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setDmMessages: Dispatch<SetStateAction<Message[]>>;
  setActiveNotice: Dispatch<SetStateAction<string>>;
  setBanner: Dispatch<SetStateAction<BannerState | null>>;
  liveStartedBannerText: string;
  liveEndFailedText: string;
  liveSessionChangedText: string;
  liveSessionId: string;
  syncLiveSessionDetails: (input: { sessionId: string; expiresAt: string | null }) => void;
  handleLiveStartedEvent: (input: { title?: string; sessionId?: string; expiresAt?: string | null }) => void;
  setShowLiveTitlePrompt: Dispatch<SetStateAction<boolean>>;
  setShowEndLiveConfirm: Dispatch<SetStateAction<boolean>>;
  endLiveSessionLocally: (options: { clearSeen?: boolean }) => void;
  loadNormalChannelData: () => Promise<void>;
  setShowLiveEnded: Dispatch<SetStateAction<boolean>>;
  enterLiveMode: (options: { markCurrentSessionSeen?: boolean }) => void;
  loadLiveChannelData: () => Promise<void>;
  dismissLivePopup: () => void;
  setShowModerationPetitionDialog: Dispatch<SetStateAction<boolean>>;
  closeFullViewImage: () => void;
  closeGallery: () => void;
}

export interface UseChatOverlayCallbacksResult {
  closeModerationPetitionDialog: () => void;
  viewGalleryImage: (src: string, meta: GalleryMeta) => void;
  handleOverlayEmojiSelect: (emoji: string, messageId: string) => void;
  openPlusPhotoPicker: () => void;
  togglePlusDmMode: () => void;
  closePlusMenu: () => void;
  startLiveFromPrompt: (title: string) => Promise<void>;
  closeLiveTitlePrompt: () => void;
  confirmEndLive: () => Promise<void>;
  cancelEndLive: () => void;
  closeLiveEnded: () => void;
  joinLivePopup: () => void;
  jumpFromGalleryImage: (msgId: string) => void;
  dismissLivePopup: () => void;
}

export function useChatOverlayCallbacks({
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
  liveStartedBannerText,
  liveEndFailedText,
  liveSessionChangedText,
  liveSessionId,
  syncLiveSessionDetails,
  handleLiveStartedEvent,
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
}: UseChatOverlayCallbacksArgs): UseChatOverlayCallbacksResult {
  const endingLiveRef = useRef(false);

  const flashBanner = useCallback((text: string, color: string) => {
    setBanner({ text, color });
    setTimeout(() => setBanner(null), 3000);
  }, [setBanner]);

  const closeModerationPetitionDialog = useCallback(() => {
    if (!submittingModerationPetition) {
      setShowModerationPetitionDialog(false);
    }
  }, [setShowModerationPetitionDialog, submittingModerationPetition]);

  const viewGalleryImage = useCallback((src: string, meta: GalleryMeta) => {
    const message = messages.find((item) => item.id === meta.id);
    openGalleryImage(src, meta, message?.text || undefined);
  }, [messages, openGalleryImage]);

  const handleOverlayEmojiSelect = useCallback((emoji: string, messageId: string) => {
    void handleReaction(messageId, emoji);
    closeEmojiPicker();
  }, [closeEmojiPicker, handleReaction]);

  const openPlusPhotoPicker = useCallback(() => {
    photoInputRef.current?.click();
  }, [photoInputRef]);

  const togglePlusDmMode = useCallback(() => {
    setDmMode((current) => !current);
  }, [setDmMode]);

  const closePlusMenu = useCallback(() => {
    setPlusMenu(null);
  }, [setPlusMenu]);

  const startLiveFromPrompt = useCallback(async (title: string) => {
    startLiveLocally(title);
    setMessages([]);
    setDmMessages([]);
    setActiveNotice("");
    flashBanner(liveStartedBannerText, "#c0392b");
    const result = await adminAction("start-live", channelId, { title }) as {
      sessionId?: string;
      live?: { expiresAt?: string };
    };
    syncLiveSessionDetails({
      sessionId: typeof result?.sessionId === "string" ? result.sessionId : "",
      expiresAt: typeof result?.live?.expiresAt === "string" ? result.live.expiresAt : null,
    });
  }, [
    channelId,
    flashBanner,
    liveStartedBannerText,
    setActiveNotice,
    setDmMessages,
    setMessages,
    startLiveLocally,
    syncLiveSessionDetails,
  ]);

  const closeLiveTitlePrompt = useCallback(() => {
    setShowLiveTitlePrompt(false);
  }, [setShowLiveTitlePrompt]);

  const confirmEndLive = useCallback(async () => {
    if (endingLiveRef.current) return;
    endingLiveRef.current = true;
    try {
      if (!liveSessionId) {
        flashBanner(liveEndFailedText, "#d32f2f");
        await loadNormalChannelData();
        return;
      }

      const result = await adminAction("end-live", channelId, {
        sessionId: liveSessionId,
      }) as {
        ok?: boolean;
        error?: string;
        live?: {
          active?: boolean;
          title?: string;
          sessionId?: string;
          expiresAt?: string;
        };
      };

      if (result.ok) {
        setShowEndLiveConfirm(false);
        endLiveSessionLocally({ clearSeen: true });
        await loadNormalChannelData();
        setShowLiveEnded(true);
        return;
      }

      if (result.error === "live_session_changed") {
        setShowEndLiveConfirm(false);
        endLiveSessionLocally({ clearSeen: true });
        await loadNormalChannelData();
        if (result.live?.active) {
          handleLiveStartedEvent({
            title: result.live.title,
            sessionId: result.live.sessionId,
            expiresAt: result.live.expiresAt || null,
          });
        }
        flashBanner(liveSessionChangedText, "#c0392b");
        return;
      }

      flashBanner(liveEndFailedText, "#d32f2f");
    } catch {
      flashBanner(liveEndFailedText, "#d32f2f");
    } finally {
      endingLiveRef.current = false;
    }
  }, [
    channelId,
    endLiveSessionLocally,
    flashBanner,
    handleLiveStartedEvent,
    liveEndFailedText,
    liveSessionChangedText,
    liveSessionId,
    loadNormalChannelData,
    setShowEndLiveConfirm,
    setShowLiveEnded,
  ]);

  const cancelEndLive = useCallback(() => {
    setShowEndLiveConfirm(false);
  }, [setShowEndLiveConfirm]);

  const closeLiveEnded = useCallback(() => {
    setShowLiveEnded(false);
    void loadNormalChannelData().catch(() => {});
  }, [loadNormalChannelData, setShowLiveEnded]);

  const joinLivePopup = useCallback(() => {
    enterLiveMode({ markCurrentSessionSeen: true });
    void loadLiveChannelData().catch(() => {});
  }, [enterLiveMode, loadLiveChannelData]);

  const jumpFromGalleryImage = useCallback((msgId: string) => {
    closeFullViewImage();
    closeGallery();
    void scrollToMessage(msgId, "media");
  }, [closeFullViewImage, closeGallery, scrollToMessage]);

  return {
    closeModerationPetitionDialog,
    viewGalleryImage,
    handleOverlayEmojiSelect,
    openPlusPhotoPicker,
    togglePlusDmMode,
    closePlusMenu,
    startLiveFromPrompt,
    closeLiveTitlePrompt,
    confirmEndLive,
    cancelEndLive,
    closeLiveEnded,
    joinLivePopup,
    jumpFromGalleryImage,
    dismissLivePopup,
  };
}
