"use client";

import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { adminAction, fetchGallery, submitChannelReport } from "@/lib/api";

interface ChannelState {
  is_frozen: number;
}

interface GalleryItem {
  id: string;
  image: string;
  created_at: string;
}

interface BannerState {
  text: string;
  color: string;
}

interface UseChatAdminChannelActionsArgs<TChannel extends ChannelState> {
  channelId: string;
  channel: TChannel | null;
  channelName?: string | null;
  ownerChannelCount: number;
  inLiveMode: boolean;
  liveActive: boolean;
  bubbleColor: string;
  galleryItems: GalleryItem[];
  galleryHasMore: boolean;
  galleryLoadingRef: MutableRefObject<boolean>;
  setChannel: Dispatch<SetStateAction<TChannel | null>>;
  setBanner: Dispatch<SetStateAction<BannerState | null>>;
  setGalleryItems: Dispatch<SetStateAction<GalleryItem[]>>;
  setGalleryHasMore: Dispatch<SetStateAction<boolean>>;
  onOpenLiveTitlePrompt: () => void;
  onOpenEndLiveConfirm: () => void;
  text: {
    chatUnfrozen: string;
    chatFrozen: string;
    channelLinkCopied: string;
    channelShareFailed: string;
    channelReported: string;
    reportAlreadySubmitted: string;
    reportOwnerCannot: string;
    reportChannelFailed: string;
  };
}

export interface UseChatAdminChannelActionsResult {
  headerMenu: DOMRect | null;
  showSettings: boolean;
  showNotice: boolean;
  showGallery: boolean;
  showLinks: boolean;
  showAdminPanel: boolean;
  showOwnerChannels: boolean;
  showChannelReportDialog: boolean;
  showNoticeEdit: boolean;
  showEmojiPreset: boolean;
  submittingChannelReport: boolean;
  openHeaderMenu: (rect: DOMRect) => void;
  closeHeaderMenu: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openNotice: () => void;
  closeNotice: () => void;
  openLinks: () => void;
  closeLinks: () => void;
  openAdminPanel: () => void;
  closeAdminPanel: () => void;
  openOwnerChannels: () => void;
  closeOwnerChannels: () => void;
  openChannelReportDialog: () => void;
  closeChannelReportDialog: () => void;
  openNoticeEdit: () => void;
  closeNoticeEdit: () => void;
  openEmojiPreset: () => void;
  closeEmojiPreset: () => void;
  openGallery: () => void;
  closeGallery: () => void;
  loadMoreGallery: () => void;
  handleAdminFreezeToggle: () => void;
  handleAdminLiveToggle: () => void;
  handleShareChannel: () => Promise<void>;
  handleChannelReportSubmit: (reason: string, details: string) => Promise<void>;
}

export function useChatAdminChannelActions<TChannel extends ChannelState>({
  channelId,
  channel,
  channelName,
  ownerChannelCount,
  inLiveMode,
  liveActive,
  bubbleColor,
  galleryItems,
  galleryHasMore,
  galleryLoadingRef,
  setChannel,
  setBanner,
  setGalleryItems,
  setGalleryHasMore,
  onOpenLiveTitlePrompt,
  onOpenEndLiveConfirm,
  text,
}: UseChatAdminChannelActionsArgs<TChannel>): UseChatAdminChannelActionsResult {
  const [headerMenu, setHeaderMenu] = useState<DOMRect | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showOwnerChannels, setShowOwnerChannels] = useState(false);
  const [showChannelReportDialog, setShowChannelReportDialog] = useState(false);
  const [showNoticeEdit, setShowNoticeEdit] = useState(false);
  const [showEmojiPreset, setShowEmojiPreset] = useState(false);
  const [submittingChannelReport, setSubmittingChannelReport] = useState(false);

  const flashBanner = useCallback((message: string, color: string, durationMs = 3000) => {
    setBanner({ text: message, color });
    setTimeout(() => setBanner(null), durationMs);
  }, [setBanner]);

  const openHeaderMenu = useCallback((rect: DOMRect) => {
    setHeaderMenu(rect);
  }, []);

  const closeHeaderMenu = useCallback(() => {
    setHeaderMenu(null);
  }, []);

  const openSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  const openNotice = useCallback(() => {
    setShowNotice(true);
  }, []);

  const closeNotice = useCallback(() => {
    setShowNotice(false);
  }, []);

  const openLinks = useCallback(() => {
    setShowLinks(true);
  }, []);

  const closeLinks = useCallback(() => {
    setShowLinks(false);
  }, []);

  const openAdminPanel = useCallback(() => {
    setShowSettings(false);
    setShowAdminPanel(true);
  }, []);

  const closeAdminPanel = useCallback(() => {
    setShowAdminPanel(false);
  }, []);

  const openOwnerChannels = useCallback(() => {
    if (ownerChannelCount >= 2) {
      setShowOwnerChannels(true);
    }
  }, [ownerChannelCount]);

  const closeOwnerChannels = useCallback(() => {
    setShowOwnerChannels(false);
  }, []);

  const openChannelReportDialog = useCallback(() => {
    setShowChannelReportDialog(true);
  }, []);

  const closeChannelReportDialog = useCallback(() => {
    setShowChannelReportDialog((current) => {
      if (submittingChannelReport) return current;
      return false;
    });
  }, [submittingChannelReport]);

  const openNoticeEdit = useCallback(() => {
    setShowNoticeEdit(true);
  }, []);

  const closeNoticeEdit = useCallback(() => {
    setShowNoticeEdit(false);
  }, []);

  const openEmojiPreset = useCallback(() => {
    setShowEmojiPreset(true);
  }, []);

  const closeEmojiPreset = useCallback(() => {
    setShowEmojiPreset(false);
  }, []);

  const openGallery = useCallback(() => {
    setShowGallery(true);
    setGalleryItems([]);
    setGalleryHasMore(true);
    const fetchChannel = inLiveMode ? `${channelId}_live` : channelId;
    void fetchGallery(fetchChannel).then((data) => {
      if (data.gallery) {
        setGalleryItems(data.gallery);
        if (data.gallery.length < 50) {
          setGalleryHasMore(false);
        }
      }
    });
  }, [channelId, inLiveMode, setGalleryHasMore, setGalleryItems]);

  const closeGallery = useCallback(() => {
    setShowGallery(false);
  }, []);

  const loadMoreGallery = useCallback(() => {
    if (galleryLoadingRef.current || !galleryHasMore || galleryItems.length === 0) return;
    galleryLoadingRef.current = true;
    const oldest = galleryItems[galleryItems.length - 1];
    const fetchChannel = inLiveMode ? `${channelId}_live` : channelId;
    void fetchGallery(fetchChannel, oldest.created_at)
      .then((data) => {
        if (data.gallery && data.gallery.length > 0) {
          setGalleryItems((previous) => [...previous, ...data.gallery]);
          if (data.gallery.length < 50) {
            setGalleryHasMore(false);
          }
        } else {
          setGalleryHasMore(false);
        }
      })
      .finally(() => {
        galleryLoadingRef.current = false;
      });
  }, [
    channelId,
    galleryHasMore,
    galleryItems,
    galleryLoadingRef,
    inLiveMode,
    setGalleryHasMore,
    setGalleryItems,
  ]);

  const handleAdminFreezeToggle = useCallback(() => {
    if (channel?.is_frozen) {
      setChannel((previous) => previous ? { ...previous, is_frozen: 0 } : null);
      adminAction("freeze", inLiveMode ? `${channelId}_live` : channelId, { frozen: false });
      flashBanner(text.chatUnfrozen, bubbleColor);
      return;
    }

    setChannel((previous) => previous ? { ...previous, is_frozen: 1 } : null);
    adminAction("freeze", inLiveMode ? `${channelId}_live` : channelId, { frozen: true });
    flashBanner(text.chatFrozen, "#4a4d8f");
  }, [bubbleColor, channel?.is_frozen, channelId, flashBanner, inLiveMode, setChannel, text.chatFrozen, text.chatUnfrozen]);

  const handleAdminLiveToggle = useCallback(() => {
    if (liveActive) {
      onOpenEndLiveConfirm();
      return;
    }
    onOpenLiveTitlePrompt();
  }, [liveActive, onOpenEndLiveConfirm, onOpenLiveTitlePrompt]);

  const handleShareChannel = useCallback(async () => {
    const url = `${window.location.origin}/ch/${encodeURIComponent(channelId)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: channelName || channelId, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      flashBanner(text.channelLinkCopied, bubbleColor, 2500);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        flashBanner(text.channelLinkCopied, bubbleColor, 2500);
      } catch {
        flashBanner(text.channelShareFailed, "#d32f2f", 2500);
      }
    }
  }, [bubbleColor, channelId, channelName, flashBanner, text.channelLinkCopied, text.channelShareFailed]);

  const handleChannelReportSubmit = useCallback(async (reason: string, details: string) => {
    if (submittingChannelReport) return;
    setSubmittingChannelReport(true);
    try {
      const result = await submitChannelReport({
        channel_id: channelId,
        reason,
        details,
      }) as { ok?: boolean; error?: string; _status?: number };

      if (result?.ok) {
        setShowChannelReportDialog(false);
        flashBanner(text.channelReported, "#d32f2f");
      } else if (result?.error === "report_exists" || result?._status === 409) {
        setShowChannelReportDialog(false);
        flashBanner(text.reportAlreadySubmitted, "var(--meta)");
      } else if (result?.error === "channel_owner_cannot_report") {
        setShowChannelReportDialog(false);
        flashBanner(text.reportOwnerCannot, "#d32f2f");
      } else {
        flashBanner(text.reportChannelFailed, "#d32f2f");
      }
    } finally {
      setSubmittingChannelReport(false);
    }
  }, [
    channelId,
    flashBanner,
    submittingChannelReport,
    text.channelReported,
    text.reportAlreadySubmitted,
    text.reportChannelFailed,
    text.reportOwnerCannot,
  ]);

  return {
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
  };
}
