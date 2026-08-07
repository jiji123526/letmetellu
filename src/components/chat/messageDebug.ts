"use client";

import type { Message } from "./chatTypes";

declare global {
  interface Window {
    __YAP_DEBUG_MESSAGE_ID?: string;
  }
}

export const DEBUG_MESSAGE_STORAGE_KEY = "__yap_debug_message_id";
export const DEBUG_MESSAGE_QUERY_PARAM = "debug_message_id";

const lastTraceSignatureByStage = new Map<string, string>();

function readNonEmptyValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, candidate) => {
      if (candidate instanceof Set) return [...candidate];
      if (candidate instanceof Map) return Object.fromEntries(candidate);
      return candidate;
    }) || "null";
  } catch {
    return String(value);
  }
}

export function getConfiguredDebugMessageId(): string | null {
  if (typeof window === "undefined") return null;

  const globalValue = readNonEmptyValue(window.__YAP_DEBUG_MESSAGE_ID);
  if (globalValue) return globalValue;

  try {
    const queryValue = readNonEmptyValue(
      new URLSearchParams(window.location.search).get(DEBUG_MESSAGE_QUERY_PARAM),
    );
    if (queryValue) return queryValue;
  } catch {
    // Ignore malformed URLs and continue to the next source.
  }

  try {
    return readNonEmptyValue(localStorage.getItem(DEBUG_MESSAGE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function isConfiguredDebugMessage(messageId: string | null | undefined): boolean {
  const targetId = getConfiguredDebugMessageId();
  return Boolean(targetId && messageId === targetId);
}

export function summarizeMessageForTrace(message: Message | null | undefined) {
  if (!message) return null;
  return {
    id: message.id,
    reply_to: message.reply_to,
    created_at: message.created_at,
    is_admin: !!message.is_admin,
    deleted: !!message.deleted,
    uid: message.uid,
    auth_uid: message.auth_uid,
    protected_sender: !!message.protected_sender,
    report: !!message.report,
    dm: !!message.dm,
    text_preview: message.text.length > 160
      ? `${message.text.slice(0, 160)}...`
      : message.text,
  };
}

export function traceConfiguredMessage(stage: string, payload: Record<string, unknown>) {
  const targetId = getConfiguredDebugMessageId();
  if (!targetId || typeof window === "undefined") return;

  const entry = {
    targetId,
    stage,
    ...payload,
  };
  const signature = safeSerialize(entry);
  const stageKey = `${targetId}:${stage}`;
  if (lastTraceSignatureByStage.get(stageKey) === signature) return;
  lastTraceSignatureByStage.set(stageKey, signature);

  console.info(`[message-trace:${stage}]`, entry);
}
