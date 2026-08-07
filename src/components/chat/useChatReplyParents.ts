"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { fetchReplyParents } from "@/lib/api-chat";
import type { Message } from "./chatTypes";

interface UseChatReplyParentsArgs {
  channelId: string;
  inLiveMode: boolean;
  enabled: boolean;
  messages: Message[];
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
}

interface UnavailableParentsState {
  scopeKey: string;
  ids: ReadonlySet<string>;
}

const EMPTY_PARENT_IDS: ReadonlySet<string> = new Set();
const PARENT_LOOKUP_TIMEOUT_MS = 4000;
const REPLY_PARENT_BATCH_SIZE = 20;

function compareMessages(left: Message, right: Message) {
  return (left.created_at || "").localeCompare(right.created_at || "")
    || left.id.localeCompare(right.id);
}

function mergeResolvedReplyParents(previous: Message[], parents: Message[]): Message[] {
  if (parents.length === 0) return previous;

  const next = [...previous];
  const knownMessageIds = new Set(previous.map((message) => message.id));
  const parentIdsWithVisibleReplies = new Set(
    previous
      .map((message) => message.reply_to)
      .filter((parentId): parentId is string => !!parentId),
  );
  let didChange = false;

  for (const parent of parents) {
    if (knownMessageIds.has(parent.id)) continue;
    if (!parentIdsWithVisibleReplies.has(parent.id)) continue;
    next.push(parent);
    knownMessageIds.add(parent.id);
    didChange = true;
  }

  if (!didChange) return previous;
  next.sort(compareMessages);
  return next;
}

async function fetchMissingReplyParents(channelId: string, parentIds: string[]) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const data = await Promise.race([
      fetchReplyParents(channelId, parentIds),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("reply parent lookup timed out")),
          PARENT_LOOKUP_TIMEOUT_MS,
        );
      }),
    ]);
    return {
      messages: Array.isArray(data.messages) ? data.messages as Message[] : [],
      missingIds: Array.isArray(data.missing_ids) ? data.missing_ids as string[] : [],
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function getMissingParentIds(
  messages: Message[],
  unavailableParentIds: ReadonlySet<string>,
): string[] {
  const messageIds = new Set(messages.map((message) => message.id));
  return [...new Set(
    messages
      .map((message) => message.reply_to)
      .filter((parentId): parentId is string =>
        !!parentId
        && !messageIds.has(parentId)
        && !unavailableParentIds.has(parentId)
      ),
  )];
}

export function useChatReplyParents({
  channelId,
  inLiveMode,
  enabled,
  messages,
  messagesContainerRef,
  messagesEndRef,
  setMessages,
}: UseChatReplyParentsArgs) {
  const scopeKey = `${channelId}:${inLiveMode ? "live" : "normal"}`;
  const scopeVersionRef = useRef(0);
  const pendingParentIdsRef = useRef(new Set<string>());
  const [unavailableParents, setUnavailableParents] = useState<UnavailableParentsState>({
    scopeKey,
    ids: EMPTY_PARENT_IDS,
  });
  const unavailableParentIds = unavailableParents.scopeKey === scopeKey
    ? unavailableParents.ids
    : EMPTY_PARENT_IDS;
  const missingParentIds = useMemo(
    () => getMissingParentIds(messages, unavailableParentIds),
    [messages, unavailableParentIds],
  );

  useEffect(() => {
    const pendingParentIds = pendingParentIdsRef.current;
    scopeVersionRef.current += 1;
    pendingParentIds.clear();
    return () => {
      scopeVersionRef.current += 1;
      pendingParentIds.clear();
    };
  }, [scopeKey]);

  useEffect(() => {
    if (!enabled) return;
    const scopeVersion = scopeVersionRef.current;
    const fetchChannel = inLiveMode ? `${channelId}_live` : channelId;
    const parentIdsToFetch = missingParentIds.filter((parentId) => !pendingParentIdsRef.current.has(parentId));
    if (parentIdsToFetch.length === 0) return;

    for (const parentId of parentIdsToFetch) {
      pendingParentIdsRef.current.add(parentId);
    }

    void (async () => {
      for (let index = 0; index < parentIdsToFetch.length; index += REPLY_PARENT_BATCH_SIZE) {
        const batchParentIds = parentIdsToFetch.slice(index, index + REPLY_PARENT_BATCH_SIZE);
        try {
          const { messages: parents, missingIds } = await fetchMissingReplyParents(fetchChannel, batchParentIds);
          if (scopeVersion !== scopeVersionRef.current) return;

          const container = messagesContainerRef.current;
          const shouldFollow = !!container
            && container.scrollHeight - container.scrollTop - container.clientHeight <= 120;

          if (parents.length > 0) {
            setMessages((previous) => mergeResolvedReplyParents(previous, parents));
          }

          if (missingIds.length > 0) {
            setUnavailableParents((previous) => {
              const nextIds = new Set(previous.scopeKey === scopeKey ? previous.ids : EMPTY_PARENT_IDS);
              let didChange = false;
              for (const parentId of missingIds) {
                if (nextIds.has(parentId)) continue;
                nextIds.add(parentId);
                didChange = true;
              }
              return didChange ? { scopeKey, ids: nextIds } : previous;
            });
          }

          if (shouldFollow && parents.length > 0) {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
              });
            });
          }
        } catch {
          if (scopeVersion !== scopeVersionRef.current) return;
          setUnavailableParents((previous) => {
            const nextIds = new Set(previous.scopeKey === scopeKey ? previous.ids : EMPTY_PARENT_IDS);
            let didChange = false;
            for (const parentId of batchParentIds) {
              if (nextIds.has(parentId)) continue;
              nextIds.add(parentId);
              didChange = true;
            }
            return didChange ? { scopeKey, ids: nextIds } : previous;
          });
        } finally {
          if (scopeVersion === scopeVersionRef.current) {
            for (const parentId of batchParentIds) {
              pendingParentIdsRef.current.delete(parentId);
            }
          }
        }
      }
    })();
  }, [
    channelId,
    enabled,
    inLiveMode,
    messagesContainerRef,
    messagesEndRef,
    missingParentIds,
    scopeKey,
    setMessages,
  ]);

  return {
    unavailableReplyParentIds: unavailableParentIds,
    isResolvingReplyParents: enabled && missingParentIds.length > 0,
  };
}
