"use client";

import { useCallback, useRef, useState, type ChangeEvent, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Message } from "./chatTypes";

export const SUPPORTED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

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

export interface AddPhotoFilesOptions {
  maxFiles?: number;
}

export interface AddPhotoFilesResult {
  added: number;
  unsupported: number;
  tooLarge: number;
  failed: number;
  limitReached: boolean;
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
  addPhotoFiles: (
    files: Iterable<File>,
    options?: AddPhotoFilesOptions,
  ) => Promise<AddPhotoFilesResult>;
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
  const [pendingPhotosState, setPendingPhotosState] = useState<PendingPhoto[]>([]);
  const pendingPhotosRef = useRef<PendingPhoto[]>([]);
  const ingestionQueueRef = useRef(Promise.resolve());

  const setPendingPhotos = useCallback<Dispatch<SetStateAction<PendingPhoto[]>>>((value) => {
    const next = typeof value === "function"
      ? value(pendingPhotosRef.current)
      : value;
    pendingPhotosRef.current = next;
    setPendingPhotosState(next);
  }, []);

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

  const addPhotoFiles = useCallback((
    files: Iterable<File>,
    options: AddPhotoFilesOptions = {},
  ): Promise<AddPhotoFilesResult> => {
    const selectedFiles = Array.from(files);
    const run = async (): Promise<AddPhotoFilesResult> => {
      const result: AddPhotoFilesResult = {
        added: 0,
        unsupported: 0,
        tooLarge: 0,
        failed: 0,
        limitReached: false,
      };
      const maxFiles = options.maxFiles ?? Number.POSITIVE_INFINITY;
      let availableSlots = Math.max(0, maxFiles - pendingPhotosRef.current.length);
      const nextPhotos: PendingPhoto[] = [];

      for (const file of selectedFiles) {
        if (!SUPPORTED_PHOTO_TYPES.has(file.type)) {
          result.unsupported += 1;
          continue;
        }
        if (availableSlots === 0) {
          result.limitReached = true;
          continue;
        }

        try {
          const photo = await processPhotoFile(file);
          if (photo.blob.size > MAX_PHOTO_BYTES) {
            URL.revokeObjectURL(photo.previewUrl);
            result.tooLarge += 1;
            continue;
          }
          nextPhotos.push(photo);
          availableSlots -= 1;
        } catch {
          result.failed += 1;
        }
      }

      if (nextPhotos.length > 0) {
        setPendingPhotos((previous) => [...previous, ...nextPhotos]);
        result.added = nextPhotos.length;
        focusTextarea();
      }
      return result;
    };

    const queued = ingestionQueueRef.current.then(run, run);
    ingestionQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, [focusTextarea, processPhotoFile, setPendingPhotos]);

  const removePendingPhoto = useCallback((index: number) => {
    setPendingPhotos((previous) => {
      const next = [...previous];
      URL.revokeObjectURL(next[index].previewUrl);
      next.splice(index, 1);
      return next;
    });
  }, [setPendingPhotos]);

  const consumeComposerState = useCallback(() => {
    const nextState = {
      photos: [...pendingPhotosState],
      replyToId: replyingTo?.id,
    };
    setPendingPhotos([]);
    setReplyingTo(null);
    return nextState;
  }, [pendingPhotosState, replyingTo, setPendingPhotos]);

  return {
    input,
    replyingTo,
    editingMsg,
    pendingPhotos: pendingPhotosState,
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
    addPhotoFiles,
    removePendingPhoto,
    consumeComposerState,
  };
}
