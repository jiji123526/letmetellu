"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { fetchInit, sendMessage as sendMessageApi, deleteMessage, editMessageApi, adminAction, toggleReaction, sendDm, uploadImage, fetchMessages, fetchGallery } from "@/lib/api";
import { generateFingerprint } from "@/lib/fingerprint";
import { useRealtime } from "@/hooks/useRealtime";
import { useAuth } from "@/hooks/useAuth";
import { useAutoUpdate } from "@/hooks/useAutoUpdate";
import { useLocale } from "@/hooks/useLocale";
import { ContextMenu } from "./ContextMenu";
import { ReactionBadge } from "./ReactionBadge";
import { ReplyBar } from "./ReplyBar";
import { ScrollToBottom } from "./ScrollToBottom";
import { WelcomePopup } from "./WelcomePopup";
import { HeaderMenu } from "./HeaderMenu";
import { SettingsPanel } from "./SettingsPanel";
import { NoticePanel } from "./NoticePanel";
import { EmojiPicker } from "./EmojiPicker";
import { GalleryPanel } from "./GalleryPanel";
import { LinksPanel } from "./LinksPanel";
import { PlusMenu } from "./PlusMenu";
import { EditDialog } from "./EditDialog";
import { LivePopup, LiveEndedPopup, LiveJoinBanner, LiveExitBanner, LiveTitlePrompt } from "./LiveMode";
import { ConfirmDialog } from "./ConfirmDialog";
import { NoticeEditDialog } from "./NoticeEditDialog";
import { NoticeBanner } from "./NoticeBanner";
import { SearchBar, highlightText } from "./SearchBar";
import { EmojiBar, spawnEmoji, EmojiPresetPanel } from "./EmojiBar";
import { AdminPanel } from "../admin/AdminPanel";

interface Message {
  id: string;
  uid: string;
  nick: string | null;
  text: string;
  is_admin: number;
  image: string | null;
  reactions: string;
  reply_to: string | null;
  created_at: string;
  channel_id?: string;
  dm?: boolean;
  deleted?: boolean;
  edited?: boolean;
  report?: number;
  reported_msg_id?: string;
}

interface Channel {
  id: string;
  owner_uid: string;
  name: string;
  profile_image: string | null;
  bubble_color: string;
  is_frozen: number;
  notice: string;
}

interface ContextMenuState {
  msg: Message;
  isSent: boolean;
  isOwn: boolean;
  rect: DOMRect;
  bubbleEl: HTMLElement;
}

function getOrCreateUid(): string {
  if (typeof window === "undefined") return "ssr";
  const key = "letsplay_uid";
  let uid = localStorage.getItem(key);
  if (!uid) {
    uid = crypto.randomUUID();
    localStorage.setItem(key, uid);
  }
  return uid;
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

function parseReactions(reactionsStr: string): Record<string, string> {
  try {
    const parsed = JSON.parse(reactionsStr);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function isSameGroup(_a: Message, _b: Message, _myUid: string) {
  return false;
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

// Message text with truncation (>1000 chars) and search highlight
function MessageText({ text, image, isMine, searchQuery, isSearchMatch, isActiveMatch }: { text: string; image: boolean; isMine: boolean; searchQuery: string; isSearchMatch: boolean; isActiveMatch: boolean }) {
  const [showOverlay, setShowOverlay] = useState(false);
  const isLong = text.length > 1000;
  const displayText = isLong ? text.slice(0, 1000) + "…" : text;

  const content = searchQuery && isSearchMatch
    ? highlightText(displayText, searchQuery, isActiveMatch)
    : displayText;

  return (
    <>
      <span style={image ? { display: "block", padding: "2px 10px 8px" } : undefined}>
        {content}
        {isLong && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowOverlay(true); }}
            style={{ display: "block", background: "none", border: "none", color: isMine ? "rgba(255,255,255,0.85)" : "var(--bubble-sent, #3b8df0)", cursor: "pointer", padding: "4px 0 0", fontSize: "var(--bubble-font-size)", fontFamily: "inherit", marginLeft: "auto", transform: "rotate(-90deg)", lineHeight: 1 }}
          >
            <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 13l5 5 5-5" /><path d="M7 6l5 5 5-5" /></svg>
          </button>
        )}
      </span>
      {/* Post overlay — full text dialog */}
      {showOverlay && (
        <div
          className="fixed inset-0 z-[500] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", padding: "20px" }}
          onClick={() => setShowOverlay(false)}
        >
          <div
            style={{ background: "var(--bg)", borderRadius: "20px", maxWidth: "400px", width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--hairline)" }}>
              <span />
              <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--meta)", fontSize: "18px", lineHeight: 1 }} onClick={() => setShowOverlay(false)}>✕</button>
            </div>
            <div style={{ padding: "18px", fontSize: "var(--bubble-font-size)", lineHeight: 1.6, color: "var(--gray-text)", overflowY: "auto", whiteSpace: "pre-wrap", wordWrap: "break-word" }}>
              {text}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ChatView({ channelId }: { channelId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<{ uid: string; reason: string }[]>([]);
  const [dmMessages, setDmMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [uid] = useState(getOrCreateUid);
  const [myFingerprint] = useState(() => typeof window !== "undefined" ? generateFingerprint() : "");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [headerMenu, setHeaderMenu] = useState<DOMRect | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [fullViewImage, setFullViewImage] = useState<{ src: string; caption?: string; date?: string; msgId?: string; fromGallery?: boolean } | null>(null);
  const [searchState, setSearchState] = useState<{ query: string; activeId: string | null; resultIds: string[] }>({ query: "", activeId: null, resultIds: [] });
  const [showGallery, setShowGallery] = useState(false);
  const [galleryItems, setGalleryItems] = useState<{ id: string; image: string; created_at: string }[]>([]);
  const [showLinks, setShowLinks] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const { isOwner, userId: authUserId } = useAuth(channel?.owner_uid);
  const { t } = useLocale();
  const [manualAdmin, setManualAdmin] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("isAdmin") === "true";
  });
  const isAdmin = isOwner || manualAdmin;
  const [adminViewAsUser, setAdminViewAsUser] = useState(false);
  const [liveActive, setLiveActive] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(`liveActive_${channelId}`) === "true";
  });
  const [inLiveMode, setInLiveMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(`inLiveMode_${channelId}`) === "true";
  });
  const [liveTitle, setLiveTitle] = useState(() => {
    if (typeof window === "undefined") return t("liveTitle");
    return localStorage.getItem(`liveTitle_${channelId}`) || t("liveTitle");
  });
  const [liveSessionId, setLiveSessionId] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(`liveSession_${channelId}`) || "";
  });
  const [showLivePopup, setShowLivePopup] = useState(false);
  const [showLiveEnded, setShowLiveEnded] = useState(false);
  const [showLiveTitlePrompt, setShowLiveTitlePrompt] = useState(false);
  const [showEndLiveConfirm, setShowEndLiveConfirm] = useState(false);
  const [showEmojiPreset, setShowEmojiPreset] = useState(false);
  const [emojiPresets, setEmojiPresets] = useState<string[] | null>(null);
  const [showNoticeEdit, setShowNoticeEdit] = useState(false);
  const [activeNotice, setActiveNotice] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(`activeNotice_${channelId}`) || "";
  });
  const [welcomeConfig, setWelcomeConfig] = useState("");
  const [petitionEnabled, setPetitionEnabled] = useState(true);
  const [dmEnabled, setDmEnabled] = useState(true);
  const [localBubbleColor, setLocalBubbleColor] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(`bubbleColor_${channelId}`);
  });
  const [emojiPicker, setEmojiPicker] = useState<{ msgId: string; rect: DOMRect } | null>(null);
  const [editingMsg, setEditingMsg] = useState<{ id: string; text: string } | null>(null);
  const [plusMenu, setPlusMenu] = useState<DOMRect | null>(null);
  const [dmMode, setDmMode] = useState(false);
  const [banner, setBanner] = useState<{ text: string; color: string } | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState<{ blob: Blob; previewUrl: string; width: number; height: number }[]>([]);
  const [reportedMsgIds, setReportedMsgIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(localStorage.getItem("reportedMsgIds") || "[]")); } catch { return new Set(); }
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { connected, presence, liveCount, subscribe, send } = useRealtime(channelId, uid);

  // Auto-reload when new version is deployed (only when user has no draft)
  useAutoUpdate(!!(input || pendingPhotos.length > 0 || replyingTo || dmMode));

  // Notify DO of live mode join/leave for viewer count
  useEffect(() => {
    if (inLiveMode) {
      send({ type: "join-live" });
    } else {
      send({ type: "leave-live" });
    }
  }, [inLiveMode, send]);

  // Load initial data
  useEffect(() => {
    const initChannel = inLiveMode && liveActive ? `${channelId}_live` : channelId;
    fetchInit(initChannel)
      .then((data) => {
        setChannel(data.channel);
        setMessages(data.messages);
        if (data.blocked) setBlockedUsers(data.blocked);
        if (data.dm) setDmMessages(data.dm.map((d: any) => ({ ...d, dm: true })));
        setLoading(false);
        // Load banner notice from server
        if (data.bannerNotice) {
          setActiveNotice(data.bannerNotice);
        }
        // Load welcome config from server
        if (data.welcomeConfig) {
          setWelcomeConfig(data.welcomeConfig);
        }
        // Load live status from server
        if (data.live && data.live.active) {
          setLiveActive(true);
          setLiveTitle(data.live.title || t("liveTitle"));
          localStorage.setItem(`liveActive_${channelId}`, "true");
          localStorage.setItem(`liveTitle_${channelId}`, data.live.title || t("liveTitle"));
          if (data.live.sessionId) {
            setLiveSessionId(data.live.sessionId);
            localStorage.setItem(`liveSession_${channelId}`, data.live.sessionId);
          }
        }
        // Load emoji presets from server
        if (data.emojiPresets) {
          localStorage.setItem(`liveEmojis_${channelId}_live`, data.emojiPresets);
          try { setEmojiPresets(JSON.parse(data.emojiPresets)); } catch {}
        } else if (!data.live || !data.live.active) {
          // Server says live is not active — reset local state if stale
          if (liveActive || inLiveMode) {
            setLiveActive(false);
            setInLiveMode(false);
            localStorage.setItem(`liveActive_${channelId}`, "false");
            localStorage.setItem(`inLiveMode_${channelId}`, "false");
            // Refetch from normal channel since we loaded from _live
            if (initChannel !== channelId) {
              fetchInit(channelId).then((d) => {
                setMessages(d.messages);
                if (d.dm) setDmMessages(d.dm.map((dm: any) => ({ ...dm, dm: true })));
              });
            }
          }
        }
      })
      .catch(console.error);
  }, [channelId]);

  const bubbleColor = localBubbleColor || channel?.bubble_color || "#3b8df0";

  // Sync bubble color to CSS variable so var(--bubble-sent) works everywhere
  useEffect(() => {
    document.documentElement.style.setProperty("--bubble-sent", bubbleColor);
  }, [bubbleColor]);

  // Track inLiveMode in a ref so the subscribe callback always has the latest value
  const inLiveModeRef = useRef(inLiveMode);
  useEffect(() => { inLiveModeRef.current = inLiveMode; }, [inLiveMode]);

  // Debounce not needed — local patching handles most events, reconnect does full refetch

  // Listen for realtime updates
  useEffect(() => {
    return subscribe((event) => {
      // New message — append to local array
      if (event.type === "message-new") {
        const msg = event.message as Message;
        // Only add if it belongs to the channel we're viewing
        const viewingChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
        if (msg.channel_id === viewingChannel) {
          setMessages((prev) => {
            // Avoid duplicates (e.g. our own message already shown optimistically)
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }
      }
      // Message edited — patch text in place
      if (event.type === "message-edited") {
        const id = event.message_id as string;
        setMessages((prev) => prev.map((m) =>
          m.id === id ? { ...m, text: event.text as string, edited: true } : m
        ));
      }
      // Message deleted — remove or mark as deleted
      if (event.type === "message-deleted") {
        const id = event.message_id as string;
        if (event.soft) {
          setMessages((prev) => prev.map((m) =>
            m.id === id ? { ...m, deleted: true, text: t("deletedMessage"), image: null } : m
          ));
        } else {
          setMessages((prev) => prev.filter((m) => m.id !== id));
        }
      }
      // Reconnect or bulk sync — full refetch as safety net
      if (event.type === "reconnected" || event.type === "messages-sync") {
        const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
        fetchMessages(fetchChannel).then((data) => {
          if (data.messages) setMessages(data.messages);
        }).catch(() => {});
      }
      // Re-send join-live on reconnect so DO has accurate count
      if (event.type === "reconnected" && inLiveModeRef.current) {
        send({ type: "join-live" });
      }
      if (event.type === "dm-new") {
        const dm = event.dm as Message;
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
        setChannel((prev) => prev ? { ...prev, is_frozen: event.frozen ? 1 : 0 } : null);
      }
      if (event.type === "profile-change") {
        setChannel((prev) => {
          if (!prev) return null;
          const updated = { ...prev };
          if (event.name) updated.name = event.name as string;
          if (event.profile_image !== undefined) updated.profile_image = event.profile_image as string | null;
          if (event.bubble_color) updated.bubble_color = event.bubble_color as string;
          return updated;
        });
      }
      if (event.type === "emoji-fx") {
        spawnEmoji(event.emoji as string, event.x as number, event.h as number);
      }
      if (event.type === "reaction-changed") {
        const msgId = event.message_id as string;
        const newReactions = event.reactions as string;
        setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, reactions: newReactions } : m));
      }
      if (event.type === "live-ended") {
        localStorage.setItem(`liveActive_${channelId}`, "false");
        localStorage.removeItem(`liveSeen_${channelId}`);
        localStorage.removeItem(`liveTitle_${channelId}`);
        localStorage.removeItem(`liveSession_${channelId}`);
        setLiveActive(false);
        if (inLiveModeRef.current) {
          setInLiveMode(false);
          localStorage.setItem(`inLiveMode_${channelId}`, "false");
          setShowLiveEnded(true);
          // Refetch normal messages and DMs
          fetchInit(channelId).then((data) => {
            setMessages(data.messages);
            setDmMessages(data.dm ? data.dm.map((d: any) => ({ ...d, dm: true })) : []);
          }).catch(() => {});
        }
      }
      if (event.type === "live-started") {
        const sessionId = (event.sessionId as string) || "";
        setLiveActive(true);
        setLiveTitle((event.title as string) || t("liveTitle"));
        setLiveSessionId(sessionId);
        localStorage.setItem(`liveActive_${channelId}`, "true");
        localStorage.setItem(`liveTitle_${channelId}`, (event.title as string) || t("liveTitle"));
        localStorage.setItem(`liveSession_${channelId}`, sessionId);
        // Show popup only if not already in live mode and haven't dismissed this session
        if (!inLiveModeRef.current) {
          const seen = localStorage.getItem(`liveSeen_${channelId}`);
          if (seen === sessionId) {
            // Already dismissed — just show banner (handled by liveActive + !inLiveMode in render)
          } else {
            setShowLivePopup(true);
          }
        }
      }
      if (event.type === "notice-changed") {
        setActiveNotice((event.notice as string) || "");
      }
      if (event.type === "rules-changed") {
        setChannel((prev) => prev ? { ...prev, notice: event.rules as string } : null);
      }
      if (event.type === "emoji-presets-changed") {
        localStorage.setItem(`liveEmojis_${channelId}_live`, event.emojis as string);
        try { setEmojiPresets(JSON.parse(event.emojis as string)); } catch {}
      }
    });
  }, [subscribe, channelId, send]);

  // Refetch on tab focus only if backgrounded for >5 minutes (safety net for missed broadcasts)
  useEffect(() => {
    let lastHidden = 0;
    const handler = () => {
      if (document.visibilityState === "hidden") {
        lastHidden = Date.now();
      } else if (document.visibilityState === "visible" && lastHidden && Date.now() - lastHidden > 5 * 60 * 1000) {
        const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
        fetchMessages(fetchChannel).then((data) => {
          if (data.messages) setMessages(data.messages);
        });
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [channelId]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (!showScrollBtn) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, showScrollBtn]);

  // Scroll detection for scroll-to-bottom button
  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distanceFromBottom > 200);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowScrollBtn(false);
  };

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 80) + "px";
  };

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && pendingPhotos.length === 0) || (channel?.is_frozen && !effectiveAdmin && !dmMode)) return;

    // Blocked user handling
    if (isUserBlocked) {
      if (hasPetitioned || !petitionEnabled) {
        setBanner({ text: t("blocked"), color: "#d32f2f" });
        setTimeout(() => setBanner(null), 3000);
        return;
      }
      // Send one-time petition DM
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      const blockEntry = blockedUsers.find((b) => b.uid === uid);
      const reason = blockEntry?.reason ? `\n[차단 사유: "${blockEntry.reason}"]` : "";
      sendDm({ uid, text: `[이의 제기] ${text}${reason}`, channel_id: inLiveMode ? `${channelId}_live` : channelId });
      localStorage.setItem("petitionSent", uid);
      setBanner({ text: t("petitionSent"), color: "#d32f2f" });
      setTimeout(() => setBanner(null), 3000);
      return;
    }

    // Send photos + text
    const photos = [...pendingPhotos];
    setPendingPhotos([]);
    const savedReplyTo = replyingTo?.id;
    setReplyingTo(null);

    // DM mode
    if (dmMode) {
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setDmMode(false);
      setBanner({ text: t("sentToAdmin"), color: "#7b3fa0" });
      setTimeout(() => setBanner(null), 3000);
      const dmChannelId = inLiveMode ? `${channelId}_live` : channelId;
      const dmImage = photos.length > 0 ? await uploadImage(photos[0].blob, dmChannelId) || undefined : undefined;
      sendDm({ uid, text, channel_id: dmChannelId, image: dmImage });
      return;
    }

    // Dismiss keyboard after send (except in live mode where keyboard stays)
    if (!inLiveMode && textareaRef.current) textareaRef.current.blur();

    const activeChannelId = inLiveMode ? `${channelId}_live` : channelId;

    const res = await sendMessageApi({
      uid: effectiveAdmin && authUserId ? authUserId : uid,
      text,
      channel_id: activeChannelId,
      image: photos.length > 0 ? await uploadImage(photos[0].blob, activeChannelId) || undefined : undefined,
      reply_to: savedReplyTo,
      fingerprint: myFingerprint,
    }) as any;

    if (res.error) {
      // Keep input on failure
      if (photos.length > 0) setPendingPhotos(photos);
      if (res.error === "message_too_long") setBanner({ text: t("messageTooLong"), color: "#d32f2f" });
      else if (res.error === "banned_word") setBanner({ text: t("bannedWord"), color: "#d32f2f" });
      else if (res.error === "rate_limited") setBanner({ text: t("rateLimited"), color: "#d32f2f" });
      else if (res.error === "blocked") setBanner({ text: t("blocked"), color: "#d32f2f" });
      else if (res.error === "channel frozen") setBanner({ text: t("chatFrozen"), color: "#4a4d8f" });
      else setBanner({ text: t("sendFailed"), color: "#d32f2f" });
      setTimeout(() => setBanner(null), 3000);
    }
    // On success: clear input, DO broadcasts message-changed → refetch shows the message
    if (!res.error) {
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  // Context menu handlers
  const handleBubbleLongPress = (msg: Message, isSent: boolean, el: HTMLElement) => {
    // Dismiss keyboard
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const rect = el.getBoundingClientRect();
    const isOwn = effectiveAdmin ? !!msg.is_admin : msg.uid === uid;
    setContextMenu({ msg, isSent, isOwn, rect, bubbleEl: el });
  };

  const handleTouchStart = (msg: Message, isSent: boolean, el: HTMLElement) => {
    longPressTimer.current = setTimeout(() => {
      handleBubbleLongPress(msg, isSent, el);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleReaction = (msgId: string, emoji: string) => {
    // Optimistic reaction update
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const reactions = parseReactions(m.reactions);
        const key = `${uid}_${Date.now()}`;
        // Check if user already reacted with this emoji
        const existingKey = Object.entries(reactions).find(
          ([k, v]) => k.startsWith(`${uid}_`) && v === emoji
        )?.[0];
        if (existingKey) {
          delete reactions[existingKey]; // toggle off
        } else {
          reactions[key] = emoji; // add
        }
        return { ...m, reactions: JSON.stringify(reactions) };
      })
    );
    toggleReaction({ uid, message_id: msgId, channel_id: channelId, emoji });
  };

  const handleAvatarClick = () => {
    clickCountRef.current++;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => { clickCountRef.current = 0; }, 500);
    if (clickCountRef.current >= 3) {
      clickCountRef.current = 0;
      const newAdmin = !manualAdmin;
      setManualAdmin(newAdmin);
      localStorage.setItem("isAdmin", String(newAdmin));
      setBanner({ text: newAdmin ? t("adminModeOn") : t("adminModeOff"), color: newAdmin ? "#3b8df0" : "var(--meta)" });
      setTimeout(() => setBanner(null), 2000);
    }
  };

  // Effective admin state (false when viewing as user)
  const effectiveAdmin = isAdmin && !adminViewAsUser;

  // Check if current user is blocked
  const isUserBlocked = !effectiveAdmin && blockedUsers.some((b) => b.uid === uid || (myFingerprint && (b as any).fingerprint === myFingerprint));
  const hasPetitioned = typeof window !== "undefined" && localStorage.getItem("petitionSent") === uid;
  // Reset petition status when unblocked (gives another chance on re-block)
  if (!isUserBlocked && hasPetitioned && typeof window !== "undefined") {
    localStorage.removeItem("petitionSent");
  }

  const handleDelete = (msgId: string) => {
    // Check if this message has replies (if so, soft delete; otherwise hard delete)
    const hasReplies = messages.some((m) => m.reply_to === msgId);
    if (hasReplies) {
      // Soft delete — keep message but mark as deleted
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, text: t("deletedMessage"), image: null, deleted: true } as Message : m))
      );
    } else {
      // Hard delete — remove completely
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    }
    // Send to backend
    // Send to backend — admin uses adminAction, non-admin uses ownership-checked endpoint
    if (effectiveAdmin) {
      const msg = messages.find((m) => m.id === msgId) || dmMessages.find((m) => m.id === msgId);
      if (msg?.dm) {
        adminAction("delete-dm", channelId, { dm_id: msgId });
        setDmMessages((prev) => prev.filter((m) => m.id !== msgId));
      } else {
        adminAction("delete-message", channelId, { message_id: msgId });
      }
    } else {
      deleteMessage({ uid, message_id: msgId, channel_id: channelId, soft: hasReplies });
    }
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newPhotos: typeof pendingPhotos = [];
    for (const file of Array.from(files)) {
      if (file.type === "image/gif") {
        const previewUrl = URL.createObjectURL(file);
        const dims = await getImageDimensions(file);
        newPhotos.push({ blob: file, previewUrl, width: dims.width, height: dims.height });
      } else {
        const { blob, width, height } = await compressImage(file, 1200, 0.8);
        const previewUrl = URL.createObjectURL(blob);
        newPhotos.push({ blob, previewUrl, width, height });
      }
    }
    setPendingPhotos((prev) => [...prev, ...newPhotos]);
    // Reset input
    e.target.value = "";
    textareaRef.current?.focus();
  };

  const removePendingPhoto = (idx: number) => {
    setPendingPhotos((prev) => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[idx].previewUrl);
      updated.splice(idx, 1);
      return updated;
    });
  };

  if (loading) {
    return (
      <div className="h-dvh flex flex-col" style={{ background: "var(--bg)" }}>
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

  return (
    <div className="h-dvh flex flex-col relative" style={{ background: "var(--bg)", color: "var(--gray-text)" }}>
      {/* Header */}
      <header
        className="flex-none flex items-center px-4 relative"
        style={{
          background: "var(--header-bg)",
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          borderBottom: "0.5px solid var(--hairline)",
          padding: "10px 16px",
          zIndex: 5,
        }}
      >
        {/* Notice button — only show if rules exist */}
        {channel?.notice && channel.notice !== "[]" && (
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 p-0 border-none bg-transparent cursor-pointer flex items-center"
          style={{ color: bubbleColor }}
          onClick={() => setShowNotice(true)}
        >
          <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 6px)", height: "calc(var(--bubble-font-size) + 6px)" }}>
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M12 16v-4M12 8h.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        )}

        <div className="flex-1 flex flex-col items-center gap-[6px]">
          <div
            className="rounded-full overflow-hidden relative top-[3px] cursor-pointer"
            style={{ width: "calc(var(--bubble-font-size) + 24px)", height: "calc(var(--bubble-font-size) + 24px)" }}
            onClick={handleAvatarClick}
          >
            {channel?.profile_image ? (
              <img src={channel.profile_image} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-lg" style={{ background: "var(--gray-bubble)" }}>💬</div>
            )}
          </div>
          <div className="font-normal flex items-center gap-[2px]" style={{ fontSize: "calc(var(--bubble-font-size) - 5px)", color: "var(--gray-text)" }}>
            {channel?.name}
          </div>
        </div>

        <button
          className="absolute right-[52px] top-1/2 -translate-y-1/2 p-0 border-none bg-transparent cursor-pointer flex items-center"
          style={{ color: bubbleColor }}
          onClick={() => setShowSearch(!showSearch)}
        >
          <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 3px)", height: "calc(var(--bubble-font-size) + 3px)" }}>
            <circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M21 21l-4.35-4.35" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 p-0 border-none bg-transparent cursor-pointer flex items-center"
          style={{ color: bubbleColor }}
          onClick={(e) => setHeaderMenu(e.currentTarget.getBoundingClientRect())}
        >
          <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 5px)", height: "calc(var(--bubble-font-size) + 5px)" }}>
            <circle cx="12" cy="5" r="1.8" fill="currentColor" />
            <circle cx="12" cy="12" r="1.8" fill="currentColor" />
            <circle cx="12" cy="19" r="1.8" fill="currentColor" />
          </svg>
        </button>
      </header>

      {/* Search bar */}
      {showSearch && (
        <SearchBar
          channelId={channelId}
          messages={effectiveAdmin ? [...messages, ...dmMessages] : messages}
          onNavigate={(msgId) => {
            const el = document.getElementById(`msg-${msgId}`);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          onSearchState={setSearchState}
          onClose={() => setShowSearch(false)}
        />
      )}

      {/* Admin return banner */}
      {isAdmin && adminViewAsUser && (
        <div
          className="flex-none flex items-center justify-between"
          style={{
            padding: "6px 14px",
            background: `color-mix(in srgb, ${bubbleColor} 10%, transparent)`,
            borderBottom: `1px solid color-mix(in srgb, ${bubbleColor} 20%, transparent)`,
            fontSize: "calc(var(--bubble-font-size) - 5px)",
            color: bubbleColor,
          }}
        >
          <span>{t("viewingAsUser")}</span>
          <button
            className="border-none rounded-lg cursor-pointer"
            style={{
              background: bubbleColor,
              color: "#fff",
              padding: "4px 10px",
              fontSize: "calc(var(--bubble-font-size) - 5px)",
              fontWeight: 500,
            }}
            onClick={() => setAdminViewAsUser(false)}
          >
            {t("returnToAdmin")}
          </button>
        </div>
      )}

      {/* Live banners */}
      {liveActive && !inLiveMode && (
        <LiveJoinBanner title={liveTitle} onJoin={() => { setInLiveMode(true); localStorage.setItem(`inLiveMode_${channelId}`, "true"); setMessages([]); setDmMessages([]); fetchInit(`${channelId}_live`).then((data) => { setMessages(data.messages); if (data.dm) setDmMessages(data.dm.map((d: any) => ({ ...d, dm: true }))); }).catch(() => {}); }} />
      )}
      {inLiveMode && (
        <LiveExitBanner
          isAdmin={effectiveAdmin}
          title={liveTitle}
          viewerCount={liveCount}
          onExit={() => {
            if (effectiveAdmin) {
              setShowEndLiveConfirm(true);
            } else {
              // Non-admin just leaves live mode (live continues for others)
              setInLiveMode(false);
              localStorage.setItem(`inLiveMode_${channelId}`, "false");
              // Refetch normal channel messages
              fetchInit(channelId).then((data) => { setMessages(data.messages); });
            }
          }}
        />
      )}

      {/* Notice Banner */}
      {activeNotice && (
        <NoticeBanner
          channelId={channelId}
          notice={activeNotice}
          onDismiss={() => setActiveNotice("")}
        />
      )}

      {/* Offline banner */}
      {!connected && !loading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "6px 12px", background: "#fff3e0", borderBottom: "0.5px solid #ffe0b2", flexShrink: 0, fontSize: "calc(var(--bubble-font-size) - 4px)", color: "#e65100", lineHeight: 1 }}>
          <span>{t("connectionLost")}</span>
        </div>
      )}

      {/* Messages */}
      <main
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="messages-scroll flex-1 overflow-y-auto overflow-x-hidden flex flex-col"
        style={{ padding: "12px 14px 8px", WebkitOverflowScrolling: "touch" }}
      >
        {(() => {
          // Merge DMs into messages when admin is active
          const allMsgs = effectiveAdmin
            ? [...messages, ...dmMessages].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""))
            : messages.filter((m) => !m.report);

          // Separate top-level messages and replies (threaded under parent)
          const topLevel: Message[] = [];
          const repliesMap: Record<string, Message[]> = {};
          const messageIds = new Set(allMsgs.map((m) => m.id));

          allMsgs.forEach((m) => {
            if (m.reply_to && messageIds.has(m.reply_to)) {
              if (!repliesMap[m.reply_to]) repliesMap[m.reply_to] = [];
              repliesMap[m.reply_to].push(m);
            } else {
              topLevel.push(m);
            }
          });

          const renderBubble = (msg: Message, prev: Message | null, next: Message | null, isReply: boolean, parentMsg: Message | null) => {
            // Determine parent's side (replies always follow parent's side)
            const parentIsSent = parentMsg
              ? (effectiveAdmin ? !!parentMsg.is_admin : !parentMsg.is_admin)
              : false;

            // Reply messages follow parent's side; normal messages use their own side
            // Non-admin view: admin messages = left (recv), all others = right (sent)
            // Admin view: admin messages = right (sent), all others = left (recv)
            const isSent = isReply
              ? parentIsSent
              : (effectiveAdmin ? !!msg.is_admin : !msg.is_admin);

            // For bubble COLOR: replies use their own identity, not parent's side
            // admin view: admin reply = mine (blue), user reply = other (gray)
            // non-admin view: user reply = mine (blue), admin reply = other (gray)
            const isMine = effectiveAdmin ? !!msg.is_admin : !msg.is_admin;

            const isGroupStart = !isReply && (!prev || !isSameGroup(prev, msg, uid));
            const isLast = !isReply && (!next || !isSameGroup(msg, next, uid));
            const reactions = parseReactions(msg.reactions);

            const bubble = (
              <div
                className="relative max-w-full break-words whitespace-pre-wrap select-none"
                style={{
                  padding: msg.image ? "4px 4px 0" : "calc(var(--bubble-font-size) * 0.588) calc(var(--bubble-font-size) * 0.824)",
                  fontSize: "var(--bubble-font-size)",
                  lineHeight: 1.38,
                  overflowWrap: "anywhere",
                  borderRadius: !isReply && isLast
                    ? isSent ? "20px 20px 4px 20px" : "20px 20px 20px 4px"
                    : "20px",
                  background: msg.report
                    ? "#ffeaea"
                    : reportedMsgIds.has(msg.id)
                      ? "#ffe0e0"
                      : (effectiveAdmin && !msg.report && allMsgs.some((r) => r.report && r.reported_msg_id === msg.id))
                        ? "#ffe0e0"
                        : msg.dm
                          ? (isMine ? "#7b3fa0" : "#ddc8ed")
                          : isMine
                            ? bubbleColor
                            : "var(--gray-bubble)",
                  color: msg.report
                    ? "#c00"
                    : reportedMsgIds.has(msg.id) || (effectiveAdmin && allMsgs.some((r) => r.report && r.reported_msg_id === msg.id))
                      ? "#a00"
                      : msg.dm
                        ? (isMine ? "#fff" : "#5a1580")
                        : isMine ? "#fff" : "var(--gray-text)",
                  cursor: msg.report && msg.reported_msg_id ? "pointer" : undefined,
                  opacity: reportedMsgIds.has(msg.id) ? 0.6
                    : (effectiveAdmin && blockedUsers.some((b) => b.uid === msg.uid)) ? 0.4
                    : undefined,
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!msg.deleted) handleBubbleLongPress(msg, isSent, e.currentTarget);
                }}
                onClick={() => {
                  if (msg.report && msg.reported_msg_id && effectiveAdmin) {
                    const el = document.getElementById(`msg-${msg.reported_msg_id}`);
                    if (el) {
                      el.scrollIntoView({ behavior: "smooth", block: "center" });
                      const bubble = el.querySelector("[class*='relative']") as HTMLElement;
                      if (bubble) {
                        bubble.style.boxShadow = "0 0 0 2px #ff1744 inset";
                        bubble.style.transition = "box-shadow 0.8s ease-out";
                        setTimeout(() => { bubble.style.boxShadow = "none"; }, 100);
                        setTimeout(() => { bubble.style.boxShadow = ""; bubble.style.transition = ""; }, 1000);
                      }
                    }
                  }
                }}
                onTouchStart={(e) => { if (!msg.deleted) handleTouchStart(msg, isSent, e.currentTarget); }}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchEnd}
              >
                {msg.deleted ? (
                  <span style={{ fontStyle: "italic", opacity: 0.5 }}>{t("deletedMessage")}</span>
                ) : (
                  <>
                    {msg.image && (
                      <div className="relative inline-block">
                        <img
                          src={msg.image}
                          alt=""
                          className="block w-full max-w-[260px] h-auto rounded-[15px]"
                          style={{ objectFit: "contain" }}
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); setFullViewImage({ src: msg.image!, caption: msg.text || undefined, date: msg.created_at, msgId: msg.id }); }}
                          style={{ position: "absolute", top: "6px", right: "6px", width: "24px", height: "24px", border: "none", background: "rgba(0,0,0,.5)", color: "#fff", borderRadius: "6px", fontSize: "14px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
                        >⤢</button>
                      </div>
                    )}
                    {msg.text && <MessageText text={msg.text} image={!!msg.image} isMine={isMine} searchQuery={searchState.query} isSearchMatch={searchState.resultIds.includes(msg.id)} isActiveMatch={msg.id === searchState.activeId} />}
                    {!!msg.edited && <span style={{ fontSize: "calc(var(--bubble-font-size) - 6px)", opacity: 0.6, fontStyle: "italic", marginLeft: "4px" }}>(edited)</span>}
                  </>
                )}
              </div>
            );

            // Reply arrow SVG
            const replyArrow = isReply ? (
              <span
                className="flex items-center"
                style={{
                  color: "var(--meta)",
                  opacity: 0.7,
                  marginTop: "8px",
                  transform: parentIsSent ? "scaleY(-1)" : "scaleX(-1) scaleY(-1)",
                }}
              >
                <svg viewBox="0 0 16 16" style={{ width: "var(--bubble-font-size)", height: "var(--bubble-font-size)" }}>
                  <path d="M14 12C14 8 11 5 7 5H3M3 5l3-3M3 5l3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            ) : null;

            return (
              <div
                key={msg.id}
                id={`msg-${msg.id}`}
                className={`flex items-end gap-[6px] max-w-full ${isSent ? "justify-end" : "justify-start"}`}
                style={{
                  paddingTop: "calc(var(--bubble-font-size) * 0.18)",
                  paddingLeft: isReply && !parentIsSent ? "calc(var(--bubble-font-size) + 8px)" : undefined,
                  paddingRight: isReply && parentIsSent ? "calc(var(--bubble-font-size) + 8px)" : undefined,
                }}
              >
                <div className={`flex flex-col ${isReply ? "max-w-[85%]" : "max-w-[74%]"} ${isSent ? "items-end" : "items-start"}`}>
                  {/* Bubble with reply arrow */}
                  {isReply ? (
                    <div className={`flex items-start gap-1 ${parentIsSent ? "justify-end" : "justify-start"}`}>
                      {parentIsSent ? (
                        <>{bubble}{replyArrow}</>
                      ) : (
                        <>{replyArrow}{bubble}</>
                      )}
                    </div>
                  ) : (
                    bubble
                  )}

                  {/* Reactions */}
                  <ReactionBadge
                    reactions={reactions}
                    myUid={uid}
                    isSent={isSent}
                    isReply={isReply}
                    onReaction={(emoji) => handleReaction(msg.id, emoji)}
                    onEmojiPicker={(rect) => setEmojiPicker({ msgId: msg.id, rect })}
                  />
                </div>
              </div>
            );
          };

          const elements: React.ReactNode[] = [];

          topLevel.forEach((m, i) => {
            const prev = topLevel[i - 1] || null;
            const next = topLevel[i + 1] || null;
            elements.push(renderBubble(m, prev, next, false, null));

            // Render replies below parent
            const replies = repliesMap[m.id];
            if (replies) {
              replies.forEach((r, ri) => {
                const rPrev = ri === 0 ? m : replies[ri - 1];
                const rNext = replies[ri + 1] || null;
                elements.push(renderBubble(r, rPrev, rNext, true, m));
              });
            }
          });

          return elements;
        })()}
        <div ref={messagesEndRef} />
      </main>

      {/* Scroll to bottom */}
      <ScrollToBottom visible={showScrollBtn} onClick={scrollToBottom} />

      {/* Toast banner */}
      {banner && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[60] text-white font-normal px-4 py-[10px] rounded-[12px] text-center max-w-[90%]"
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
      <ReplyBar replyingTo={replyingTo} onClose={() => setReplyingTo(null)} />

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
            style={{ color: "var(--meta)", width: "32px", height: "32px" }}
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
              background: (channel?.is_frozen && !effectiveAdmin && !dmMode)
                ? "rgba(0,0,0,.03)"
                : isUserBlocked
                  ? "rgba(255,59,48,.05)"
                  : dmMode ? "rgba(155,89,182,.05)" : "var(--input-bg)",
              border: (channel?.is_frozen && !effectiveAdmin && !dmMode)
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
              disabled={!!(channel?.is_frozen && !effectiveAdmin && !dmMode) || (isUserBlocked && (hasPetitioned || !petitionEnabled))}
              rows={1}
              placeholder={
                (channel?.is_frozen && !effectiveAdmin && !dmMode)
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
                color: (channel?.is_frozen && !effectiveAdmin && !dmMode) ? "#999" : "var(--gray-text)",
                padding: "8px 0",
                caretColor: "var(--tint)",
                fontFamily: "inherit",
                lineHeight: 1.4,
                maxHeight: "80px",
                overflowY: "auto",
              }}
            />
            {/* Emoji bar trigger (live mode only) */}
            {inLiveMode && (
              <EmojiBar channelId={channelId} presets={emojiPresets} onBroadcast={(emoji, x, h) => {
                send({ type: "emoji-fx", emoji, x, h });
              }} />
            )}
            {(input.trim() || pendingPhotos.length > 0) && !(channel?.is_frozen && !effectiveAdmin && !dmMode) && (
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
          onReply={(msgId) => {
            // Reply to top-level parent, not to a reply
            const msg = messages.find((m) => m.id === msgId);
            if (msg?.reply_to) {
              const parent = messages.find((m) => m.id === msg.reply_to);
              if (parent) { setReplyingTo(parent); } else { setReplyingTo(msg); }
            } else if (msg) {
              setReplyingTo(msg);
            }
            textareaRef.current?.focus();
          }}
          onReport={!effectiveAdmin && !contextMenu.isOwn ? () => {
            const msgId = contextMenu.msg.id;
            const msgText = contextMenu.msg.text;
            setReportedMsgIds((prev) => {
              const next = new Set(prev);
              next.add(msgId);
              localStorage.setItem("reportedMsgIds", JSON.stringify([...next]));
              return next;
            });
            const preview = msgText.length > 50 ? msgText.slice(0, 50) + "…" : msgText;
            sendMessageApi({ uid, text: `🚨 신고된 채팅: "${preview}"`, channel_id: channelId, report: true, reported_msg_id: msgId } as any);
            setBanner({ text: t("report"), color: "#d32f2f" });
            setTimeout(() => setBanner(null), 3000);
          } : undefined}
          onUnreport={!effectiveAdmin && !contextMenu.isOwn ? () => {
            const msgId = contextMenu.msg.id;
            setReportedMsgIds((prev) => {
              const next = new Set(prev);
              next.delete(msgId);
              localStorage.setItem("reportedMsgIds", JSON.stringify([...next]));
              return next;
            });
            // Find and delete the report message from D1
            const reportMsg = messages.find((m) => m.report && m.reported_msg_id === msgId && m.uid === uid);
            if (reportMsg) {
              deleteMessage({ uid, message_id: reportMsg.id, channel_id: channelId, soft: false });
              setMessages((prev) => prev.filter((m) => m.id !== reportMsg.id));
            }
            setBanner({ text: t("unreport"), color: "var(--meta)" });
            setTimeout(() => setBanner(null), 3000);
          } : undefined}
          isReported={reportedMsgIds.has(contextMenu.msg.id)}
          onDelete={contextMenu.isOwn ? handleDelete : undefined}
          onDeleteWithReplies={effectiveAdmin && !contextMenu.isOwn ? (msgId) => {
            const targetMsg = messages.find((m) => m.id === msgId);
            const idsToDelete = new Set([msgId]);

            // If deleting a report message, also delete the reported message + its replies
            if (targetMsg?.report && targetMsg.reported_msg_id) {
              idsToDelete.add(targetMsg.reported_msg_id);
              messages.forEach((m) => { if (m.reply_to === targetMsg.reported_msg_id) idsToDelete.add(m.id); });
            }

            // Also delete replies of the target message
            messages.forEach((m) => { if (m.reply_to === msgId) idsToDelete.add(m.id); });

            setMessages((prev) => prev.filter((m) => !idsToDelete.has(m.id)));
            // Delete via admin endpoint
            idsToDelete.forEach((id) => {
              const msg = messages.find((m) => m.id === id) || dmMessages.find((m) => m.id === id);
              if (msg?.dm) adminAction("delete-dm", channelId, { dm_id: id });
              else adminAction("delete-message", channelId, { message_id: id });
            });
            setDmMessages((prev) => prev.filter((m) => !idsToDelete.has(m.id)));
            setBanner({ text: t("delete"), color: "#d32f2f" });
            setTimeout(() => setBanner(null), 3000);
          } : undefined}
          onEdit={contextMenu.isOwn ? (msgId) => {
            const msg = messages.find((m) => m.id === msgId);
            if (msg) setEditingMsg({ id: msg.id, text: msg.text });
          } : undefined}
          onBlock={effectiveAdmin && !contextMenu.isOwn ? (blockUid) => {
            const isBlocked = blockedUsers.some((b) => b.uid === blockUid);
            if (isBlocked) {
              adminAction("unblock", channelId, { uid: blockUid });
              setBlockedUsers((prev) => prev.filter((b) => b.uid !== blockUid));
              setBanner({ text: `익명#${blockUid.slice(-4)} 차단 해제`, color: "#2a9d4e" });
            } else {
              const msg = contextMenu.msg;
              adminAction("block", channelId, { uid: blockUid, reason: msg.text?.slice(0, 50) || "", fingerprint: "" });
              setBlockedUsers((prev) => [...prev, { uid: blockUid, reason: msg.text?.slice(0, 50) || "" }]);
              setBanner({ text: `익명#${blockUid.slice(-4)} 차단됨`, color: "#d32f2f" });
            }
            setTimeout(() => setBanner(null), 3000);
          } : undefined}
          isBlockedUser={blockedUsers.some((b) => b.uid === contextMenu.msg.uid)}
          onEmojiPicker={(msgId, rect) => setEmojiPicker({ msgId, rect })}
          onClose={() => setContextMenu(null)}
          isMyMessage={contextMenu.isOwn}
        />
      )}

      {/* Welcome Popup */}
      <WelcomePopup channelId={channelId} bubbleColor={bubbleColor} customConfig={welcomeConfig} />

      {/* Header Menu */}
      {headerMenu && (
        <HeaderMenu
          anchorRect={headerMenu}
          onSettings={() => setShowSettings(true)}
          onGallery={() => {
            setShowGallery(true);
            const fetchChannel = inLiveMode ? `${channelId}_live` : channelId;
            fetchGallery(fetchChannel).then((data) => {
              if (data.gallery) setGalleryItems(data.gallery);
            });
          }}
          onLinks={() => setShowLinks(true)}
          onAdmin={effectiveAdmin ? () => setShowAdminPanel(true) : undefined}
          onClose={() => setHeaderMenu(null)}
        />
      )}

      {/* Settings Panel */}
      {showSettings && (
        <SettingsPanel
          channelId={channelId}
          currentColor={bubbleColor}
          onColorChange={setLocalBubbleColor}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Gallery Panel */}
      {showGallery && (
        <GalleryPanel
          items={galleryItems}
          onViewImage={(src, meta) => {
            const msg = messages.find((m) => m.id === meta.id);
            setFullViewImage({ src, caption: msg?.text || undefined, date: meta.created_at, msgId: meta.id, fromGallery: true });
          }}
          onClose={() => setShowGallery(false)}
        />
      )}

      {/* Links Panel */}
      {showLinks && (
        <LinksPanel
          messages={messages}
          onClose={() => setShowLinks(false)}
        />
      )}

      {/* Admin Panel */}
      {showAdminPanel && (
        <AdminPanel
          channelId={channelId}
          channelName={channel?.name || ""}
          profileImage={channel?.profile_image || null}
          currentColor={bubbleColor}
          isFrozen={!!channel?.is_frozen}
          liveActive={liveActive}
          petitionEnabled={petitionEnabled}
          dmEnabled={dmEnabled}
          notice={channel?.notice || "[]"}
          welcomeConfig={welcomeConfig}
          blockedUsers={blockedUsers}
          onFreeze={() => {
            setChannel((prev) => prev ? { ...prev, is_frozen: 1 } : null);
            adminAction("freeze", channelId, { frozen: true });
            setBanner({ text: t("chatFrozen"), color: "#4a4d8f" });
            setTimeout(() => setBanner(null), 3000);
          }}
          onUnfreeze={() => {
            setChannel((prev) => prev ? { ...prev, is_frozen: 0 } : null);
            adminAction("freeze", channelId, { frozen: false });
            setBanner({ text: t("chatUnfrozen"), color: bubbleColor });
            setTimeout(() => setBanner(null), 3000);
          }}
          onToggleView={() => setAdminViewAsUser(true)}
          onLive={() => {
            if (liveActive) {
              // End live
              setLiveActive(false);
              setInLiveMode(false);
              fetchInit(channelId).then((data) => { setMessages(data.messages); });
              setBanner({ text: t("liveEnded"), color: "#c0392b" });
              setTimeout(() => setBanner(null), 3000);
            } else {
              // Show title prompt
              setShowLiveTitlePrompt(true);
            }
          }}
          onPetitionToggle={() => {
            setPetitionEnabled(!petitionEnabled);
            setBanner({ text: !petitionEnabled ? t("petitionAllowed") : t("petitionBlocked"), color: !petitionEnabled ? "#2a9d4e" : "#c0392b" });
            setTimeout(() => setBanner(null), 3000);
          }}
          onDmToggle={() => {
            setDmEnabled(!dmEnabled);
            setBanner({ text: !dmEnabled ? t("dmAllowed") : t("dmBlocked"), color: !dmEnabled ? "#2a9d4e" : "#c0392b" });
            setTimeout(() => setBanner(null), 3000);
          }}
          onColorChange={(color) => {
            setLocalBubbleColor(color);
            localStorage.setItem(`bubbleColor_${channelId}`, color);
            document.documentElement.style.setProperty("--bubble-sent", color);
            adminAction("update-profile", channelId, { bubble_color: color });
          }}
          onNameChange={(name) => {
            setChannel((prev) => prev ? { ...prev, name } : null);
            adminAction("update-profile", channelId, { name });
            setBanner({ text: t("nameChanged"), color: bubbleColor });
            setTimeout(() => setBanner(null), 3000);
          }}
          onProfileImageChange={(url) => {
            setChannel((prev) => prev ? { ...prev, profile_image: url } : null);
            adminAction("update-profile", channelId, { profile_image: url });
            setBanner({ text: t("profileChanged"), color: bubbleColor });
            setTimeout(() => setBanner(null), 3000);
          }}
          onNoticeChange={(noticeStr) => {
            setChannel((prev) => prev ? { ...prev, notice: noticeStr } : null);
            adminAction("set-rules", channelId, { rules: noticeStr });
            setBanner({ text: t("rulesChanged"), color: bubbleColor });
            setTimeout(() => setBanner(null), 3000);
          }}
          onWelcomeChange={(config) => {
            setWelcomeConfig(config);
            localStorage.setItem(`welcomeConfig_${channelId}`, config);
            adminAction("set-welcome", channelId, { config });
            setBanner({ text: t("welcomeChanged"), color: bubbleColor });
            setTimeout(() => setBanner(null), 3000);
          }}
          onUnblock={(blockUid) => {
            adminAction("unblock", channelId, { uid: blockUid });
            setBlockedUsers((prev) => prev.filter((b) => b.uid !== blockUid));
            setBanner({ text: t("chatUnfrozen"), color: "#2a9d4e" });
            setTimeout(() => setBanner(null), 3000);
          }}
          onClose={() => setShowAdminPanel(false)}
        />
      )}

      {/* Emoji Picker */}
      {emojiPicker && (
        <EmojiPicker
          anchorRect={emojiPicker.rect}
          onSelect={(emoji) => {
            handleReaction(emojiPicker.msgId, emoji);
            setEmojiPicker(null);
          }}
          onClose={() => setEmojiPicker(null)}
        />
      )}

      {/* Plus Menu */}
      {plusMenu && (
        <PlusMenu
          anchorRect={plusMenu}
          dmMode={dmMode}
          dmEnabled={dmEnabled}
          isAdmin={effectiveAdmin}
          inLiveMode={inLiveMode}
          onPhoto={() => photoInputRef.current?.click()}
          onDmToggle={() => setDmMode(!dmMode)}
          onNotice={effectiveAdmin ? () => setShowNoticeEdit(true) : undefined}
          onEmojiPreset={() => setShowEmojiPreset(true)}
          onClose={() => setPlusMenu(null)}
        />
      )}

      {/* Edit Dialog */}
      {editingMsg && (
        <EditDialog
          currentText={editingMsg.text}
          onSave={(newText) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === editingMsg.id ? { ...m, text: newText, edited: true } as Message : m))
            );
            editMessageApi({ uid, message_id: editingMsg.id, channel_id: channelId, text: newText });
          }}
          onClose={() => setEditingMsg(null)}
        />
      )}

      {/* Live Title Prompt */}
      {showLiveTitlePrompt && (
        <LiveTitlePrompt
          onStart={async (title) => {
            setShowLiveTitlePrompt(false);
            setLiveTitle(title);
            setLiveActive(true);
            setInLiveMode(true);
            setMessages([]);
            setDmMessages([]);
            localStorage.setItem(`liveActive_${channelId}`, "true");
            localStorage.setItem(`inLiveMode_${channelId}`, "true");
            localStorage.setItem(`liveTitle_${channelId}`, title);
            setBanner({ text: t("liveStarted"), color: "#c0392b" });
            setTimeout(() => setBanner(null), 3000);
            const res = await adminAction("start-live", channelId, { title }) as any;
            if (res?.sessionId) {
              setLiveSessionId(res.sessionId);
              localStorage.setItem(`liveSession_${channelId}`, res.sessionId);
            }
          }}
          onCancel={() => setShowLiveTitlePrompt(false)}
        />
      )}

      {/* End Live Confirm */}
      {showEndLiveConfirm && (
        <ConfirmDialog
          title={t("liveEndTitle")}
          message={t("liveEndMessage")}
          confirmLabel={t("liveEndBtn")}
          confirmColor="#c0392b"
          onConfirm={async () => {
            setShowEndLiveConfirm(false);
            setLiveActive(false);
            setInLiveMode(false);
            localStorage.setItem(`liveActive_${channelId}`, "false");
            localStorage.setItem(`inLiveMode_${channelId}`, "false");
            localStorage.removeItem(`liveSeen_${channelId}`);
            localStorage.removeItem(`liveTitle_${channelId}`);
            localStorage.removeItem(`liveSession_${channelId}`);
            await adminAction("end-live", channelId);
            fetchInit(channelId).then((data) => {
              setMessages(data.messages);
              setDmMessages(data.dm ? data.dm.map((d: any) => ({ ...d, dm: true })) : []);
            });
            setShowLiveEnded(true);
          }}
          onCancel={() => setShowEndLiveConfirm(false)}
        />
      )}

      {/* Live Ended Popup (shown to non-admin when kicked from live) */}
      {showLiveEnded && (
        <LiveEndedPopup onClose={() => {
          setShowLiveEnded(false);
          fetchInit(channelId).then((data) => { setMessages(data.messages); });
        }} />
      )}

      {/* Live Started Popup (shown to non-admin when live starts) */}
      {showLivePopup && (
        <LivePopup
          title={liveTitle}
          onJoin={() => {
            setShowLivePopup(false);
            setInLiveMode(true);
            localStorage.setItem(`inLiveMode_${channelId}`, "true");
            localStorage.setItem(`liveSeen_${channelId}`, liveSessionId);
            setMessages([]);
            setDmMessages([]);
            fetchInit(`${channelId}_live`).then((data) => { setMessages(data.messages); if (data.dm) setDmMessages(data.dm.map((d: any) => ({ ...d, dm: true }))); }).catch(() => {});
          }}
          onDismiss={() => {
            setShowLivePopup(false);
            // Mark as seen so banner shows instead of popup next time
            localStorage.setItem(`liveSeen_${channelId}`, liveSessionId);
          }}
        />
      )}

      {/* Emoji Preset Panel */}
      {showEmojiPreset && (
        <EmojiPresetPanel
          channelId={channelId}
          onClose={() => setShowEmojiPreset(false)}
        />
      )}

      {/* Notice Edit Dialog */}
      {showNoticeEdit && (
        <NoticeEditDialog
          currentTitle={(() => { try { const p = JSON.parse(activeNotice); return p.title || activeNotice; } catch { return activeNotice; } })()}
          currentBody={(() => { try { const p = JSON.parse(activeNotice); return p.body || ""; } catch { return ""; } })()}
          onSave={(title, body) => {
            if (!title) {
              setActiveNotice("");
              localStorage.removeItem(`activeNotice_${channelId}`);
              adminAction("set-notice", channelId, { text: "" });
              setBanner({ text: t("noticePosted"), color: "var(--meta)" });
            } else {
              const notice = body ? JSON.stringify({ title, body }) : title;
              setActiveNotice(notice);
              localStorage.setItem(`activeNotice_${channelId}`, notice);
              localStorage.removeItem(`noticeDismissed_${channelId}`);
              adminAction("set-notice", channelId, { text: notice });
              setBanner({ text: t("noticePosted"), color: bubbleColor });
            }
            setTimeout(() => setBanner(null), 3000);
          }}
          onClose={() => setShowNoticeEdit(false)}
        />
      )}

      {/* Notice Panel */}
      {showNotice && (
        <NoticePanel
          notice={(() => { try { return JSON.parse(channel?.notice || "[]"); } catch { return []; } })()}
          onClose={() => setShowNotice(false)}
        />
      )}

      {/* Full view image overlay */}
      {fullViewImage && (
        <div
          className="fixed inset-0 z-[120] flex flex-col items-center justify-center cursor-pointer animate-[ctxFade_0.2s_ease]"
          style={{ background: "rgba(0,0,0,.85)" }}
          onClick={() => setFullViewImage(null)}
        >
          <img
            src={fullViewImage.src}
            alt=""
            style={{ maxWidth: "90%", maxHeight: "70%", objectFit: "contain", borderRadius: "8px" }}
          />
          {(fullViewImage.caption || fullViewImage.date) && (
            <div style={{ textAlign: "center", padding: "12px" }} onClick={(e) => e.stopPropagation()}>
              {fullViewImage.caption && (
                <div style={{ color: "#fff", fontSize: "var(--bubble-font-size, 15px)", marginBottom: "8px", textShadow: "0 1px 4px rgba(0,0,0,.5)" }}>
                  {fullViewImage.caption}
                </div>
              )}
              {fullViewImage.date && fullViewImage.msgId && fullViewImage.fromGallery && (
                <button
                  onClick={() => {
                    setFullViewImage(null);
                    setShowGallery(false);
                    setTimeout(() => {
                      const el = document.getElementById(`msg-${fullViewImage.msgId}`);
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                    }, 100);
                  }}
                  style={{ background: "rgba(255,255,255,.2)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,.3)", color: "#fff", fontSize: "calc(var(--bubble-font-size) - 2px)", padding: "6px 14px", borderRadius: "20px", cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}
                >
                  {(() => { const d = new Date(fullViewImage.date!); return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`; })()} →
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
