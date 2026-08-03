"use client";

import { useCallback, useState, type ChangeEvent, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Message } from "./chatTypes";

export interface PendingPhoto {
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
}

export interface EditingMessageDraft {
  id: string;
  text: string;
}

interface UseChatComposerStateArgs {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  processPhotoFile: (file: File) => Promise<PendingPhoto>;
}

interface ConsumedComposerState {
  photos: PendingPhoto[];
  replyToId?: string;
}

interface UseChatComposerStateResult {
  input: string;
  replyingTo: Message | null;
  editingMsg: EditingMessageDraft | null;
  pendingPhotos: PendingPhoto[];
  setInput: Dispatch<SetStateAction<string>>;
  setReplyingTo: Dispatch<SetStateAction<Message | null>>;
  setPendingPhotos: Dispatch<SetStateAction<PendingPhoto[]>>;
  handleInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  resetInput: () => void;
  restoreInput: (value: string) => void;
  focusTextarea: () => void;
  clearReplyingTo: () => void;
  openEditDialog: (message: Message) => void;
  closeEditDialog: () => void;
  handlePhotoSelect: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  removePendingPhoto: (index: number) => void;
  consumeComposerState: () => ConsumedComposerState;
}

export function useChatComposerState({
  textareaRef,
  processPhotoFile,
}: UseChatComposerStateArgs): UseChatComposerStateResult {
  const [input, setInput] = useState("");
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMsg, setEditingMsg] = useState<EditingMessageDraft | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);

  const resetTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [textareaRef]);

  const resizeTextarea = useCallback((element: HTMLTextAreaElement) => {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 80)}px`;
  }, []);

  const handleInputChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    resizeTextarea(event.target);
  }, [resizeTextarea]);

  const resetInput = useCallback(() => {
    setInput("");
    resetTextareaHeight();
  }, [resetTextareaHeight]);

  const restoreInput = useCallback((value: string) => {
    setInput(value);
    resetTextareaHeight();
  }, [resetTextareaHeight]);

  const focusTextarea = useCallback(() => {
    textareaRef.current?.focus();
  }, [textareaRef]);

  const clearReplyingTo = useCallback(() => {
    setReplyingTo(null);
  }, []);

  const openEditDialog = useCallback((message: Message) => {
    setEditingMsg({ id: message.id, text: message.text });
  }, []);

  const closeEditDialog = useCallback(() => {
    setEditingMsg(null);
  }, []);

  const handlePhotoSelect = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const nextPhotos: PendingPhoto[] = [];
    for (const file of Array.from(files)) {
      nextPhotos.push(await processPhotoFile(file));
    }

    setPendingPhotos((previous) => [...previous, ...nextPhotos]);
    event.target.value = "";
    focusTextarea();
  }, [focusTextarea, processPhotoFile]);

  const removePendingPhoto = useCallback((index: number) => {
    setPendingPhotos((previous) => {
      const next = [...previous];
      URL.revokeObjectURL(next[index].previewUrl);
      next.splice(index, 1);
      return next;
    });
  }, []);

  const consumeComposerState = useCallback(() => {
    const nextState = {
      photos: [...pendingPhotos],
      replyToId: replyingTo?.id,
    };
    setPendingPhotos([]);
    setReplyingTo(null);
    return nextState;
  }, [pendingPhotos, replyingTo]);

  return {
    input,
    replyingTo,
    editingMsg,
    pendingPhotos,
    setInput,
    setReplyingTo,
    setPendingPhotos,
    handleInputChange,
    resetInput,
    restoreInput,
    focusTextarea,
    clearReplyingTo,
    openEditDialog,
    closeEditDialog,
    handlePhotoSelect,
    removePendingPhoto,
    consumeComposerState,
  };
}
