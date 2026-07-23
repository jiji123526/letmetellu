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

export function ChatView({ channelId }: { channelId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [uid] = useState(getOrCreateUid);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { connected, presence, subscribe } = useRealtime(channelId, uid);

  // Load initial data
  useEffect(() => {
    fetchInit(channelId).then((data) => {
      setChannel(data.channel);
      setMessages(data.messages);
      setLoading(false);
    }).catch(console.error);
  }, [channelId]);

  // Listen for realtime updates
  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "message-changed") {
        // Re-fetch messages
        fetchInit(channelId).then((data) => {
          setMessages(data.messages);
        });
      }
      if (event.type === "freeze-change") {
        setChannel((prev) => prev ? { ...prev, is_frozen: event.frozen ? 1 : 0 } : null);
      }
    });
  }, [subscribe, channelId]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || channel?.is_frozen) return;

    setInput("");

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

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <header className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
        {channel?.profile_image && (
          <img src={channel.profile_image} alt="" className="w-9 h-9 rounded-full object-cover" />
        )}
        <div>
          <h1 className="font-semibold text-lg">{channel?.name}</h1>
          <span className="text-xs text-gray-500">
            {connected ? `${presence} online` : "connecting..."}
          </span>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.uid === uid ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                msg.uid === uid
                  ? "text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              }`}
              style={msg.uid === uid ? { backgroundColor: channel?.bubble_color || "#3b8df0" } : undefined}
            >
              {msg.nick && msg.uid !== uid && (
                <div className="text-xs font-medium opacity-70 mb-1">{msg.nick}</div>
              )}
              <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>
              <time className="text-[10px] opacity-50 mt-1 block">
                {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </time>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Frozen banner */}
      {channel?.is_frozen ? (
        <div className="p-3 text-center text-sm text-gray-500 bg-gray-50 dark:bg-gray-900 border-t">
          채팅이 일시 중지되었습니다
        </div>
      ) : (
        /* Composer */
        <form
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="flex items-center gap-2 p-3 border-t border-gray-200 dark:border-gray-700"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="메시지를 입력하세요..."
            className="flex-1 rounded-full px-4 py-2 bg-gray-100 dark:bg-gray-800 outline-none text-sm"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-full w-9 h-9 flex items-center justify-center bg-blue-500 text-white disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M3.105 3.29a.75.75 0 01.814-.18l13.5 5.25a.75.75 0 010 1.38l-13.5 5.25a.75.75 0 01-1.029-.84l1.2-5.4a.75.75 0 01.6-.575L9 8.75l-4.31-.425a.75.75 0 01-.6-.575l-1.2-5.4a.75.75 0 01.215-.66z" />
            </svg>
          </button>
        </form>
      )}
    </>
  );
}
