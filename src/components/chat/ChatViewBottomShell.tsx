"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ChangeEventHandler, KeyboardEventHandler, RefObject } from "react";
import { EmojiBar } from "./EmojiBar";
import { ReplyBar } from "./ReplyBar";
import { ScrollToBottom } from "./ScrollToBottom";
import type { PendingPhoto } from "./useChatComposerState";
import type { Message } from "./chatTypes";
import { CloseIcon } from "@/components/ui/CloseIcon";

interface BannerState {
  text: string;
  color: string;
}

function ActionToast({ banner }: { banner: BannerState }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState<number | null>(null);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const text = textRef.current;
        if (!text) return;
        const baseFontSize = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bubble-font-size")) || 16;
        text.style.fontSize = `${baseFontSize}px`;
        const availableWidth = Math.max(1, window.innerWidth - 64);
        const fittedSize = Math.min(baseFontSize, baseFontSize * (availableWidth / Math.max(1, text.scrollWidth)));
        text.style.fontSize = "";
        setFontSize(fittedSize);
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [banner.text]);

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[550] w-max whitespace-nowrap text-white font-normal px-4 py-[10px] rounded-[12px] text-center"
      role="status"
      aria-live="polite"
      style={{
        bottom: "80px",
        maxWidth: "calc(100% - 32px)",
        background: banner.color.startsWith("var(") ? banner.color : `${banner.color}dd`,
        backdropFilter: "saturate(180%) blur(12px)",
        WebkitBackdropFilter: "saturate(180%) blur(12px)",
        boxShadow: "0 6px 20px rgba(0,0,0,.25)",
      }}
    >
      <span ref={textRef} style={{ fontSize: fontSize === null ? "var(--bubble-font-size)" : `${fontSize}px` }}>
        {banner.text}
      </span>
    </div>
  );
}

interface ChatViewBottomShellProps {
  channelId: string;
  historyMode: "latest" | "context";
  showScrollBtn: boolean;
  newerMessageCount: number;
  latestMessagesLabel?: string;
  onScrollToBottom: () => void;
  banner: BannerState | null;
  replyingTo: Message | null;
  onCloseReply: () => void;
  pendingPhotos: PendingPhoto[];
  onRemovePendingPhoto: (index: number) => void;
  ownerModerationBlocked: boolean;
  ownerModerationBannerText: string;
  ownerCanSubmitPetition: boolean;
  submitModerationPetitionLabel: string;
  onOpenModerationPetition: () => void;
  viewerModerationBlocked: boolean;
  moderationFrozenBannerLabel: string;
  photoInputRef: RefObject<HTMLInputElement | null>;
  onPhotoSelect: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onOpenPlusMenu: (rect: DOMRect) => void;
  isUserBlocked: boolean;
  hasPetitioned: boolean;
  petitionEnabled: boolean;
  isFrozen: boolean;
  effectiveAdmin: boolean;
  dmMode: boolean;
  input: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onInputChange: ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  ownerSuspendedInputLabel: string;
  moderationFrozenInputLabel: string;
  frozenInputLabel: string;
  blockedInputLabel: string;
  petitionInputLabel: string;
  sentToAdminLabel: string;
  messageInputLabel: string;
  inLiveMode: boolean;
  emojiPresets: string[] | null;
  onBroadcastEmoji: (emoji: string, x: number, h: number) => void;
  onSend: () => Promise<void>;
  isSending: boolean;
  bubbleColor: string;
}

export function ChatViewBottomShell({
  channelId,
  historyMode,
  showScrollBtn,
  newerMessageCount,
  latestMessagesLabel,
  onScrollToBottom,
  banner,
  replyingTo,
  onCloseReply,
  pendingPhotos,
  onRemovePendingPhoto,
  ownerModerationBlocked,
  ownerModerationBannerText,
  ownerCanSubmitPetition,
  submitModerationPetitionLabel,
  onOpenModerationPetition,
  viewerModerationBlocked,
  moderationFrozenBannerLabel,
  photoInputRef,
  onPhotoSelect,
  onOpenPlusMenu,
  isUserBlocked,
  hasPetitioned,
  petitionEnabled,
  isFrozen,
  effectiveAdmin,
  dmMode,
  input,
  textareaRef,
  onInputChange,
  onKeyDown,
  ownerSuspendedInputLabel,
  moderationFrozenInputLabel,
  frozenInputLabel,
  blockedInputLabel,
  petitionInputLabel,
  sentToAdminLabel,
  messageInputLabel,
  inLiveMode,
  emojiPresets,
  onBroadcastEmoji,
  onSend,
  isSending,
  bubbleColor,
}: ChatViewBottomShellProps) {
  const viewerInputBlocked = isUserBlocked && (hasPetitioned || !petitionEnabled);
  const composerFrozenForViewer = isFrozen && !effectiveAdmin && !dmMode;
  const plusDisabled = viewerInputBlocked || ownerModerationBlocked;
  const inputDisabled = ownerModerationBlocked || composerFrozenForViewer || viewerInputBlocked;
  const composerBackground = ownerModerationBlocked
    ? "rgba(139,92,246,.06)"
    : composerFrozenForViewer
    ? "rgba(0,0,0,.03)"
    : isUserBlocked
    ? "rgba(255,59,48,.05)"
    : dmMode
    ? "rgba(155,89,182,.05)"
    : "var(--input-bg)";
  const composerBorder = ownerModerationBlocked
    ? "1px solid rgba(139,92,246,.28)"
    : composerFrozenForViewer
    ? "1px solid #ccc"
    : isUserBlocked
    ? "1px solid #d32f2f"
    : dmMode
    ? "1px solid #7b3fa0"
    : "1px solid var(--input-border)";
  const inputPlaceholder = ownerModerationBlocked
    ? ownerSuspendedInputLabel
    : viewerModerationBlocked
    ? moderationFrozenInputLabel
    : composerFrozenForViewer
    ? frozenInputLabel
    : isUserBlocked
    ? (viewerInputBlocked ? blockedInputLabel : petitionInputLabel)
    : isFrozen && effectiveAdmin
    ? frozenInputLabel
    : dmMode
    ? sentToAdminLabel
    : messageInputLabel;
  const inputColor = ownerModerationBlocked || composerFrozenForViewer ? "#999" : "var(--gray-text)";
  const canSend = !!(input.trim() || pendingPhotos.length > 0) && !ownerModerationBlocked && !composerFrozenForViewer;

  return (
    <>
      <ScrollToBottom
        visible={historyMode === "context" || showScrollBtn}
        unreadCount={historyMode === "context" ? newerMessageCount : undefined}
        label={historyMode === "context" ? latestMessagesLabel : undefined}
        onClick={onScrollToBottom}
      />

      {banner && <ActionToast key={banner.text} banner={banner} />}

      <ReplyBar replyingTo={replyingTo} onClose={onCloseReply} />

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
            {pendingPhotos.map((photo, index) => (
              <div key={index} className="relative flex-shrink-0">
                <img
                  src={photo.previewUrl}
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
                    lineHeight: 1,
                  }}
                  onClick={() => onRemovePendingPhoto(index)}
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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
              onClick={onOpenModerationPetition}
            >
              {submitModerationPetitionLabel}
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
            {moderationFrozenBannerLabel}
          </div>
        </div>
      )}

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
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => { void onPhotoSelect(event); }}
        />

        <button
          className="flex-none border-none bg-transparent p-0 flex items-center justify-center cursor-pointer self-center"
          style={{
            color: "var(--meta)",
            width: "32px",
            height: "32px",
            opacity: plusDisabled ? 0.3 : 1,
            pointerEvents: plusDisabled ? "none" : "auto",
          }}
          onClick={(event) => onOpenPlusMenu(event.currentTarget.getBoundingClientRect())}
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
            background: composerBackground,
            border: composerBorder,
            borderRadius: "20px",
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            onBlur={() => {
              requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
            }}
            disabled={inputDisabled || isSending}
            rows={1}
            placeholder={inputPlaceholder}
            className="flex-1 border-none bg-transparent outline-none resize-none"
            style={{
              fontSize: "var(--bubble-font-size)",
              color: inputColor,
              padding: "8px 0",
              caretColor: "var(--tint)",
              fontFamily: "inherit",
              lineHeight: 1.4,
              maxHeight: "80px",
              overflowY: "auto",
            }}
          />
          {inLiveMode && !isUserBlocked && !ownerModerationBlocked && (
            <EmojiBar channelId={channelId} presets={emojiPresets} onBroadcast={onBroadcastEmoji} />
          )}
          {(canSend || isSending) && (
            <button
              type="button"
              disabled={isSending}
              onClick={() => { void onSend(); }}
              className="flex-none flex items-center justify-center border-none cursor-pointer"
              style={{
                width: "calc(var(--bubble-font-size) + 9px)",
                height: "calc(var(--bubble-font-size) + 9px)",
                borderRadius: "50%",
                background: dmMode ? "#7b3fa0" : bubbleColor,
                opacity: isSending ? 0.55 : 1,
                cursor: isSending ? "default" : "pointer",
              }}
            >
              <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) - 1px)", height: "calc(var(--bubble-font-size) - 1px)" }}>
                <path d="M12 20V5m0 0l-6 6m6-6l6 6" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </footer>
    </>
  );
}
