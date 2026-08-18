"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import { adminAction } from "@/lib/api-chat";
import { canBlockMessage, canReplyToMessage } from "./messageActionRules";
import type { Message, PetitionMeta, ReportMeta } from "./chatTypes";
import type {
  ChatTimelineIdentity,
  ChatTimelineMutationItem,
  ChatTimelineSource,
} from "./chatTimelineState";

interface BannerState {
  text: string;
  color: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface ContextMenuState {
  msg: Message;
  isSent: boolean;
  isOwn: boolean;
  rect: DOMRect;
  bubbleEl: HTMLElement;
}

interface BlockedUser {
  uid: string;
  reason: string;
}

interface ContextMenuText {
  deleteLabel: string;
  anonLabel: string;
  anonBlockedLabel: string;
  anonUnblockedLabel: string;
  reportDismissedBanner: string;
  deleteFailed: string;
  messageDeleted: string;
  undo: string;
}

interface UseChatContextMenuActionsArgs {
  channelId: string;
  inLiveMode: boolean;
  effectiveAdmin: boolean;
  ownerModerationBlocked: boolean;
  canUseAdminMutations: boolean;
  contextMenu: ContextMenuState | null;
  messages: Message[];
  dmMessages: Message[];
  blockedUsers: ReadonlyArray<BlockedUser>;
  reportActionPendingId: string | null;
  setReplyingTo: Dispatch<SetStateAction<Message | null>>;
  focusTextarea: () => void;
  reportMessage: (message: Message) => void;
  unreportMessage: (message: Message) => void;
  isMessageReported: (messageId: string) => boolean;
  handleDelete: (messageId: string, source?: ChatTimelineSource) => void;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  removeTimelineItems: (identities: ReadonlyArray<ChatTimelineIdentity>) => void;
  restoreTimelineItems: (items: ReadonlyArray<ChatTimelineMutationItem>) => void;
  setGalleryItems: Dispatch<SetStateAction<{ id: string; image: string; created_at: string }[]>>;
  setBanner: Dispatch<SetStateAction<BannerState | null>>;
  setBlockedUsers: Dispatch<SetStateAction<BlockedUser[]>>;
  openEditDialog: (message: Message) => void;
  handleReportAction: (
    report: ReportMeta,
    action: "warn_owner" | "freeze_channel" | "unfreeze_channel" | "delete_channel" | "resolve" | "dismiss",
  ) => Promise<void>;
  handlePetitionAction: (
    petition: PetitionMeta,
    action: "accept_petition" | "reject_petition" | "unfreeze_channel",
  ) => Promise<void>;
  text: ContextMenuText;
}

export interface UseChatContextMenuActionsResult {
  onReply?: (msgId: string) => void;
  onReport?: (msgId: string) => void;
  onUnreport?: (msgId: string) => void;
  isReported: boolean;
  onDelete?: (msgId: string) => void;
  onDeleteWithReplies?: (msgId: string) => void;
  onEdit?: (msgId: string) => void;
  onBlock?: (message: { id: string; uid: string; text: string; dm?: boolean }) => void;
  isBlockedUser: boolean;
  onDismissReportMessage?: (msgId: string) => void;
  onReportAction?: (action: "warn_owner" | "freeze_channel" | "unfreeze_channel" | "delete_channel" | "resolve" | "dismiss") => void;
  onPetitionAction?: (action: "accept_petition" | "reject_petition" | "unfreeze_channel") => void;
  reportActionPending: boolean;
}

export function useChatContextMenuActions({
  channelId,
  inLiveMode,
  effectiveAdmin,
  ownerModerationBlocked,
  canUseAdminMutations,
  contextMenu,
  messages,
  dmMessages,
  blockedUsers,
  reportActionPendingId,
  setReplyingTo,
  focusTextarea,
  reportMessage,
  unreportMessage,
  isMessageReported,
  handleDelete,
  setMessages,
  removeTimelineItems,
  restoreTimelineItems,
  setGalleryItems,
  setBanner,
  setBlockedUsers,
  openEditDialog,
  handleReportAction,
  handlePetitionAction,
  text,
}: UseChatContextMenuActionsArgs): UseChatContextMenuActionsResult {
  const flashBanner = useCallback((message: string, color: string) => {
    setBanner({ text: message, color });
    setTimeout(() => setBanner(null), 3000);
  }, [setBanner]);

  const onReply = useCallback((msgId: string) => {
    const allMessages = [...messages, ...dmMessages];
    const message = allMessages.find((item) => item.id === msgId);
    if (!message) return;

    if (message.reply_to) {
      const parent = allMessages.find((item) => item.id === message.reply_to);
      setReplyingTo(parent || message);
    } else {
      setReplyingTo(message);
    }

    focusTextarea();
  }, [dmMessages, focusTextarea, messages, setReplyingTo]);

  const onDeleteWithReplies = useCallback((msgId: string) => {
    const source = contextMenu?.msg.dm ? "dm" : "message";
    const sourceMessages = source === "dm" ? dmMessages : messages;
    const targetMessage = sourceMessages.find((message) => message.id === msgId);
    const idsToDelete = new Set([msgId]);

    if (source === "message" && targetMessage?.report && targetMessage.reported_msg_id) {
      idsToDelete.add(targetMessage.reported_msg_id);
      messages.forEach((message) => {
        if (message.reply_to === targetMessage.reported_msg_id) {
          idsToDelete.add(message.id);
        }
      });
    }

    sourceMessages.forEach((message) => {
      if (message.reply_to === msgId) {
        idsToDelete.add(message.id);
      }
    });

    const channelKey = inLiveMode ? `${channelId}_live` : channelId;
    const deletedMessages = source === "message"
      ? messages.filter((message) => idsToDelete.has(message.id))
      : [];
    const deletedDmMessages = source === "dm"
      ? dmMessages.filter((message) => idsToDelete.has(message.id))
      : [];
    removeTimelineItems([
      ...deletedMessages.map((message) => ({ source: "message" as const, id: message.id })),
      ...deletedDmMessages.map((message) => ({ source: "dm" as const, id: message.id })),
    ]);
    setGalleryItems((previous) => previous.filter((item) => !idsToDelete.has(item.id)));

    const restoreDeletedMessages = (showFailure = true) => {
      restoreTimelineItems([
        ...deletedMessages.map((message) => ({ source: "message" as const, message })),
        ...deletedDmMessages.map((message) => ({ source: "dm" as const, message })),
      ]);
      const restoredGallery = [...deletedMessages, ...deletedDmMessages]
        .filter((message): message is Message & { image: string } => typeof message.image === "string" && message.image.length > 0)
        .map((message) => ({ id: message.id, image: message.image, created_at: message.created_at }));
      setGalleryItems((current) => {
        const existingIds = new Set(current.map((item) => item.id));
        return [...current, ...restoredGallery.filter((item) => !existingIds.has(item.id))]
          .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));
      });
      if (showFailure) flashBanner(text.deleteFailed, "#d32f2f");
    };
    const requestIds = targetMessage?.report && targetMessage.reported_msg_id
      ? [msgId, targetMessage.reported_msg_id]
      : [msgId];
    const requests = requestIds.map((id) => {
      if (source === "dm") {
        return adminAction("delete-dm", channelKey, { dm_id: id }, { keepalive: true });
      }
      return adminAction("delete-message", channelKey, { message_id: id }, { keepalive: true });
    });
    void Promise.all(requests).then((results) => {
      if (results.every((result) => result?.ok)) {
        const deletionIds = results
          .map((result) => result?.deletion_id)
          .filter((id): id is string => typeof id === "string" && !!id);
        const deadlineMs = Math.min(...results.map((result) =>
          typeof result?.undo_expires_at === "string"
            ? Date.parse(result.undo_expires_at)
            : Number.NaN
        ).filter(Number.isFinite));
        if (deletionIds.length !== results.length || !Number.isFinite(deadlineMs)) {
          flashBanner(text.messageDeleted, "#333333");
          return;
        }

        let active = true;
        const undo = () => {
          if (!active) return;
          active = false;
          clearTimeout(timer);
          void Promise.all(deletionIds.map((deletionId) =>
            adminAction("undo-delete", channelKey, { deletion_id: deletionId }, { keepalive: true })
          )).then((undoResults) => {
            if (!undoResults.every((result) => result?.ok)) {
              flashBanner(text.deleteFailed, "#d32f2f");
              return;
            }
            restoreDeletedMessages(false);
            setBanner(null);
          }).catch(() => flashBanner(text.deleteFailed, "#d32f2f"));
        };
        const timer = setTimeout(() => {
          active = false;
          setBanner((current) => current?.onAction === undo ? null : current);
        }, Math.max(0, deadlineMs - Date.now()));
        setBanner({
          text: text.messageDeleted,
          color: "#333333",
          actionLabel: text.undo,
          onAction: undo,
        });
        return;
      }
      restoreDeletedMessages();
    }).catch(restoreDeletedMessages);
  }, [channelId, contextMenu, dmMessages, flashBanner, inLiveMode, messages, removeTimelineItems, restoreTimelineItems, setBanner, setGalleryItems, text.deleteFailed, text.messageDeleted, text.undo]);

  const onEdit = useCallback((msgId: string) => {
    const message = messages.find((item) => item.id === msgId);
    if (message) {
      openEditDialog(message);
    }
  }, [messages, openEditDialog]);

  const onDismissReportMessage = useCallback((msgId: string) => {
    const idsToDelete = new Set([msgId]);
    messages.forEach((message) => {
      if (message.reply_to === msgId) {
        idsToDelete.add(message.id);
      }
    });

    setMessages((previous) => previous.filter((message) => !idsToDelete.has(message.id)));

    const channelKey = inLiveMode ? `${channelId}_live` : channelId;
    void adminAction("delete-message", channelKey, { message_id: msgId });

    flashBanner(text.reportDismissedBanner, "var(--meta)");
  }, [channelId, flashBanner, inLiveMode, messages, setMessages, text.reportDismissedBanner]);

  const onBlock = useCallback((targetMessage: { id: string; uid: string; text: string; dm?: boolean }) => {
    const blockUid = targetMessage.uid;
    const blocked = blockedUsers.some((entry) => entry.uid === blockUid);

    if (blocked) {
      void adminAction("unblock", channelId, { uid: blockUid });
      setBlockedUsers((previous) => previous.filter((entry) => entry.uid !== blockUid));
      flashBanner(`${text.anonLabel}#${blockUid.slice(-4)} ${text.anonUnblockedLabel}`, "#2a9d4e");
      return;
    }

    const reason = targetMessage.text?.slice(0, 50) || "";
    void adminAction("block", channelId, {
      message_id: targetMessage.id,
      message_kind: targetMessage.dm ? "dm" : "message",
      reason,
    });
    setBlockedUsers((previous) => [...previous, { uid: blockUid, reason }]);
    flashBanner(`${text.anonLabel}#${blockUid.slice(-4)} ${text.anonBlockedLabel}`, "#d32f2f");
  }, [
    blockedUsers,
    channelId,
    flashBanner,
    setBlockedUsers,
    text.anonBlockedLabel,
    text.anonLabel,
    text.anonUnblockedLabel,
  ]);

  const onReportAction = useCallback((action: "warn_owner" | "freeze_channel" | "unfreeze_channel" | "delete_channel" | "resolve" | "dismiss") => {
    if (contextMenu?.msg.report_meta) {
      void handleReportAction(contextMenu.msg.report_meta, action);
    }
  }, [contextMenu, handleReportAction]);

  const onPetitionAction = useCallback((action: "accept_petition" | "reject_petition" | "unfreeze_channel") => {
    if (contextMenu?.msg.petition_meta) {
      void handlePetitionAction(contextMenu.msg.petition_meta, action);
    }
  }, [contextMenu, handlePetitionAction]);

  const canReply = Boolean(contextMenu && canReplyToMessage(contextMenu.msg, effectiveAdmin));
  const canReport = Boolean(contextMenu && !contextMenu.msg.dm && !effectiveAdmin && !contextMenu.isOwn);
  const canDeleteOwnDm = Boolean(
    contextMenu
    && !effectiveAdmin
    && contextMenu.isOwn
    && contextMenu.msg.dm
    && !contextMenu.msg.dm_reply
  );
  const canDeleteOwnDmReply = Boolean(
    contextMenu
    && effectiveAdmin
    && contextMenu.isOwn
    && contextMenu.msg.dm
    && contextMenu.msg.dm_reply
    && !ownerModerationBlocked
  );
  const canDelete = canDeleteOwnDm || canDeleteOwnDmReply || Boolean(
    contextMenu?.isOwn && !contextMenu.msg.dm && !ownerModerationBlocked
  );
  const canDeleteWithReplies = Boolean(contextMenu && canUseAdminMutations && !contextMenu.isOwn);
  const canEdit = Boolean(contextMenu?.isOwn && !contextMenu.msg.dm && !ownerModerationBlocked);
  const canBlock = Boolean(contextMenu && canUseAdminMutations && !contextMenu.isOwn && canBlockMessage(contextMenu.msg));
  const canDismissReportMessage = Boolean(contextMenu && canUseAdminMutations && contextMenu.msg.report && contextMenu.msg.reported_msg_id);
  const canModerateReport = Boolean(contextMenu?.msg.report_meta && canUseAdminMutations);
  const canModeratePetition = Boolean(contextMenu?.msg.petition_meta && canUseAdminMutations);
  const isBlockedUser = Boolean(contextMenu && blockedUsers.some((entry) => entry.uid === contextMenu.msg.uid));
  const isReported = Boolean(contextMenu && isMessageReported(contextMenu.msg.id));
  const reportActionPending = Boolean(
    canUseAdminMutations
    && contextMenu
    && reportActionPendingId
    && (
      reportActionPendingId === contextMenu.msg.report_meta?.report_id
      || reportActionPendingId === contextMenu.msg.petition_meta?.petition_id
    )
  );

  return {
    onReply: canReply ? onReply : undefined,
    onReport: canReport && contextMenu ? () => reportMessage(contextMenu.msg) : undefined,
    onUnreport: canReport && contextMenu ? () => unreportMessage(contextMenu.msg) : undefined,
    isReported,
    onDelete: canDelete && contextMenu
      ? (messageId) => handleDelete(messageId, contextMenu.msg.dm ? "dm" : "message")
      : undefined,
    onDeleteWithReplies: canDeleteWithReplies ? onDeleteWithReplies : undefined,
    onEdit: canEdit ? onEdit : undefined,
    onBlock: canBlock ? onBlock : undefined,
    isBlockedUser,
    onDismissReportMessage: canDismissReportMessage ? onDismissReportMessage : undefined,
    onReportAction: canModerateReport ? onReportAction : undefined,
    onPetitionAction: canModeratePetition ? onPetitionAction : undefined,
    reportActionPending,
  };
}
