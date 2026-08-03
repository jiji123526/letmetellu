"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import { adminAction } from "@/lib/api";
import { canBlockMessage, canReplyToMessage } from "./messageActionRules";
import type { Message, PetitionMeta, ReportMeta } from "./chatTypes";

interface BannerState {
  text: string;
  color: string;
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

interface UseChatContextMenuActionsResult {
  onReply?: (msgId: string) => void;
  onReport?: (msgId: string) => void;
  onUnreport?: (msgId: string) => void;
  isReported: boolean;
  onDelete?: (msgId: string) => void;
  onDeleteWithReplies?: (msgId: string) => void;
  onEdit?: (msgId: string) => void;
  onBlock?: (message: { id: string; uid: string; text: string; dm?: boolean }) => void;
  isBlockedUser: boolean;
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
    const message = messages.find((item) => item.id === msgId);
    if (!message) return;

    if (message.reply_to) {
      const parent = messages.find((item) => item.id === message.reply_to);
      setReplyingTo(parent || message);
    } else {
      setReplyingTo(message);
    }

    focusTextarea();
  }, [focusTextarea, messages, setReplyingTo]);

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

    setMessages((previous) => previous.filter((message) => !idsToDelete.has(message.id)));
    setDmMessages((previous) => previous.filter((message) => !idsToDelete.has(message.id)));

    const channelKey = inLiveMode ? `${channelId}_live` : channelId;
    const allMessages = new Map([...messages, ...dmMessages].map((message) => [message.id, message]));
    idsToDelete.forEach((id) => {
      const message = allMessages.get(id);
      if (message?.dm) {
        void adminAction("delete-dm", channelKey, { dm_id: id });
      } else {
        void adminAction("delete-message", channelKey, { message_id: id });
      }
    });

    flashBanner(text.deleteLabel, "#d32f2f");
  }, [channelId, dmMessages, flashBanner, inLiveMode, messages, setDmMessages, setMessages, text.deleteLabel]);

  const onEdit = useCallback((msgId: string) => {
    const message = messages.find((item) => item.id === msgId);
    if (message) {
      openEditDialog(message);
    }
  }, [messages, openEditDialog]);

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
  const canReport = Boolean(contextMenu && !effectiveAdmin && !contextMenu.isOwn);
  const canDelete = Boolean(contextMenu?.isOwn && !ownerModerationBlocked);
  const canDeleteWithReplies = Boolean(contextMenu && canUseAdminMutations && !contextMenu.isOwn);
  const canEdit = Boolean(contextMenu?.isOwn && !ownerModerationBlocked);
  const canBlock = Boolean(contextMenu && canUseAdminMutations && !contextMenu.isOwn && canBlockMessage(contextMenu.msg));
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
    onReportAction: canModerateReport ? onReportAction : undefined,
    onPetitionAction: canModeratePetition ? onPetitionAction : undefined,
    reportActionPending,
  };
}
