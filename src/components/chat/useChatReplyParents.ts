"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { fetchMessageContext } from "@/lib/api-chat";
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

async function fetchReplyParent(channelId: string, parentId: string): Promise<Message> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const data = await Promise.race([
      fetchMessageContext(channelId, parentId),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("reply parent lookup timed out")),
          PARENT_LOOKUP_TIMEOUT_MS,
        );
      }),
    ]);
    const parent = data.messages?.find((message: Message) => message.id === parentId) as Message | undefined;
    if (!parent) throw new Error("reply parent unavailable");
    return parent;
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

    for (const parentId of missingParentIds) {
      if (pendingParentIdsRef.current.has(parentId)) continue;
      pendingParentIdsRef.current.add(parentId);

      void fetchReplyParent(fetchChannel, parentId)
        .then((parent) => {
          if (scopeVersion !== scopeVersionRef.current) return;

          const container = messagesContainerRef.current;
          const shouldFollow = !!container
            && container.scrollHeight - container.scrollTop - container.clientHeight <= 120;

          setMessages((previous) => {
            if (previous.some((message) => message.id === parentId)) return previous;
            if (!previous.some((message) => message.reply_to === parentId)) return previous;
            return [...previous, parent].sort((left, right) => {
              const timeDifference = (left.created_at || "").localeCompare(right.created_at || "");
              return timeDifference || left.id.localeCompare(right.id);
            });
          });

          if (shouldFollow) {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
              });
            });
          }
        })
        .catch(() => {
          if (scopeVersion !== scopeVersionRef.current) return;
          setUnavailableParents((previous) => {
            const nextIds = new Set(previous.scopeKey === scopeKey ? previous.ids : EMPTY_PARENT_IDS);
            if (nextIds.has(parentId)) return previous;
            nextIds.add(parentId);
            return { scopeKey, ids: nextIds };
          });
        })
        .finally(() => {
          if (scopeVersion === scopeVersionRef.current) {
            pendingParentIdsRef.current.delete(parentId);
          }
        });
    }
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
