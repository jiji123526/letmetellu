"use client";

import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { adminAction } from "@/lib/api-chat";
import { canBlockMessage, canReplyToMessage } from "./messageActionRules";
import type { Message, PetitionMeta, ReportMeta } from "./chatTypes";

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
  handleDelete: (messageId: string) => void;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setDmMessages: Dispatch<SetStateAction<Message[]>>;
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
  setDmMessages,
  setGalleryItems,
  setBanner,
  setBlockedUsers,
  openEditDialog,
  handleReportAction,
  handlePetitionAction,
  text,
}: UseChatContextMenuActionsArgs): UseChatContextMenuActionsResult {
  const pendingAdminDeleteRef = useRef<{
    timer: ReturnType<typeof setTimeout>;
    commit: () => void;
  } | null>(null);
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
    const targetMessage = messages.find((message) => message.id === msgId);
    const idsToDelete = new Set([msgId]);

    if (targetMessage?.report && targetMessage.reported_msg_id) {
      idsToDelete.add(targetMessage.reported_msg_id);
      messages.forEach((message) => {
        if (message.reply_to === targetMessage.reported_msg_id) {
          idsToDelete.add(message.id);
        }
      });
    }

    messages.forEach((message) => {
      if (message.reply_to === msgId) {
        idsToDelete.add(message.id);
      }
    });

    const channelKey = inLiveMode ? `${channelId}_live` : channelId;
    const allMessages = new Map([...messages, ...dmMessages].map((message) => [message.id, message]));
    const deletedMessages = messages.filter((message) => idsToDelete.has(message.id));
    const deletedDmMessages = dmMessages.filter((message) => idsToDelete.has(message.id));
    setMessages((previous) => previous.filter((message) => !idsToDelete.has(message.id)));
    setDmMessages((previous) => previous.filter((message) => !idsToDelete.has(message.id)));
    setGalleryItems((previous) => previous.filter((item) => !idsToDelete.has(item.id)));

    if (pendingAdminDeleteRef.current) {
      clearTimeout(pendingAdminDeleteRef.current.timer);
      pendingAdminDeleteRef.current.commit();
    }

    const commit = () => {
      idsToDelete.forEach((id) => {
        const message = allMessages.get(id);
        if (message?.dm) {
          void adminAction("delete-dm", channelKey, { dm_id: id });
        } else {
          void adminAction("delete-message", channelKey, { message_id: id });
        }
      });
    };
    const restoreMessages = (current: Message[], deleted: Message[]) => {
      const existingIds = new Set(current.map((message) => message.id));
      return [...current, ...deleted.filter((message) => !existingIds.has(message.id))]
        .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
    };
    const undo = () => {
      const pending = pendingAdminDeleteRef.current;
      if (!pending || pending.commit !== commit) return;
      clearTimeout(pending.timer);
      pendingAdminDeleteRef.current = null;
      setMessages((current) => restoreMessages(current, deletedMessages));
      setDmMessages((current) => restoreMessages(current, deletedDmMessages));
      const restoredGallery = [...deletedMessages, ...deletedDmMessages]
        .filter((message): message is Message & { image: string } => typeof message.image === "string" && message.image.length > 0)
        .map((message) => ({ id: message.id, image: message.image, created_at: message.created_at }));
      setGalleryItems((current) => {
        const existingIds = new Set(current.map((item) => item.id));
        return [...current, ...restoredGallery.filter((item) => !existingIds.has(item.id))]
          .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));
      });
      setBanner(null);
    };
    const timer = setTimeout(() => {
      if (pendingAdminDeleteRef.current?.commit !== commit) return;
      pendingAdminDeleteRef.current = null;
      commit();
      setBanner((current) => current?.onAction === undo ? null : current);
    }, 5000);
    pendingAdminDeleteRef.current = { timer, commit };
    setBanner({ text: text.messageDeleted, color: "#333333", actionLabel: text.undo, onAction: undo });
  }, [channelId, dmMessages, inLiveMode, messages, setBanner, setDmMessages, setGalleryItems, setMessages, text.messageDeleted, text.undo]);

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
  const canDelete = canDeleteOwnDm || Boolean(
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
    onDelete: canDelete ? handleDelete : undefined,
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
