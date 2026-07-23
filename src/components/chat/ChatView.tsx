"use client";

import { useEffect, useState, useRef } from "react";
import { fetchInit, sendMessage as sendMessageApi } from "@/lib/api";
import { useRealtime } from "@/hooks/useRealtime";

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
}

interface Channel {
  id: string;
  name: string;
  profile_image: string | null;
  bubble_color: string;
  is_frozen: number;
}

function getOrCreateUid(): string {
  const key = "letsplay_uid";
  let uid = localStorage.getItem(key);
  if (!uid) {
    uid = crypto.randomUUID();
    localStorage.setItem(key, uid);
  }
  return uid;
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr + "Z");
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isSameGroup(a: Message, b: Message) {
  return a.uid === b.uid;
}

// Skeleton loading component
function SkeletonLoading() {
  const rows = [
    { side: "recv", width: "25%" },
    { side: "recv", width: "45%" },
    { side: "sent", width: "35%" },
    { side: "recv", width: "40%" },
    { side: "sent", width: "25%" },
    { side: "sent", width: "55%" },
    { side: "recv", width: "30%" },
    { side: "sent", width: "40%" },
    { side: "recv", width: "55%" },
    { side: "sent", width: "25%" },
  ];

  return (
    <div className="flex flex-col gap-[3px] p-3 animate-pulse">
      {rows.map((row, i) => (
        <div key={i} className={`flex ${row.side === "sent" ? "justify-end" : "justify-start"}`}>
          <div
            className="rounded-[18px] h-[44px]"
            style={{
              width: row.width,
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { connected, presence, subscribe } = useRealtime(channelId, uid);

  // Load initial data
  useEffect(() => {
    fetchInit(channelId)
      .then((data) => {
        setChannel(data.channel);
        setMessages(data.messages);
        setLoading(false);
      })
      .catch(console.error);
  }, [channelId]);

  // Listen for realtime updates
  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "message-changed") {
        fetchInit(channelId).then((data) => {
          setMessages(data.messages);
        });
      }
      if (event.type === "freeze-change") {
        setChannel((prev) =>
          prev ? { ...prev, is_frozen: event.frozen ? 1 : 0 } : null
        );
      }
    });
  }, [subscribe, channelId]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 80) + "px";
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || channel?.is_frozen) return;

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // Optimistic update
    const optimistic: Message = {
      id: crypto.randomUUID(),
      uid,
      nick: null,
      text,
      is_admin: 0,
      image: null,
      reactions: "{}",
      reply_to: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    await sendMessageApi({ uid, text, channel_id: channelId });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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
            <div
              className="w-[41px] h-[41px] rounded-full"
              style={{ background: "var(--gray-bubble)" }}
            />
            <div
              className="h-3 w-16 rounded"
              style={{ background: "var(--gray-bubble)" }}
            />
          </div>
        </header>
        <div className="flex-1 overflow-hidden">
          <SkeletonLoading />
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col" style={{ background: "var(--bg)", color: "var(--gray-text)" }}>
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
        {/* Notice button */}
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 p-0 border-none bg-transparent cursor-pointer flex items-center"
          style={{ color: channel?.bubble_color || "var(--bubble-sent)" }}
        >
          <svg viewBox="0 0 24 24" width="23" height="23">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M12 16v-4M12 8h.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        {/* Center - avatar + name */}
        <div className="flex-1 flex flex-col items-center gap-[6px]">
          <div className="w-[41px] h-[41px] rounded-full overflow-hidden relative top-[3px]">
            {channel?.profile_image ? (
              <img
                src={channel.profile_image}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center text-lg"
                style={{ background: "var(--gray-bubble)" }}
              >
                💬
              </div>
            )}
          </div>
          <div className="text-xs font-normal flex items-center gap-[2px]" style={{ color: "var(--gray-text)" }}>
            {channel?.name}
            {connected && (
              <span className="ml-1 text-[10px]" style={{ color: "var(--meta)" }}>
                {presence}
              </span>
            )}
          </div>
        </div>

        {/* Search button */}
        <button
          className="absolute right-[52px] top-1/2 -translate-y-1/2 p-0 border-none bg-transparent cursor-pointer flex items-center"
          style={{ color: channel?.bubble_color || "var(--bubble-sent)" }}
        >
          <svg viewBox="0 0 24 24" width="20" height="20">
            <circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M21 21l-4.35-4.35" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        {/* Menu button */}
        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 p-0 border-none bg-transparent cursor-pointer flex items-center"
          style={{ color: channel?.bubble_color || "var(--bubble-sent)" }}
        >
          <svg viewBox="0 0 24 24" width="22" height="22">
            <circle cx="12" cy="5" r="1.8" fill="currentColor" />
            <circle cx="12" cy="12" r="1.8" fill="currentColor" />
            <circle cx="12" cy="19" r="1.8" fill="currentColor" />
          </svg>
        </button>
      </header>

      {/* Messages */}
      <main
        className="messages-scroll flex-1 overflow-y-auto overflow-x-hidden flex flex-col"
        style={{ padding: "12px 14px 8px", WebkitOverflowScrolling: "touch" }}
      >
        {messages.map((msg, i) => {
          const isSent = msg.uid === uid;
          const prev = messages[i - 1];
          const isGroupStart = !prev || !isSameGroup(prev, msg);
          const isLast = !messages[i + 1] || !isSameGroup(msg, messages[i + 1]);

          return (
            <div
              key={msg.id}
              className={`flex items-end gap-[6px] max-w-full ${isSent ? "justify-end" : "justify-start"}`}
              style={{ paddingTop: isGroupStart ? "7px" : "3px" }}
            >
              <div className={`flex flex-col max-w-[74%] ${isSent ? "items-end" : "items-start"}`}>
                {/* Sender name for received messages at group start */}
                {!isSent && isGroupStart && msg.nick && (
                  <div className="text-[10px] mb-[2px] ml-3" style={{ color: "var(--meta)" }}>
                    {msg.nick}
                  </div>
                )}

                {/* Bubble */}
                <div
                  className="relative px-[14px] py-[10px] max-w-full break-words whitespace-pre-wrap"
                  style={{
                    fontSize: "var(--bubble-font-size)",
                    lineHeight: 1.38,
                    overflowWrap: "anywhere",
                    borderRadius: isLast
                      ? isSent
                        ? "20px 20px 4px 20px"
                        : "20px 20px 20px 4px"
                      : "20px",
                    background: isSent
                      ? channel?.bubble_color || "var(--bubble-sent)"
                      : "var(--gray-bubble)",
                    color: isSent ? "#fff" : "var(--gray-text)",
                  }}
                >
                  {msg.text}
                </div>

                {/* Timestamp on last message in group */}
                {isLast && (
                  <div
                    className="text-[10px] mt-[2px] px-1"
                    style={{ color: "var(--meta)" }}
                  >
                    {formatTime(msg.created_at)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </main>

      {/* Frozen banner */}
      {channel?.is_frozen ? (
        <div
          className="flex-none text-center text-sm py-3"
          style={{
            background: "var(--composer-bg)",
            color: "var(--meta)",
            borderTop: "0.5px solid var(--hairline)",
          }}
        >
          채팅이 일시 중지되었습니다
        </div>
      ) : (
        /* Composer */
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
          {/* Plus/photo button */}
          <button
            className="flex-none w-8 h-8 border-none bg-transparent p-0 flex items-center justify-center cursor-pointer self-center"
            style={{ color: "var(--meta)" }}
          >
            <svg viewBox="0 0 24 24" width="28" height="28">
              <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M12 7v10M7 12h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>

          {/* Input wrap */}
          <div
            className="flex-1 flex items-center relative min-h-[36px] px-[14px] pr-[6px]"
            style={{
              background: "var(--input-bg)",
              border: "1px solid var(--input-border)",
              borderRadius: "20px",
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="메시지를 입력하세요"
              className="flex-1 border-none bg-transparent outline-none resize-none"
              style={{
                fontSize: "var(--bubble-font-size)",
                color: "var(--gray-text)",
                padding: "8px 0",
                caretColor: "var(--tint)",
                fontFamily: "inherit",
                lineHeight: 1.4,
                maxHeight: "80px",
                overflowY: "auto",
              }}
            />
            {input.trim() && (
              <button
                onClick={handleSend}
                className="flex-none flex items-center justify-center border-none cursor-pointer"
                style={{
                  width: "26px",
                  height: "26px",
                  borderRadius: "50%",
                  background: channel?.bubble_color || "var(--bubble-sent)",
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <path
                    d="M12 20V5m0 0l-6 6m6-6l6 6"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
