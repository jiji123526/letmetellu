"use client";

import { chatDateLabel } from "@/lib/chat-date";
import dynamic from "next/dynamic";
import { LiveEndedPopup, LivePopup, LiveTitlePrompt } from "./LiveMode";
import { WelcomePopup } from "./WelcomePopup";

const AdminPanel = dynamic(() => import("../admin/AdminPanel").then((module) => module.AdminPanel));
const ChannelReportDialog = dynamic(() => import("./ChannelReportDialog").then((module) => module.ChannelReportDialog));
const ConfirmDialog = dynamic(() => import("./ConfirmDialog").then((module) => module.ConfirmDialog));
const EmojiPicker = dynamic(() => import("./EmojiPicker").then((module) => module.EmojiPicker));
const EmojiPresetPanel = dynamic(() => import("./EmojiBar").then((module) => module.EmojiPresetPanel));
const GalleryPanel = dynamic(() => import("./GalleryPanel").then((module) => module.GalleryPanel));
const HeaderMenu = dynamic(() => import("./HeaderMenu").then((module) => module.HeaderMenu));
const LinksPanel = dynamic(() => import("./LinksPanel").then((module) => module.LinksPanel));
const ModerationPetitionDialog = dynamic(
  () => import("./ModerationPetitionDialog").then((module) => module.ModerationPetitionDialog),
);
const NoticeEditDialog = dynamic(() => import("./NoticeEditDialog").then((module) => module.NoticeEditDialog));
const NoticePanel = dynamic(() => import("./NoticePanel").then((module) => module.NoticePanel));
const OwnerChannelsPopup = dynamic(
  () => import("./OwnerChannelsPopup").then((module) => module.OwnerChannelsPopup),
);
const PlusMenu = dynamic(() => import("./PlusMenu").then((module) => module.PlusMenu));
const SettingsPanel = dynamic(() => import("./SettingsPanel").then((module) => module.SettingsPanel));

interface GalleryItem {
  id: string;
  image: string;
  created_at: string;
}

interface BlockedUser {
  uid: string;
  reason: string;
}

interface FullViewImageState {
  src: string;
  caption?: string;
  date?: string;
  msgId?: string;
  fromGallery?: boolean;
}

interface EmojiPickerState {
  msgId: string;
  rect: DOMRect;
}

interface ChatViewOverlaysProps {
  channelId: string;
  channelName: string;
  channelOwnerUid: string | null;
  channelProfileImage: string | null;
  channelNotice: string;
  bubbleColor: string;
  welcomeConfig: string;
  activeNotice: string;
  locale: "ko" | "en";
  timeZone: string;
  effectiveAdmin: boolean;
  showModerationPetitionDialog: boolean;
  submittingModerationPetition: boolean;
  headerMenu: DOMRect | null;
  showChannelReportDialog: boolean;
  submittingChannelReport: boolean;
  showOwnerChannels: boolean;
  showSettings: boolean;
  showGallery: boolean;
  galleryItems: GalleryItem[];
  galleryHasMore: boolean;
  showLinks: boolean;
  linksChannelId: string;
  showAdminPanel: boolean;
  petitionEnabled: boolean;
  dmEnabled: boolean;
  blockedUsers: BlockedUser[];
  emojiPicker: EmojiPickerState | null;
  plusMenu: DOMRect | null;
  dmMode: boolean;
  isFrozen: boolean;
  liveActive: boolean;
  inLiveMode: boolean;
  reportsOwnerFilter: "open" | "warned" | "frozen" | null;
  isReportsOwnerView: boolean;
  showLiveTitlePrompt: boolean;
  showEndLiveConfirm: boolean;
  liveEndTitle: string;
  liveEndMessage: string;
  liveEndConfirmLabel: string;
  showLiveEnded: boolean;
  showLivePopup: boolean;
  liveTitle: string;
  showEmojiPreset: boolean;
  showNoticeEdit: boolean;
  showNotice: boolean;
  fullViewImage: FullViewImageState | null;
  currentColor: string;
  backgroundType: "default" | "color" | "image";
  backgroundColor: string | null;
  backgroundImage: string | null;
  backgroundOverlay: number;
  backgroundBlur: boolean;
  passcodeHint: string;
  showOnProfile: boolean;
  onHeaderSettings: () => void;
  onHeaderGallery: () => void;
  onHeaderLinks: () => void;
  onHeaderReportChannel?: () => void;
  onCloseHeaderMenu: () => void;
  onChannelReportSubmit: (reason: string, details: string) => Promise<void>;
  onCloseChannelReportDialog: () => void;
  onModerationPetitionSubmit: (message: string) => Promise<void>;
  onCloseModerationPetitionDialog: () => void;
  onCloseOwnerChannels: () => void;
  onViewerColorChange: (color: string) => void;
  onSettingsAdmin?: () => void;
  onCloseSettings: () => void;
  onLoadMoreGallery: () => void;
  onViewGalleryImage: (src: string, meta: { id: string; created_at: string }) => void;
  onCloseGallery: () => void;
  onCloseLinks: () => void;
  onToggleView: () => void;
  onPetitionToggle: () => void;
  onDmToggle: () => void;
  onShowOnProfileToggle: (visible: boolean) => void;
  onColorChange: (color: string) => void;
  onBackgroundChange: (background: {
    background_type: "default" | "color" | "image";
    background_color: string | null;
    background_image: string | null;
    background_overlay: number;
    background_blur: number;
  }) => void;
  onNameChange: (name: string) => void;
  onProfileImageChange: (url: string) => void;
  onPasscodeChange: (hasPasscode: boolean, hint: string) => void;
  onRulesNoticeChange: (notice: string) => void;
  onWelcomeChange: (config: string) => void;
  onUnblock: (uid: string) => void;
  onCloseAdminPanel: () => void;
  onEmojiSelect: (emoji: string, messageId: string) => void;
  onCloseEmojiPicker: () => void;
  onPlusPhoto: () => void;
  onPlusDmToggle: () => void;
  onFreezeToggle?: () => void;
  onLiveToggle?: () => void;
  onPlusNotice?: () => void;
  onPlusEmojiPreset: () => void;
  onReportFilterSelect?: (filter: "open" | "warned" | "frozen") => void;
  onClosePlusMenu: () => void;
  onLiveStart: (title: string) => Promise<void>;
  onCloseLiveTitlePrompt: () => void;
  onConfirmEndLive: () => Promise<void>;
  onCancelEndLive: () => void;
  onCloseLiveEnded: () => void;
  onJoinLivePopup: () => void;
  onDismissLivePopup: () => void;
  onCloseEmojiPreset: () => void;
  onNoticeEditSave: (title: string, body: string) => void;
  onCloseNoticeEdit: () => void;
  onCloseNotice: () => void;
  onCloseFullViewImage: () => void;
  onJumpFromGalleryImage: (msgId: string) => void;
}

function parseNoticeTitle(activeNotice: string): string {
  try {
    const parsed = JSON.parse(activeNotice);
    return parsed.title || activeNotice;
  } catch {
    return activeNotice;
  }
}

function parseNoticeBody(activeNotice: string): string {
  try {
    const parsed = JSON.parse(activeNotice);
    return parsed.body || "";
  } catch {
    return "";
  }
}

function parseNoticeList(notice: string): { title: string; items: string[] }[] {
  try {
    return JSON.parse(notice || "[]");
  } catch {
    return [];
  }
}

export function ChatViewOverlays({
  channelId,
  channelName,
  channelOwnerUid,
  channelProfileImage,
  channelNotice,
  bubbleColor,
  welcomeConfig,
  activeNotice,
  locale,
  timeZone,
  effectiveAdmin,
  showModerationPetitionDialog,
  submittingModerationPetition,
  headerMenu,
  showChannelReportDialog,
  submittingChannelReport,
  showOwnerChannels,
  showSettings,
  showGallery,
  galleryItems,
  galleryHasMore,
  showLinks,
  linksChannelId,
  showAdminPanel,
  petitionEnabled,
  dmEnabled,
  blockedUsers,
  emojiPicker,
  plusMenu,
  dmMode,
  isFrozen,
  liveActive,
  inLiveMode,
  reportsOwnerFilter,
  isReportsOwnerView,
  showLiveTitlePrompt,
  showEndLiveConfirm,
  liveEndTitle,
  liveEndMessage,
  liveEndConfirmLabel,
  showLiveEnded,
  showLivePopup,
  liveTitle,
  showEmojiPreset,
  showNoticeEdit,
  showNotice,
  fullViewImage,
  currentColor,
  backgroundType,
  backgroundColor,
  backgroundImage,
  backgroundOverlay,
  backgroundBlur,
  passcodeHint,
  showOnProfile,
  onHeaderSettings,
  onHeaderGallery,
  onHeaderLinks,
  onHeaderReportChannel,
  onCloseHeaderMenu,
  onChannelReportSubmit,
  onCloseChannelReportDialog,
  onModerationPetitionSubmit,
  onCloseModerationPetitionDialog,
  onCloseOwnerChannels,
  onViewerColorChange,
  onSettingsAdmin,
  onCloseSettings,
  onLoadMoreGallery,
  onViewGalleryImage,
  onCloseGallery,
  onCloseLinks,
  onToggleView,
  onPetitionToggle,
  onDmToggle,
  onShowOnProfileToggle,
  onColorChange,
  onBackgroundChange,
  onNameChange,
  onProfileImageChange,
  onPasscodeChange,
  onRulesNoticeChange,
  onWelcomeChange,
  onUnblock,
  onCloseAdminPanel,
  onEmojiSelect,
  onCloseEmojiPicker,
  onPlusPhoto,
  onPlusDmToggle,
  onFreezeToggle,
  onLiveToggle,
  onPlusNotice,
  onPlusEmojiPreset,
  onReportFilterSelect,
  onClosePlusMenu,
  onLiveStart,
  onCloseLiveTitlePrompt,
  onConfirmEndLive,
  onCancelEndLive,
  onCloseLiveEnded,
  onJoinLivePopup,
  onDismissLivePopup,
  onCloseEmojiPreset,
  onNoticeEditSave,
  onCloseNoticeEdit,
  onCloseNotice,
  onCloseFullViewImage,
  onJumpFromGalleryImage,
}: ChatViewOverlaysProps) {
  return (
    <>
      <WelcomePopup
        channelId={channelId}
        bubbleColor={bubbleColor}
        profileImage={channelProfileImage}
        customConfig={welcomeConfig}
      />

      {headerMenu && (
        <HeaderMenu
          anchorRect={headerMenu}
          onSettings={onHeaderSettings}
          onGallery={onHeaderGallery}
          onLinks={onHeaderLinks}
          onReportChannel={onHeaderReportChannel}
          onClose={onCloseHeaderMenu}
        />
      )}

      {showChannelReportDialog && (
        <ChannelReportDialog
          channelName={channelName || channelId}
          submitting={submittingChannelReport}
          onSubmit={onChannelReportSubmit}
          onClose={onCloseChannelReportDialog}
        />
      )}

      {showModerationPetitionDialog && (
        <ModerationPetitionDialog
          submitting={submittingModerationPetition}
          onSubmit={onModerationPetitionSubmit}
          onClose={onCloseModerationPetitionDialog}
        />
      )}

      {showOwnerChannels && (
        <OwnerChannelsPopup
          currentChannelId={channelId}
          ownerUid={channelOwnerUid}
          bubbleColor={bubbleColor}
          onClose={onCloseOwnerChannels}
        />
      )}

      {showSettings && (
        <SettingsPanel
          channelId={channelId}
          currentColor={currentColor}
          onColorChange={onViewerColorChange}
          onAdmin={onSettingsAdmin}
          onClose={onCloseSettings}
        />
      )}

      {showGallery && (
        <GalleryPanel
          items={galleryItems}
          hasMore={galleryHasMore}
          onLoadMore={onLoadMoreGallery}
          onViewImage={onViewGalleryImage}
          onClose={onCloseGallery}
        />
      )}

      {showLinks && (
        <LinksPanel
          channelId={linksChannelId}
          onClose={onCloseLinks}
        />
      )}

      {showAdminPanel && (
        <AdminPanel
          channelId={channelId}
          channelName={channelName}
          profileImage={channelProfileImage}
          currentColor={currentColor}
          backgroundType={backgroundType}
          backgroundColor={backgroundColor}
          backgroundImage={backgroundImage}
          backgroundOverlay={backgroundOverlay}
          backgroundBlur={backgroundBlur}
          passcodeHint={passcodeHint}
          petitionEnabled={petitionEnabled}
          dmEnabled={dmEnabled}
          showOnProfile={showOnProfile}
          notice={channelNotice}
          welcomeConfig={welcomeConfig}
          blockedUsers={blockedUsers}
          onToggleView={onToggleView}
          onPetitionToggle={onPetitionToggle}
          onDmToggle={onDmToggle}
          onShowOnProfileToggle={onShowOnProfileToggle}
          onColorChange={onColorChange}
          onBackgroundChange={onBackgroundChange}
          onNameChange={onNameChange}
          onProfileImageChange={onProfileImageChange}
          onPasscodeChange={onPasscodeChange}
          onNoticeChange={onRulesNoticeChange}
          onWelcomeChange={onWelcomeChange}
          onUnblock={onUnblock}
          onClose={onCloseAdminPanel}
        />
      )}

      {emojiPicker && (
        <EmojiPicker
          anchorRect={emojiPicker.rect}
          onSelect={(emoji) => onEmojiSelect(emoji, emojiPicker.msgId)}
          onClose={onCloseEmojiPicker}
        />
      )}

      {plusMenu && (
        <PlusMenu
          anchorRect={plusMenu}
          dmMode={dmMode}
          dmEnabled={dmEnabled}
          isAdmin={effectiveAdmin}
          isFrozen={isFrozen}
          liveActive={liveActive}
          inLiveMode={inLiveMode}
          onPhoto={onPlusPhoto}
          onDmToggle={onPlusDmToggle}
          onFreezeToggle={onFreezeToggle}
          onLiveToggle={onLiveToggle}
          onNotice={onPlusNotice}
          onEmojiPreset={onPlusEmojiPreset}
          reportFilter={reportsOwnerFilter}
          onReportFilterSelect={isReportsOwnerView ? onReportFilterSelect : undefined}
          onClose={onClosePlusMenu}
        />
      )}

      {showLiveTitlePrompt && (
        <LiveTitlePrompt
          onStart={onLiveStart}
          onCancel={onCloseLiveTitlePrompt}
        />
      )}

      {showEndLiveConfirm && (
        <ConfirmDialog
          title={liveEndTitle}
          message={liveEndMessage}
          confirmLabel={liveEndConfirmLabel}
          confirmColor="#c0392b"
          onConfirm={onConfirmEndLive}
          onCancel={onCancelEndLive}
        />
      )}

      {showLiveEnded && (
        <LiveEndedPopup onClose={onCloseLiveEnded} />
      )}

      {showLivePopup && (
        <LivePopup
          title={liveTitle}
          onJoin={onJoinLivePopup}
          onDismiss={onDismissLivePopup}
        />
      )}

      {showEmojiPreset && (
        <EmojiPresetPanel
          channelId={channelId}
          onClose={onCloseEmojiPreset}
        />
      )}

      {showNoticeEdit && (
        <NoticeEditDialog
          currentTitle={parseNoticeTitle(activeNotice)}
          currentBody={parseNoticeBody(activeNotice)}
          onSave={onNoticeEditSave}
          onClose={onCloseNoticeEdit}
        />
      )}

      {showNotice && (
        <NoticePanel
          notice={parseNoticeList(channelNotice)}
          onClose={onCloseNotice}
        />
      )}

      {fullViewImage && (
        <div
          className="fixed inset-0 z-[120] flex flex-col items-center justify-center cursor-pointer animate-[ctxFade_0.2s_ease]"
          style={{ background: "rgba(0,0,0,.85)" }}
          onClick={onCloseFullViewImage}
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
                  onClick={() => onJumpFromGalleryImage(fullViewImage.msgId!)}
                  style={{ background: "rgba(255,255,255,.2)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,.3)", color: "#fff", fontSize: "calc(var(--bubble-font-size) - 2px)", padding: "6px 14px", borderRadius: "20px", cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}
                >
                  {chatDateLabel(fullViewImage.date, locale, timeZone)} →
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
