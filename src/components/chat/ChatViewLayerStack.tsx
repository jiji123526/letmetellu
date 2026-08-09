"use client";

import { ContextMenu } from "./ContextMenu";
import { ChatViewOverlays } from "./ChatViewOverlays";
import type { Channel } from "./chatViewTypes";
import type { UseChatAdminChannelActionsResult } from "./useChatAdminChannelActions";
import type { UseChatChannelSettingsResult } from "./useChatChannelSettings";
import type { UseChatContextMenuActionsResult } from "./useChatContextMenuActions";
import type { ContextMenuState, EmojiPickerState, FullViewImageState } from "./useChatInteractions";
import type { UseChatOverlayCallbacksResult } from "./useChatOverlayCallbacks";

interface GalleryItem {
  id: string;
  image: string;
  created_at: string;
}

interface BlockedUser {
  uid: string;
  reason: string;
}

interface ChatViewLayerStackProps {
  channelId: string;
  channel: Channel | null;
  bubbleColor: string;
  welcomeConfig: string;
  activeNotice: string;
  locale: "ko" | "en";
  timeZone: string;
  effectiveAdmin: boolean;
  isAdmin: boolean;
  ownerModerationBlocked: boolean;
  canUseAdminMutations: boolean;
  petitionEnabled: boolean;
  dmEnabled: boolean;
  blockedUsers: BlockedUser[];
  galleryItems: GalleryItem[];
  galleryHasMore: boolean;
  emojiPicker: EmojiPickerState | null;
  plusMenu: DOMRect | null;
  dmMode: boolean;
  liveActive: boolean;
  inLiveMode: boolean;
  reportsOwnerFilter: "open" | "warned" | "frozen" | null;
  isReportsOwnerView: boolean;
  showModerationPetitionDialog: boolean;
  submittingModerationPetition: boolean;
  fullViewImage: FullViewImageState | null;
  linksChannelId: string;
  showLiveTitlePrompt: boolean;
  showEndLiveConfirm: boolean;
  liveEndTitle: string;
  liveEndMessage: string;
  liveEndConfirmLabel: string;
  showLiveEnded: boolean;
  showLivePopup: boolean;
  liveTitle: string;
  onReportFilterSelect: (filter: "open" | "warned" | "frozen") => void;
  contextMenu: ContextMenuState | null;
  contextMenuActions: UseChatContextMenuActionsResult;
  overlayCallbacks: UseChatOverlayCallbacksResult;
  adminUi: UseChatAdminChannelActionsResult;
  settingsActions: UseChatChannelSettingsResult;
  onReaction: (messageId: string, emoji: string) => void;
  onOpenEmojiPicker: (messageId: string, rect: DOMRect) => void;
  onCloseContextMenu: () => void;
  onModerationPetitionSubmit: (message: string) => Promise<void>;
  onCloseEmojiPicker: () => void;
  onCloseFullViewImage: () => void;
}

export function ChatViewLayerStack({
  channelId,
  channel,
  bubbleColor,
  welcomeConfig,
  activeNotice,
  locale,
  timeZone,
  effectiveAdmin,
  isAdmin,
  ownerModerationBlocked,
  canUseAdminMutations,
  petitionEnabled,
  dmEnabled,
  blockedUsers,
  galleryItems,
  galleryHasMore,
  emojiPicker,
  plusMenu,
  dmMode,
  liveActive,
  inLiveMode,
  reportsOwnerFilter,
  isReportsOwnerView,
  showModerationPetitionDialog,
  submittingModerationPetition,
  fullViewImage,
  linksChannelId,
  showLiveTitlePrompt,
  showEndLiveConfirm,
  liveEndTitle,
  liveEndMessage,
  liveEndConfirmLabel,
  showLiveEnded,
  showLivePopup,
  liveTitle,
  onReportFilterSelect,
  contextMenu,
  contextMenuActions,
  overlayCallbacks,
  adminUi,
  settingsActions,
  onReaction,
  onOpenEmojiPicker,
  onCloseContextMenu,
  onModerationPetitionSubmit,
  onCloseEmojiPicker,
  onCloseFullViewImage,
}: ChatViewLayerStackProps) {
  return (
    <>
      {contextMenu && (
        <ContextMenu
          msg={contextMenu.msg}
          isSent={contextMenu.isSent}
          anchorRect={contextMenu.rect}
          bubbleEl={contextMenu.bubbleEl}
          isAdmin={effectiveAdmin}
          onReaction={onReaction}
          onReply={contextMenuActions.onReply}
          onReport={contextMenuActions.onReport}
          onUnreport={contextMenuActions.onUnreport}
          isReported={contextMenuActions.isReported}
          onDelete={contextMenuActions.onDelete}
          onDeleteWithReplies={contextMenuActions.onDeleteWithReplies}
          onEdit={contextMenuActions.onEdit}
          onBlock={contextMenuActions.onBlock}
          isBlockedUser={contextMenuActions.isBlockedUser}
          onDismissReportMessage={contextMenuActions.onDismissReportMessage}
          onReportAction={contextMenuActions.onReportAction}
          onPetitionAction={contextMenuActions.onPetitionAction}
          reportActionPending={contextMenuActions.reportActionPending}
          onEmojiPicker={onOpenEmojiPicker}
          onClose={onCloseContextMenu}
          isMyMessage={contextMenu.isOwn}
        />
      )}

      <ChatViewOverlays
        channelId={channelId}
        channelName={channel?.name || ""}
        channelProfileImage={channel?.profile_image || null}
        channelNotice={channel?.notice || "[]"}
        bubbleColor={bubbleColor}
        welcomeConfig={welcomeConfig}
        activeNotice={activeNotice}
        locale={locale}
        timeZone={timeZone}
        effectiveAdmin={effectiveAdmin}
        showModerationPetitionDialog={showModerationPetitionDialog}
        submittingModerationPetition={submittingModerationPetition}
        headerMenu={adminUi.headerMenu}
        showChannelReportDialog={adminUi.showChannelReportDialog}
        submittingChannelReport={adminUi.submittingChannelReport}
        showOwnerChannels={adminUi.showOwnerChannels}
        showSettings={adminUi.showSettings}
        showGallery={adminUi.showGallery}
        galleryItems={galleryItems}
        galleryHasMore={galleryHasMore}
        showLinks={adminUi.showLinks}
        linksChannelId={linksChannelId}
        showAdminPanel={adminUi.showAdminPanel}
        petitionEnabled={petitionEnabled}
        dmEnabled={dmEnabled}
        blockedUsers={blockedUsers}
        emojiPicker={emojiPicker}
        plusMenu={plusMenu}
        dmMode={dmMode}
        isFrozen={!!channel?.is_frozen}
        liveActive={liveActive}
        inLiveMode={inLiveMode}
        reportsOwnerFilter={reportsOwnerFilter}
        isReportsOwnerView={isReportsOwnerView}
        showLiveTitlePrompt={showLiveTitlePrompt}
        showEndLiveConfirm={showEndLiveConfirm}
        liveEndTitle={liveEndTitle}
        liveEndMessage={liveEndMessage}
        liveEndConfirmLabel={liveEndConfirmLabel}
        showLiveEnded={showLiveEnded}
        showLivePopup={showLivePopup}
        liveTitle={liveTitle}
        showEmojiPreset={adminUi.showEmojiPreset}
        showNoticeEdit={adminUi.showNoticeEdit}
        showNotice={adminUi.showNotice}
        fullViewImage={fullViewImage}
        currentColor={bubbleColor}
        backgroundType={channel?.background_type || "default"}
        backgroundColor={channel?.background_color || null}
        backgroundImage={channel?.background_image || null}
        backgroundOverlay={channel?.background_overlay ?? 14}
        backgroundBlur={channel?.background_blur === 1}
        passcodeHint={channel?.passcode_hint || ""}
        showOnProfile={channel?.show_on_profile === 1}
        onHeaderSettings={adminUi.openSettings}
        onHeaderGallery={adminUi.openGallery}
        onHeaderLinks={adminUi.openLinks}
        onHeaderReportChannel={!isAdmin ? adminUi.openChannelReportDialog : undefined}
        onCloseHeaderMenu={adminUi.closeHeaderMenu}
        onChannelReportSubmit={adminUi.handleChannelReportSubmit}
        onCloseChannelReportDialog={adminUi.closeChannelReportDialog}
        onModerationPetitionSubmit={onModerationPetitionSubmit}
        onCloseModerationPetitionDialog={overlayCallbacks.closeModerationPetitionDialog}
        onCloseOwnerChannels={adminUi.closeOwnerChannels}
        onViewerColorChange={settingsActions.handleViewerColorChange}
        onSettingsAdmin={effectiveAdmin && !ownerModerationBlocked ? adminUi.openAdminPanel : undefined}
        onCloseSettings={adminUi.closeSettings}
        onLoadMoreGallery={adminUi.loadMoreGallery}
        onViewGalleryImage={overlayCallbacks.viewGalleryImage}
        onCloseGallery={adminUi.closeGallery}
        onCloseLinks={adminUi.closeLinks}
        onToggleView={settingsActions.handleToggleView}
        onPetitionToggle={settingsActions.handlePetitionToggle}
        onDmToggle={settingsActions.handleDmToggle}
        onShowOnProfileToggle={settingsActions.handleShowOnProfileToggle}
        onColorChange={settingsActions.handleColorChange}
        onBackgroundChange={settingsActions.handleBackgroundChange}
        onNameChange={settingsActions.handleNameChange}
        onProfileImageChange={settingsActions.handleProfileImageChange}
        onPasscodeChange={settingsActions.handlePasscodeChange}
        onRulesNoticeChange={settingsActions.handleNoticeChange}
        onWelcomeChange={settingsActions.handleWelcomeChange}
        onUnblock={settingsActions.handleUnblock}
        onCloseAdminPanel={adminUi.closeAdminPanel}
        onEmojiSelect={overlayCallbacks.handleOverlayEmojiSelect}
        onCloseEmojiPicker={onCloseEmojiPicker}
        onPlusPhoto={overlayCallbacks.openPlusPhotoPicker}
        onPlusDmToggle={overlayCallbacks.togglePlusDmMode}
        onFreezeToggle={canUseAdminMutations ? adminUi.handleAdminFreezeToggle : undefined}
        onLiveToggle={canUseAdminMutations ? adminUi.handleAdminLiveToggle : undefined}
        onPlusNotice={canUseAdminMutations ? adminUi.openNoticeEdit : undefined}
        onPlusEmojiPreset={adminUi.openEmojiPreset}
        onReportFilterSelect={onReportFilterSelect}
        onClosePlusMenu={overlayCallbacks.closePlusMenu}
        onLiveStart={overlayCallbacks.startLiveFromPrompt}
        onCloseLiveTitlePrompt={overlayCallbacks.closeLiveTitlePrompt}
        onConfirmEndLive={overlayCallbacks.confirmEndLive}
        onCancelEndLive={overlayCallbacks.cancelEndLive}
        onCloseLiveEnded={overlayCallbacks.closeLiveEnded}
        onJoinLivePopup={overlayCallbacks.joinLivePopup}
        onDismissLivePopup={overlayCallbacks.dismissLivePopup}
        onCloseEmojiPreset={adminUi.closeEmojiPreset}
        onNoticeEditSave={settingsActions.handleNoticeEditSave}
        onCloseNoticeEdit={adminUi.closeNoticeEdit}
        onCloseNotice={adminUi.closeNotice}
        onCloseFullViewImage={onCloseFullViewImage}
        onJumpFromGalleryImage={overlayCallbacks.jumpFromGalleryImage}
      />
    </>
  );
}
