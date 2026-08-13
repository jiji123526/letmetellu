"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type KeyboardEvent, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import {
  adminAction,
  deleteMessage,
  editMessageApi,
  fetchMessages,
  sendDm,
  sendMessage as sendMessageApi,
  sendMessageAsAdmin,
  toggleReaction,
  toggleReactionAsAdmin,
  uploadAdminImage,
  uploadImage,
} from "@/lib/api-chat";
import { mergeServerMessageSnapshot, parseReactions } from "./chatMessageUtils";
import type { Message } from "./chatTypes";
import type { PendingPhoto } from "./useChatComposerState";

interface BannerState {
  text: string;
  color: string;
}

interface ConsumedComposerState {
  photos: PendingPhoto[];
  replyToId?: string;
}

interface MutationText {
  messageTooLong: string;
  bannedWord: string;
  rateLimited: string;
  blocked: string;
  petitionExists: string;
  ownerSuspendedBanner: string;
  moderationFrozenBanner: string;
  chatFrozen: string;
  dmDisabledMessage: string;
  sendFailed: string;
  blockReason: string;
  petitionPrefix: string;
  petitionSent: string;
  sentToAdmin: string;
  deletedMessage: string;
}

interface UseChatMessageMutationsArgs {
  channelId: string;
  uid: string;
  authUserId?: string | null;
  effectiveAdmin: boolean;
  dmMode: boolean;
  inLiveMode: boolean;
  input: string;
  replyingToId?: string;
  pendingPhotos: PendingPhoto[];
  messages: Message[];
  dmMessages: Message[];
  blockedUsers: ReadonlyArray<{ uid: string; reason: string }>;
  petitionEnabled: boolean;
  ownerModerationBlocked: boolean;
  viewerModerationStatus: "frozen" | null | undefined;
  channelFrozen: boolean;
  isUserBlocked: boolean;
  setDmMode: Dispatch<SetStateAction<boolean>>;
  setPendingPhotos: Dispatch<SetStateAction<PendingPhoto[]>>;
  setPetitionSentUidExternal?: Dispatch<SetStateAction<string>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setDmMessages: Dispatch<SetStateAction<Message[]>>;
  setGalleryItems: Dispatch<SetStateAction<{ id: string; image: string; created_at: string }[]>>;
  setBanner: Dispatch<SetStateAction<BannerState | null>>;
  refreshOwnerModeration: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  inLiveModeRef: MutableRefObject<boolean>;
  resetInput: () => void;
  restoreInput: (value: string) => void;
  consumeComposerState: () => ConsumedComposerState;
  text: MutationText;
}

interface UseChatMessageMutationsResult {
  hasPetitioned: boolean;
  isSending: boolean;
  handleSend: () => Promise<void>;
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  handleReaction: (messageId: string, emoji: string) => Promise<void>;
  handleDelete: (messageId: string) => void;
  handleEditSave: (messageId: string, newText: string) => Promise<void>;
}

export function useChatMessageMutations({
  channelId,
  uid,
  authUserId,
  effectiveAdmin,
  dmMode,
  inLiveMode,
  input,
  replyingToId,
  pendingPhotos,
  messages,
  dmMessages,
  blockedUsers,
  petitionEnabled,
  ownerModerationBlocked,
  viewerModerationStatus,
  channelFrozen,
  isUserBlocked,
  setDmMode,
  setPendingPhotos,
  setPetitionSentUidExternal,
  setMessages,
  setDmMessages,
  setGalleryItems,
  setBanner,
  refreshOwnerModeration,
  textareaRef,
  inLiveModeRef,
  resetInput,
  restoreInput,
  consumeComposerState,
  text,
}: UseChatMessageMutationsArgs): UseChatMessageMutationsResult {
  const sendInFlightRef = useRef(false);
  const sendAttemptRef = useRef<{ signature: string; id: string } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [petitionSentUid, setPetitionSentUid] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("petitionSent") || "";
  });

  const hasPetitioned = petitionSentUid === uid;

  const updatePetitionSentUid = useCallback((nextValue: string) => {
    setPetitionSentUid(nextValue);
    setPetitionSentUidExternal?.(nextValue);
  }, [setPetitionSentUidExternal]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isUserBlocked && hasPetitioned) {
      localStorage.removeItem("petitionSent");
      updatePetitionSentUid("");
    }
  }, [hasPetitioned, isUserBlocked, updatePetitionSentUid]);

  const clearBannerSoon = useCallback(() => {
    setTimeout(() => setBanner(null), 3000);
  }, [setBanner]);

  const showMutationError = useCallback((error?: string) => {
    if (error === "message_too_long") {
      setBanner({ text: text.messageTooLong, color: "#d32f2f" });
    } else if (error === "banned_word") {
      setBanner({ text: text.bannedWord, color: "#d32f2f" });
    } else if (error === "rate_limited") {
      setBanner({ text: text.rateLimited, color: "#d32f2f" });
    } else if (error === "blocked") {
      setBanner({ text: text.blocked, color: "#d32f2f" });
    } else if (error === "petition_exists") {
      if (typeof window !== "undefined") {
        localStorage.setItem("petitionSent", uid);
      }
      updatePetitionSentUid(uid);
      setBanner({ text: text.petitionExists, color: "#d32f2f" });
    } else if (error === "owner_suspended") {
      refreshOwnerModeration();
      setBanner({ text: text.ownerSuspendedBanner, color: "#8b5cf6" });
    } else if (error === "channel frozen") {
      setBanner({
        text: viewerModerationStatus === "frozen" ? text.moderationFrozenBanner : text.chatFrozen,
        color: "#4a4d8f",
      });
    } else if (error === "dm_disabled") {
      setBanner({ text: text.dmDisabledMessage, color: "#d32f2f" });
    } else {
      setBanner({ text: text.sendFailed, color: "#d32f2f" });
    }
    clearBannerSoon();
  }, [
    clearBannerSoon,
    refreshOwnerModeration,
    setBanner,
    text.bannedWord,
    text.blocked,
    text.chatFrozen,
    text.dmDisabledMessage,
    text.messageTooLong,
    text.moderationFrozenBanner,
    text.ownerSuspendedBanner,
    text.petitionExists,
    text.rateLimited,
    text.sendFailed,
    uid,
    updatePetitionSentUid,
    viewerModerationStatus,
  ]);

  const handleSend = useCallback(async () => {
    const nextText = input.trim();
    if ((!nextText && pendingPhotos.length === 0) || ownerModerationBlocked || (channelFrozen && !effectiveAdmin && !dmMode)) {
      return;
    }

    if (sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    setIsSending(true);

    const submissionSignature = JSON.stringify([
      inLiveMode ? `${channelId}_live` : channelId,
      dmMode,
      nextText,
      replyingToId || "",
      pendingPhotos.map((photo) => photo.previewUrl),
    ]);
    const submissionId = sendAttemptRef.current?.signature === submissionSignature
      ? sendAttemptRef.current.id
      : crypto.randomUUID();
    sendAttemptRef.current = { signature: submissionSignature, id: submissionId };
    let retainSubmissionId = false;

    try {
    if (isUserBlocked) {
      if (hasPetitioned || !petitionEnabled) {
        setBanner({ text: text.blocked, color: "#d32f2f" });
        clearBannerSoon();
        return;
      }

      resetInput();
      const blockEntry = blockedUsers.find((blockedUser) => blockedUser.uid === uid);
      const reason = blockEntry?.reason ? `\n[${text.blockReason}: "${blockEntry.reason}"]` : "";
      const petitionText = `[${text.petitionPrefix}] ${nextText}${reason}`;
      const result = await sendDm({
        client_message_id: submissionId,
        uid,
        text: petitionText,
        channel_id: inLiveMode ? `${channelId}_live` : channelId,
      });
      if (!result?.ok) {
        restoreInput(nextText);
        showMutationError(result?.error);
        return;
      }

      localStorage.setItem("petitionSent", uid);
      updatePetitionSentUid(uid);
      setBanner({ text: text.petitionSent, color: "#d32f2f" });
      clearBannerSoon();
      return;
    }

    const { photos, replyToId: savedReplyTo } = consumeComposerState();

    if (dmMode) {
      resetInput();
      setDmMode(false);
      const dmChannelId = inLiveMode ? `${channelId}_live` : channelId;
      const dmUpload = photos.length > 0 ? await uploadImage(photos[0].blob, dmChannelId, "dm") : null;
      if (photos.length > 0 && !dmUpload) {
        restoreInput(nextText);
        setDmMode(true);
        setPendingPhotos(photos);
        showMutationError("upload_failed");
        return;
      }

      const result = await sendDm({
        client_message_id: submissionId,
        uid,
        text: nextText,
        channel_id: dmChannelId,
        image: dmUpload?.url,
        upload_id: dmUpload?.uploadId,
      });
      if (!result?.ok) {
        restoreInput(nextText);
        setDmMode(true);
        setPendingPhotos(photos);
        showMutationError(result?.error);
        return;
      }

      setBanner({ text: text.sentToAdmin, color: "#7b3fa0" });
      clearBannerSoon();
      return;
    }

    if (!inLiveMode) {
      textareaRef.current?.blur();
    }

    const activeChannelId = inLiveMode ? `${channelId}_live` : channelId;
    const sender = effectiveAdmin && authUserId ? sendMessageAsAdmin : sendMessageApi;
    const senderUid = effectiveAdmin && authUserId ? authUserId : uid;
    let sendError: string | undefined;
    let unsentPhotos: typeof photos = [];

    try {
      if (photos.length === 0) {
        const result = await sender({
          client_message_id: submissionId,
          uid: senderUid,
          text: nextText,
          channel_id: activeChannelId,
          reply_to: savedReplyTo,
        });
        sendError = result.error;
      } else {
        for (let index = 0; index < photos.length; index += 1) {
          const upload = effectiveAdmin && authUserId
            ? await uploadAdminImage(photos[index].blob, activeChannelId, "message")
            : await uploadImage(photos[index].blob, activeChannelId, "message");
          if (!upload) {
            sendError = "upload_failed";
            unsentPhotos = photos.slice(index);
            break;
          }

          const result = await sender({
            client_message_id: `${submissionId}:${index}`,
            uid: senderUid,
            text: index === 0 ? nextText : "",
            channel_id: activeChannelId,
            image: upload.url,
            upload_id: upload.uploadId,
            reply_to: savedReplyTo,
          });

          if (result.error) {
            sendError = result.error;
            unsentPhotos = photos.slice(index);
            break;
          }

          URL.revokeObjectURL(photos[index].previewUrl);
          if (index === 0) {
            resetInput();
          }
        }
      }
    } catch {
      retainSubmissionId = true;
      sendError = "network_error";
      unsentPhotos = photos;
    }

    if (sendError) {
      if (unsentPhotos.length > 0) {
        setPendingPhotos(unsentPhotos);
      }
      showMutationError(sendError);
      return;
    }

    resetInput();
    } catch {
      retainSubmissionId = true;
      restoreInput(nextText);
      if (pendingPhotos.length > 0) setPendingPhotos(pendingPhotos);
      if (dmMode) setDmMode(true);
      showMutationError("network_error");
    } finally {
      if (!retainSubmissionId) sendAttemptRef.current = null;
      sendInFlightRef.current = false;
      setIsSending(false);
    }
  }, [
    authUserId,
    blockedUsers,
    channelFrozen,
    channelId,
    clearBannerSoon,
    consumeComposerState,
    dmMode,
    effectiveAdmin,
    hasPetitioned,
    inLiveMode,
    input,
    isUserBlocked,
    ownerModerationBlocked,
    pendingPhotos.length,
    pendingPhotos,
    petitionEnabled,
    replyingToId,
    resetInput,
    restoreInput,
    setBanner,
    setDmMode,
    setPendingPhotos,
    showMutationError,
    text.blockReason,
    text.blocked,
    text.petitionPrefix,
    text.petitionSent,
    text.sentToAdmin,
    textareaRef,
    uid,
    updatePetitionSentUid,
  ]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    const usesMobileComposer = window.matchMedia(
      "(max-width: 767px) and (pointer: coarse)",
    ).matches;
    if (
      event.key === "Enter"
      && !event.shiftKey
      && !usesMobileComposer
      && !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  const handleReaction = useCallback(async (messageId: string, emoji: string) => {
    const activeChannelId = inLiveModeRef.current ? `${channelId}_live` : channelId;
    const reactionUid = effectiveAdmin && authUserId ? authUserId : uid;

    setMessages((previous) =>
      previous.map((message) => {
        if (message.id !== messageId) return message;
        const reactions = parseReactions(message.reactions);
        const key = `${reactionUid}_${Date.now()}`;
        const existingKey = Object.entries(reactions).find(
          ([candidateKey, value]) => candidateKey.startsWith(`${reactionUid}_`) && value === emoji,
        )?.[0];
        if (existingKey) {
          delete reactions[existingKey];
        } else {
          reactions[key] = emoji;
        }
        return { ...message, reactions: JSON.stringify(reactions) };
      }),
    );

    try {
      const toggle = effectiveAdmin && authUserId ? toggleReactionAsAdmin : toggleReaction;
      const result = await toggle({
        uid: reactionUid,
        message_id: messageId,
        channel_id: activeChannelId,
        emoji,
      });

      if (result.error) throw new Error(result.error);

      if (result.reactions) {
        setMessages((previous) => previous.map((message) =>
          message.id === messageId
            ? { ...message, reactions: JSON.stringify(result.reactions) }
            : message,
        ));
      }
    } catch (error) {
      void fetchMessages(activeChannelId).then((data) => {
        if (data.messages) {
          setMessages((previous) => mergeServerMessageSnapshot(previous, data.messages));
        }
      }).catch(() => {});

      if (error instanceof Error && error.message === "owner_suspended") {
        refreshOwnerModeration();
        setBanner({ text: text.ownerSuspendedBanner, color: "#8b5cf6" });
      } else {
        setBanner({ text: text.sendFailed, color: "#d32f2f" });
      }
      clearBannerSoon();
    }
  }, [
    authUserId,
    channelId,
    clearBannerSoon,
    effectiveAdmin,
    inLiveModeRef,
    refreshOwnerModeration,
    setBanner,
    setMessages,
    text.ownerSuspendedBanner,
    text.sendFailed,
    uid,
  ]);

  const handleDelete = useCallback((messageId: string) => {
    if (ownerModerationBlocked) {
      setBanner({ text: text.ownerSuspendedBanner, color: "#8b5cf6" });
      clearBannerSoon();
      return;
    }

    const replyIds = messages.filter((message) => message.reply_to === messageId).map((message) => message.id);
    const hasReplies = replyIds.length > 0;
    if (effectiveAdmin) {
      setMessages((previous) => previous.filter((message) => message.id !== messageId && message.reply_to !== messageId));
      const deletedIds = new Set([messageId, ...replyIds]);
      setGalleryItems((previous) => previous.filter((item) => !deletedIds.has(item.id)));
      const targetMessage = messages.find((message) => message.id === messageId) || dmMessages.find((message) => message.id === messageId);
      if (targetMessage?.dm) {
        adminAction("delete-dm", inLiveMode ? `${channelId}_live` : channelId, { dm_id: messageId });
        setDmMessages((previous) => previous.filter((message) => message.id !== messageId));
      } else {
        adminAction("delete-message", inLiveMode ? `${channelId}_live` : channelId, { message_id: messageId });
      }
      return;
    }

    if (hasReplies) {
      setMessages((previous) =>
        previous.map((message) => (
          message.id === messageId
            ? { ...message, text: text.deletedMessage, image: null, deleted: true } as Message
            : message
        )),
      );
      setGalleryItems((previous) => previous.filter((item) => item.id !== messageId));
      void deleteMessage({ uid, message_id: messageId, channel_id: inLiveMode ? `${channelId}_live` : channelId, soft: true });
      return;
    }

    setMessages((previous) => previous.filter((message) => message.id !== messageId));
    setGalleryItems((previous) => previous.filter((item) => item.id !== messageId));
    void deleteMessage({ uid, message_id: messageId, channel_id: inLiveMode ? `${channelId}_live` : channelId, soft: false });
  }, [
    channelId,
    clearBannerSoon,
    dmMessages,
    effectiveAdmin,
    inLiveMode,
    messages,
    ownerModerationBlocked,
    setBanner,
    setDmMessages,
    setGalleryItems,
    setMessages,
    text.deletedMessage,
    text.ownerSuspendedBanner,
    uid,
  ]);

  const handleEditSave = useCallback(async (messageId: string, newText: string) => {
    try {
      const result = await editMessageApi({
        uid: effectiveAdmin && authUserId ? authUserId : uid,
        message_id: messageId,
        channel_id: inLiveMode ? `${channelId}_live` : channelId,
        text: newText,
        admin: effectiveAdmin && !!authUserId,
      }) as { ok?: boolean; error?: string };

      if (result?.ok) {
        setMessages((previous) => previous.map((message) => (
          message.id === messageId
            ? { ...message, text: newText, edited: true } as Message
            : message
        )));
        return;
      }

      showMutationError(result?.error);
    } catch {
      setBanner({ text: text.sendFailed, color: "#d32f2f" });
      clearBannerSoon();
    }
  }, [
    authUserId,
    channelId,
    clearBannerSoon,
    effectiveAdmin,
    inLiveMode,
    setBanner,
    setMessages,
    showMutationError,
    text.sendFailed,
    uid,
  ]);

  return {
    hasPetitioned,
    isSending,
    handleSend,
    handleKeyDown,
    handleReaction,
    handleDelete,
    handleEditSave,
  };
}
