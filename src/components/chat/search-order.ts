export interface SearchOrderMessage {
  id: string;
  created_at?: string;
  reply_to?: string | null;
  visual_root_created_at?: string;
  visual_root_id?: string;
  visual_depth?: number;
}

export function addSearchVisualOrder<T extends SearchOrderMessage>(messages: T[]): T[] {
  const byId = new Map(messages.map((message) => [message.id, message]));

  return messages.map((message) => {
    if (
      message.visual_root_created_at
      && message.visual_root_id
      && Number.isInteger(message.visual_depth)
    ) {
      return message;
    }

    let root = message;
    let parentId = message.reply_to;
    const visited = new Set<string>([message.id]);
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      root = parent;
      parentId = parent.reply_to;
    }

    return {
      ...message,
      visual_root_created_at: root.created_at || message.created_at || "",
      visual_root_id: root.id,
      visual_depth: message.reply_to ? 1 : 0,
    };
  });
}

export function compareSearchVisualOrder(
  left: SearchOrderMessage,
  right: SearchOrderMessage,
): number {
  const rootTimeOrder = (left.visual_root_created_at || left.created_at || "")
    .localeCompare(right.visual_root_created_at || right.created_at || "");
  if (rootTimeOrder) return rootTimeOrder;

  const rootIdOrder = (left.visual_root_id || left.id).localeCompare(
    right.visual_root_id || right.id,
  );
  if (rootIdOrder) return rootIdOrder;

  const depthOrder = (left.visual_depth || 0) - (right.visual_depth || 0);
  if (depthOrder) return depthOrder;

  const messageTimeOrder = (left.created_at || "").localeCompare(right.created_at || "");
  return messageTimeOrder || left.id.localeCompare(right.id);
}

export function sortSearchMessagesByVisualOrder<T extends SearchOrderMessage>(
  messages: T[],
): T[] {
  return [...messages].sort(compareSearchVisualOrder);
}
