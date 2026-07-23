"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { fetchInit, sendMessage as sendMessageApi, deleteMessage, editMessageApi, adminAction, toggleReaction, sendDm, uploadImage } from "@/lib/api";
import { generateFingerprint } from "@/lib/fingerprint";
import { useRealtime } from "@/hooks/useRealtime";
import { useAuth } from "@/hooks/useAuth";
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
  dm?: boolean;
  deleted?: boolean;
  edited?: boolean;
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

export function ChatView({ channelId }: { channelId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [channel, setChannel] = useState<Channel | null>(null);
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
  const [searchState, setSearchState] = useState<{ query: string; activeId: string | null; resultIds: string[] }>({ query: "", activeId: null, resultIds: [] });
  const [showGallery, setShowGallery] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const { isOwner, userId: authUserId } = useAuth(channel?.owner_uid);
  const [manualAdmin, setManualAdmin] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("isAdmin") === "true";
  });
  const isAdmin = isOwner || manualAdmin;
  const [adminViewAsUser, setAdminViewAsUser] = useState(false);
  const [liveActive, setLiveActive] = useState(false);
  const [inLiveMode, setInLiveMode] = useState(false);
  const [liveTitle, setLiveTitle] = useState("라이브");
  const [showLivePopup, setShowLivePopup] = useState(false);
  const [showLiveEnded, setShowLiveEnded] = useState(false);
  const [showLiveTitlePrompt, setShowLiveTitlePrompt] = useState(false);
  const [showEndLiveConfirm, setShowEndLiveConfirm] = useState(false);
  const [showEmojiPreset, setShowEmojiPreset] = useState(false);
  const [showNoticeEdit, setShowNoticeEdit] = useState(false);
  const [activeNotice, setActiveNotice] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(`activeNotice_${channelId}`) || "";
  });
  const [welcomeConfig, setWelcomeConfig] = useState("");
  const [petitionEnabled, setPetitionEnabled] = useState(true);
  const [dmEnabled, setDmEnabled] = useState(true);
  const [localBubbleColor, setLocalBubbleColor] = useState<string | null>(null);
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

  const { connected, presence, subscribe } = useRealtime(channelId, uid);

  // Load initial data
  useEffect(() => {
    fetchInit(channelId)
      .then((data) => {
        setChannel(data.channel);
        setMessages(data.messages);
        setLoading(false);
        // Load banner notice from server
        if (data.bannerNotice) {
          setActiveNotice(data.bannerNotice);
        }
        // Load welcome config from server
        if (data.welcomeConfig) {
          setWelcomeConfig(data.welcomeConfig);
        }
        // Restore saved bubble color
        if (typeof window !== "undefined") {
          const saved = localStorage.getItem(`bubbleColor_${channelId}`);
          if (saved) setLocalBubbleColor(saved);
        }
      })
      .catch(console.error);
  }, [channelId]);

  const bubbleColor = localBubbleColor || channel?.bubble_color || "#3b8df0";

  // Listen for realtime updates
  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "message-changed") {
        fetchInit(channelId).then((data) => setMessages(data.messages));
      }
      if (event.type === "freeze-change") {
        setChannel((prev) => prev ? { ...prev, is_frozen: event.frozen ? 1 : 0 } : null);
      }
      if (event.type === "emoji-fx") {
        spawnEmoji(event.emoji as string, event.x as number, event.h as number);
      }
      if (event.type === "live-ended") {
        if (inLiveMode && !effectiveAdmin) {
          setLiveActive(false);
          setInLiveMode(false);
          setShowLiveEnded(true);
        }
      }
      if (event.type === "notice-changed") {
        setActiveNotice((event.notice as string) || "");
      }
    });
  }, [subscribe, channelId]);

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

    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    if (dmMode) {
      // Send as DM — not visible to sender, only admin sees it
      setDmMode(false);
      setPendingPhotos([]);
      setBanner({ text: "관리자에게 전송됨", color: "#7b3fa0" });
      setTimeout(() => setBanner(null), 3000);
      sendDm({ uid, text, channel_id: channelId });
      setReplyingTo(null);
      return;
    }

    // Send photos + text
    const photos = [...pendingPhotos];
    setPendingPhotos([]);

    const optimistic: Message = {
      id: crypto.randomUUID(),
      uid,
      nick: null,
      text,
      is_admin: effectiveAdmin ? 1 : 0,
      image: photos.length > 0 ? photos[0].previewUrl : null,
      reactions: "{}",
      reply_to: replyingTo?.id || null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setReplyingTo(null);

    // Dismiss keyboard after send (except in live mode where keyboard stays)
    if (!inLiveMode && textareaRef.current) textareaRef.current.blur();

    await sendMessageApi({
      uid: effectiveAdmin && authUserId ? authUserId : uid,
      text,
      channel_id: channelId,
      image: photos.length > 0 ? await uploadImage(photos[0].blob, channelId) || undefined : undefined,
      reply_to: replyingTo?.id,
      fingerprint: myFingerprint,
    });
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
      setBanner({ text: newAdmin ? "관리자 모드 활성화" : "관리자 모드 해제", color: newAdmin ? "#3b8df0" : "var(--meta)" });
      setTimeout(() => setBanner(null), 2000);
    }
  };

  // Effective admin state (false when viewing as user)
  const effectiveAdmin = isAdmin && !adminViewAsUser;

  const handleDelete = (msgId: string) => {
    // Check if this message has replies (if so, soft delete; otherwise hard delete)
    const hasReplies = messages.some((m) => m.reply_to === msgId);
    if (hasReplies) {
      // Soft delete — keep message but mark as deleted
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, text: "삭제된 채팅입니다", image: null, deleted: true } as Message : m))
      );
    } else {
      // Hard delete — remove completely
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    }
    // Send to backend
    deleteMessage({ uid, message_id: msgId, channel_id: channelId, soft: hasReplies });
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
          messages={messages}
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
            background: "rgba(59, 141, 240, 0.1)",
            borderBottom: "1px solid rgba(59, 141, 240, 0.2)",
            fontSize: "calc(var(--bubble-font-size) - 5px)",
            color: "#3b8df0",
          }}
        >
          <span>사용자 시점으로 보는 중</span>
          <button
            className="border-none rounded-lg cursor-pointer"
            style={{
              background: "#3b8df0",
              color: "#fff",
              padding: "4px 10px",
              fontSize: "calc(var(--bubble-font-size) - 5px)",
              fontWeight: 500,
            }}
            onClick={() => setAdminViewAsUser(false)}
          >
            관리자로 돌아가기
          </button>
        </div>
      )}

      {/* Live banners */}
      {liveActive && !inLiveMode && (
        <LiveJoinBanner title={liveTitle} onJoin={() => { setInLiveMode(true); setMessages([]); }} />
      )}
      {inLiveMode && (
        <LiveExitBanner
          isAdmin={effectiveAdmin}
          title={liveTitle}
          viewerCount={presence}
          onExit={() => {
            if (effectiveAdmin) {
              setShowEndLiveConfirm(true);
            } else {
              setInLiveMode(false);
              setLiveActive(false);
              setShowLiveEnded(true);
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

      {/* Messages */}
      <main
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="messages-scroll flex-1 overflow-y-auto overflow-x-hidden flex flex-col"
        style={{ padding: "12px 14px 8px", WebkitOverflowScrolling: "touch" }}
      >
        {(() => {
          // Separate top-level messages and replies (threaded under parent)
          const topLevel: Message[] = [];
          const repliesMap: Record<string, Message[]> = {};
          const messageIds = new Set(messages.map((m) => m.id));

          messages.forEach((m) => {
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
                  padding: msg.image && !msg.text ? "4px" : "calc(var(--bubble-font-size) * 0.588) calc(var(--bubble-font-size) * 0.824)",
                  fontSize: "var(--bubble-font-size)",
                  lineHeight: 1.38,
                  overflowWrap: "anywhere",
                  borderRadius: !isReply && isLast
                    ? isSent ? "20px 20px 4px 20px" : "20px 20px 20px 4px"
                    : "20px",
                  background: reportedMsgIds.has(msg.id)
                    ? "#ffe0e0"
                    : msg.dm
                      ? (isMine ? "#7b3fa0" : "#ddc8ed")
                      : isMine
                        ? bubbleColor
                        : "var(--gray-bubble)",
                  color: reportedMsgIds.has(msg.id)
                    ? "#a00"
                    : msg.dm
                      ? (isMine ? "#fff" : "#5a1580")
                      : isMine ? "#fff" : "var(--gray-text)",
                  opacity: reportedMsgIds.has(msg.id) ? 0.6 : undefined,
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!msg.deleted) handleBubbleLongPress(msg, isSent, e.currentTarget);
                }}
                onTouchStart={(e) => { if (!msg.deleted) handleTouchStart(msg, isSent, e.currentTarget); }}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchEnd}
              >
                {msg.deleted ? (
                  <span style={{ fontStyle: "italic", opacity: 0.5 }}>삭제된 채팅입니다</span>
                ) : (
                  <>
                    {msg.image && (
                      <img
                        src={msg.image}
                        alt=""
                        className="block w-full max-w-[260px] h-auto rounded-[15px]"
                        style={{ objectFit: "contain" }}
                      />
                    )}
                    {msg.text && <span style={msg.image ? { display: "block", padding: "6px 10px 0" } : undefined}>
                      {searchState.query && searchState.resultIds.includes(msg.id)
                        ? highlightText(msg.text, searchState.query, msg.id === searchState.activeId)
                        : msg.text}
                    </span>}
                    {!!msg.edited && <span style={{ fontSize: "calc(var(--bubble-font-size) - 6px)", opacity: 0.6, fontStyle: "italic", marginLeft: "4px" }}>(수정됨)</span>}
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
                : dmMode ? "rgba(155,89,182,.05)" : "var(--input-bg)",
              border: (channel?.is_frozen && !effectiveAdmin && !dmMode)
                ? "1px solid #ccc"
                : dmMode ? "1px solid #7b3fa0" : "1px solid var(--input-border)",
              borderRadius: "20px",
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={!!(channel?.is_frozen && !effectiveAdmin && !dmMode)}
              rows={1}
              placeholder={
                (channel?.is_frozen && !effectiveAdmin && !dmMode)
                  ? "채팅이 얼려져 있습니다 🧊"
                  : (channel?.is_frozen && effectiveAdmin)
                    ? "얼려짐 🧊"
                    : dmMode
                      ? "관리자에게 보내기"
                      : "메시지를 입력하세요"
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
              <EmojiBar channelId={channelId} onBroadcast={(emoji, x, h) => {
                // TODO: broadcast via WebSocket
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
            sendMessageApi({ uid, text: `🚨 신고된 채팅: "${preview}"`, channel_id: channelId });
            setBanner({ text: "신고가 접수되었습니다", color: "#d32f2f" });
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
            setBanner({ text: "신고가 취소되었습니다", color: "var(--meta)" });
            setTimeout(() => setBanner(null), 3000);
          } : undefined}
          isReported={reportedMsgIds.has(contextMenu.msg.id)}
          onDelete={contextMenu.isOwn ? handleDelete : undefined}
          onDeleteWithReplies={effectiveAdmin && !contextMenu.isOwn ? (msgId) => {
            // Delete message + all its replies
            const idsToDelete = new Set([msgId]);
            messages.forEach((m) => { if (m.reply_to === msgId) idsToDelete.add(m.id); });
            setMessages((prev) => prev.filter((m) => !idsToDelete.has(m.id)));
            setBanner({ text: "메시지가 삭제되었습니다", color: "#d32f2f" });
            setTimeout(() => setBanner(null), 3000);
          } : undefined}
          onEdit={contextMenu.isOwn ? (msgId) => {
            const msg = messages.find((m) => m.id === msgId);
            if (msg) setEditingMsg({ id: msg.id, text: msg.text });
          } : undefined}
          onBlock={effectiveAdmin && !contextMenu.isOwn ? (blockUid) => {
            setBanner({ text: `익명#${blockUid.slice(-4)} 차단됨`, color: "#d32f2f" });
            setTimeout(() => setBanner(null), 3000);
            // TODO: send to backend
          } : undefined}
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
          onGallery={() => setShowGallery(true)}
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
          items={[]}
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
          blockedUsers={[]}
          onFreeze={() => {
            setChannel((prev) => prev ? { ...prev, is_frozen: 1 } : null);
            adminAction("freeze", channelId, { frozen: true });
            setBanner({ text: "채팅이 얼려졌습니다 🧊", color: "#4a4d8f" });
            setTimeout(() => setBanner(null), 3000);
          }}
          onUnfreeze={() => {
            setChannel((prev) => prev ? { ...prev, is_frozen: 0 } : null);
            adminAction("freeze", channelId, { frozen: false });
            setBanner({ text: "채팅이 해제되었습니다", color: "#3b8df0" });
            setTimeout(() => setBanner(null), 3000);
          }}
          onToggleView={() => setAdminViewAsUser(true)}
          onLive={() => {
            if (liveActive) {
              // End live
              setLiveActive(false);
              setInLiveMode(false);
              fetchInit(channelId).then((data) => { setMessages(data.messages); });
              setBanner({ text: "라이브가 종료되었습니다", color: "#c0392b" });
              setTimeout(() => setBanner(null), 3000);
            } else {
              // Show title prompt
              setShowLiveTitlePrompt(true);
            }
          }}
          onPetitionToggle={() => {
            setPetitionEnabled(!petitionEnabled);
            setBanner({ text: !petitionEnabled ? "이의 제기가 허용됩니다" : "이의 제기가 차단됩니다", color: !petitionEnabled ? "#2a9d4e" : "#c0392b" });
            setTimeout(() => setBanner(null), 3000);
          }}
          onDmToggle={() => {
            setDmEnabled(!dmEnabled);
            setBanner({ text: !dmEnabled ? "비밀 메시지가 허용됩니다" : "비밀 메시지가 차단됩니다", color: !dmEnabled ? "#2a9d4e" : "#c0392b" });
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
            setBanner({ text: "채널 이름이 변경되었습니다", color: "#3b8df0" });
            setTimeout(() => setBanner(null), 3000);
          }}
          onProfileImageChange={(url) => {
            setChannel((prev) => prev ? { ...prev, profile_image: url } : null);
            adminAction("update-profile", channelId, { profile_image: url });
            setBanner({ text: "프로필 사진이 변경되었습니다", color: "#3b8df0" });
            setTimeout(() => setBanner(null), 3000);
          }}
          onNoticeChange={(noticeStr) => {
            setChannel((prev) => prev ? { ...prev, notice: noticeStr } : null);
            adminAction("set-rules", channelId, { rules: noticeStr });
            setBanner({ text: "채널 규칙이 저장되었습니다", color: "#3b8df0" });
            setTimeout(() => setBanner(null), 3000);
          }}
          onWelcomeChange={(config) => {
            setWelcomeConfig(config);
            localStorage.setItem(`welcomeConfig_${channelId}`, config);
            adminAction("set-welcome", channelId, { config });
            setBanner({ text: "환영 팝업이 저장되었습니다", color: "#3b8df0" });
            setTimeout(() => setBanner(null), 3000);
          }}
          onUnblock={(uid) => {
            setBanner({ text: "차단이 해제되었습니다", color: "#2a9d4e" });
            setTimeout(() => setBanner(null), 3000);
            // TODO: call backend to unblock
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
          onStart={(title) => {
            setShowLiveTitlePrompt(false);
            setLiveTitle(title);
            setLiveActive(true);
            setInLiveMode(true);
            setMessages([]);
            setBanner({ text: "라이브가 시작되었습니다", color: "#c0392b" });
            setTimeout(() => setBanner(null), 3000);
          }}
          onCancel={() => setShowLiveTitlePrompt(false)}
        />
      )}

      {/* End Live Confirm */}
      {showEndLiveConfirm && (
        <ConfirmDialog
          title="라이브 종료"
          message="라이브를 종료하시겠습니까?<br>모든 메시지가 삭제됩니다."
          confirmLabel="종료"
          confirmColor="#c0392b"
          onConfirm={() => {
            setShowEndLiveConfirm(false);
            setLiveActive(false);
            setInLiveMode(false);
            fetchInit(channelId).then((data) => { setMessages(data.messages); });
            setBanner({ text: "라이브가 종료되었습니다", color: "#c0392b" });
            setTimeout(() => setBanner(null), 3000);
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
              setBanner({ text: "공지가 삭제되었습니다", color: "var(--meta)" });
            } else {
              const notice = body ? JSON.stringify({ title, body }) : title;
              setActiveNotice(notice);
              localStorage.setItem(`activeNotice_${channelId}`, notice);
              localStorage.removeItem(`noticeDismissed_${channelId}`);
              adminAction("set-notice", channelId, { text: notice });
              setBanner({ text: "공지가 등록되었습니다", color: "#3b8df0" });
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
    </div>
  );
}
