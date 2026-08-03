"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Message } from "./chatTypes";

interface ContextMenuState {
  msg: Message;
  isSent: boolean;
  isOwn: boolean;
  rect: DOMRect;
  bubbleEl: HTMLElement;
}

interface FullViewImageState {
  src: string;
  caption?: string;
  date?: string;
  msgId?: string;
  fromGallery?: boolean;
}

interface ExpandedPostState {
  text: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

interface EmojiPickerState {
  msgId: string;
  rect: DOMRect;
}

interface UseChatInteractionsArgs {
  effectiveAdmin: boolean;
  uid: string;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
}

interface UseChatInteractionsResult {
  contextMenu: ContextMenuState | null;
  fullViewImage: FullViewImageState | null;
  expandedPost: ExpandedPostState | null;
  emojiPicker: EmojiPickerState | null;
  openExpandedPost: (text: string) => void;
  closeExpandedPost: () => void;
  openContextMenu: (message: Message, isSent: boolean, element: HTMLElement) => void;
  closeContextMenu: () => void;
  handleTouchStart: (message: Message, isSent: boolean, element: HTMLElement) => void;
  handleTouchEnd: () => void;
  openMessageImage: (message: Message) => void;
  openGalleryImage: (src: string, meta: { id: string; created_at: string }, caption?: string) => void;
  closeFullViewImage: () => void;
  openEmojiPicker: (messageId: string, rect: DOMRect) => void;
  closeEmojiPicker: () => void;
}

export function useChatInteractions({
  effectiveAdmin,
  uid,
  messagesContainerRef,
}: UseChatInteractionsArgs): UseChatInteractionsResult {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [fullViewImage, setFullViewImage] = useState<FullViewImageState | null>(null);
  const [expandedPost, setExpandedPost] = useState<ExpandedPostState | null>(null);
  const [emojiPicker, setEmojiPicker] = useState<EmojiPickerState | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLongPressTimer = useCallback(() => {
    if (!longPressTimerRef.current) return;
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }, []);

  useEffect(() => clearLongPressTimer, [clearLongPressTimer]);

  const openExpandedPost = useCallback((text: string) => {
    const rect = messagesContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setExpandedPost({
      text,
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    });
  }, [messagesContainerRef]);

  const closeExpandedPost = useCallback(() => {
    setExpandedPost(null);
  }, []);

  const openContextMenu = useCallback((message: Message, isSent: boolean, element: HTMLElement) => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const rect = element.getBoundingClientRect();
    const isOwn = effectiveAdmin ? !!message.is_admin : message.uid === uid;
    setContextMenu({
      msg: message,
      isSent,
      isOwn,
      rect,
      bubbleEl: element,
    });
  }, [effectiveAdmin, uid]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleTouchStart = useCallback((message: Message, isSent: boolean, element: HTMLElement) => {
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      openContextMenu(message, isSent, element);
    }, 500);
  }, [clearLongPressTimer, openContextMenu]);

  const handleTouchEnd = useCallback(() => {
    clearLongPressTimer();
  }, [clearLongPressTimer]);

  const openMessageImage = useCallback((message: Message) => {
    if (!message.image) return;
    setFullViewImage({
      src: message.image,
      caption: message.text || undefined,
      date: message.created_at,
      msgId: message.id,
    });
  }, []);

  const openGalleryImage = useCallback((src: string, meta: { id: string; created_at: string }, caption?: string) => {
    setFullViewImage({
      src,
      caption,
      date: meta.created_at,
      msgId: meta.id,
      fromGallery: true,
    });
  }, []);

  const closeFullViewImage = useCallback(() => {
    setFullViewImage(null);
  }, []);

  const openEmojiPicker = useCallback((messageId: string, rect: DOMRect) => {
    setEmojiPicker({ msgId: messageId, rect });
  }, []);

  const closeEmojiPicker = useCallback(() => {
    setEmojiPicker(null);
  }, []);

  return {
    contextMenu,
    fullViewImage,
    expandedPost,
    emojiPicker,
    openExpandedPost,
    closeExpandedPost,
    openContextMenu,
    closeContextMenu,
    handleTouchStart,
    handleTouchEnd,
    openMessageImage,
    openGalleryImage,
    closeFullViewImage,
    openEmojiPicker,
    closeEmojiPicker,
  };
}
