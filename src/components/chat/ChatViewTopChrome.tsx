"use client";

import { useLocale } from "@/hooks/useLocale";
import { EditDialog } from "./EditDialog";
import { LiveCountdownBanner, LiveExitBanner, LiveJoinBanner } from "./LiveMode";
import { SearchBar } from "./SearchBar";

interface SearchMessage {
  id: string;
  text: string;
}

interface ChatViewTopChromeProps {
  channelId: string;
  channelName: string;
  channelProfileImage: string | null;
  ownerChannelCount: number;
  bubbleColor: string;
  hasChannelRules: boolean;
  showSearch: boolean;
  searchMessages: SearchMessage[];
  onSearchNavigate: (msgId: string, options?: { anchorMessageId?: string | null }) => void;
  onSearchState: (state: { query: string; activeId: string | null; resultIds: string[] }) => void;
  onCloseSearch: () => void;
  onDashboard: () => void;
  onOpenNotice: () => void;
  onOpenOwnerChannels: () => void;
  onShareChannel: () => void;
  onToggleSearch: () => void;
  onOpenHeaderMenu: (rect: DOMRect) => void;
  onScrollToTop: () => void;
  editingText: string | null;
  onSaveEdit: (newText: string) => void;
  onCloseEdit: () => void;
  isAdmin: boolean;
  adminViewAsUser: boolean;
  onReturnToAdmin: () => void;
  liveActive: boolean;
  inLiveMode: boolean;
  liveTitle: string;
  liveCount: number;
  liveLastMinuteLabel: string | null;
  liveLastMinuteBannerText: string | null;
  liveCountdownNotice: string | null;
  effectiveAdmin: boolean;
  showReconnectNotice: boolean;
  onJoinLive: () => void;
  onExitLive: () => void;
}

export function ChatViewTopChrome({
  channelId,
  channelName,
  channelProfileImage,
  ownerChannelCount,
  bubbleColor,
  hasChannelRules,
  showSearch,
  searchMessages,
  onSearchNavigate,
  onSearchState,
  onCloseSearch,
  onDashboard,
  onOpenNotice,
  onOpenOwnerChannels,
  onShareChannel,
  onToggleSearch,
  onOpenHeaderMenu,
  onScrollToTop,
  editingText,
  onSaveEdit,
  onCloseEdit,
  isAdmin,
  adminViewAsUser,
  onReturnToAdmin,
  liveActive,
  inLiveMode,
  liveTitle,
  liveCount,
  liveLastMinuteLabel,
  liveLastMinuteBannerText,
  liveCountdownNotice,
  effectiveAdmin,
  showReconnectNotice,
  onJoinLive,
  onExitLive,
}: ChatViewTopChromeProps) {
  const { t } = useLocale();

  return (
    <>
      <header
        className="flex-none flex items-center px-4 relative"
        style={{
          background: "var(--header-bg)",
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          borderBottom: "0.5px solid var(--hairline)",
          padding: "10px 16px",
          zIndex: 5,
          cursor: "pointer",
        }}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button, a")) return;
          onScrollToTop();
        }}
      >
        <button
          type="button"
          className="absolute left-[7px] top-0 bottom-0 w-9 p-0 border-none bg-transparent cursor-pointer flex items-center justify-center"
          style={{ color: bubbleColor }}
          onClick={onDashboard}
          aria-label={t("dashboardChats")}
        >
          <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 3px)", height: "calc(var(--bubble-font-size) + 3px)" }}>
            <path d="m15 18-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {hasChannelRules && (
          <button
            type="button"
            className="absolute left-[41px] top-0 bottom-0 w-9 p-0 border-none bg-transparent cursor-pointer flex items-center justify-center"
            style={{ color: bubbleColor }}
            onClick={onOpenNotice}
            aria-label={t("rules")}
          >
            <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 3px)", height: "calc(var(--bubble-font-size) + 3px)" }}>
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="12" cy="8" r="1.15" fill="currentColor" />
              <path d="M12 11v6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}

        <div className="flex-1 flex flex-col items-center gap-[6px]">
          <button
            type="button"
            disabled={ownerChannelCount < 2}
            className="rounded-full overflow-hidden relative top-[3px] border-none p-0"
            aria-label={t("dashboardOwnerChannels")}
            style={{ width: "calc(var(--bubble-font-size) + 24px)", height: "calc(var(--bubble-font-size) + 24px)", cursor: ownerChannelCount >= 2 ? "pointer" : "default" }}
            onClick={onOpenOwnerChannels}
          >
            {channelProfileImage ? (
              <img src={channelProfileImage} alt="" className="w-full h-full object-cover" />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center text-white text-lg font-semibold"
                style={{ background: bubbleColor }}
              >
                {channelName.slice(0, 1).toUpperCase() || "?"}
              </div>
            )}
          </button>
          <div className="font-normal flex items-center gap-[2px]" style={{ fontSize: "calc(var(--bubble-font-size) - 5px)", color: "var(--gray-text)" }}>
            {channelName}
          </div>
        </div>

        <button
          type="button"
          className="absolute right-[79px] top-0 bottom-0 w-9 p-0 border-none bg-transparent cursor-pointer flex items-center justify-center"
          style={{ color: bubbleColor }}
          onClick={onShareChannel}
          aria-label={t("shareChannel")}
        >
          <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 3px)", height: "calc(var(--bubble-font-size) + 3px)" }}>
            <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6 11.5v7A2.5 2.5 0 0 0 8.5 21h7a2.5 2.5 0 0 0 2.5-2.5v-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <button
          type="button"
          className="absolute right-[43px] top-0 bottom-0 w-9 p-0 border-none bg-transparent cursor-pointer flex items-center justify-center"
          style={{ color: bubbleColor }}
          onClick={onToggleSearch}
        >
          <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 3px)", height: "calc(var(--bubble-font-size) + 3px)" }}>
            <circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M21 21l-4.35-4.35" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <button
          type="button"
          className="absolute right-[7px] top-0 bottom-0 w-9 p-0 border-none bg-transparent cursor-pointer flex items-center justify-center"
          style={{ color: bubbleColor }}
          onClick={(event) => onOpenHeaderMenu(event.currentTarget.getBoundingClientRect())}
        >
          <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 3px)", height: "calc(var(--bubble-font-size) + 3px)" }}>
            <circle cx="12" cy="5" r="1.8" fill="currentColor" />
            <circle cx="12" cy="12" r="1.8" fill="currentColor" />
            <circle cx="12" cy="19" r="1.8" fill="currentColor" />
          </svg>
        </button>
      </header>

      {showSearch && (
        <SearchBar
          channelId={channelId}
          messages={searchMessages}
          onNavigate={onSearchNavigate}
          onSearchState={onSearchState}
          onClose={onCloseSearch}
        />
      )}

      {editingText && (
        <EditDialog
          currentText={editingText}
          onSave={onSaveEdit}
          onClose={onCloseEdit}
        />
      )}

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
            type="button"
            className="border-none rounded-lg cursor-pointer"
            style={{
              background: bubbleColor,
              color: "#fff",
              padding: "4px 10px",
              fontSize: "calc(var(--bubble-font-size) - 5px)",
              fontWeight: 500,
            }}
            onClick={onReturnToAdmin}
          >
            {t("returnToAdmin")}
          </button>
        </div>
      )}

      {liveActive && !inLiveMode && (
        <LiveJoinBanner title={liveTitle} onJoin={onJoinLive} />
      )}

      {inLiveMode && (
        <LiveExitBanner
          isAdmin={effectiveAdmin}
          title={liveTitle}
          viewerCount={liveCount}
          countdownLabel={liveLastMinuteLabel}
          onExit={onExitLive}
        />
      )}

      {liveLastMinuteBannerText ? (
        <LiveCountdownBanner text={liveLastMinuteBannerText} />
      ) : liveCountdownNotice ? (
        <LiveCountdownBanner text={liveCountdownNotice} />
      ) : null}

      {showReconnectNotice && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "6px 12px", background: "#fff3e0", borderBottom: "0.5px solid #ffe0b2", flexShrink: 0, fontSize: "calc(var(--bubble-font-size) - 4px)", color: "#e65100", lineHeight: 1 }}>
          <span>{t("connectionLost")}</span>
        </div>
      )}
    </>
  );
}
