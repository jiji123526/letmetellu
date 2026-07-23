"use client";

interface ReactionBadgeProps {
  reactions: Record<string, string>; // key: "{uid}_{timestamp}" → value: emoji
  myUid: string;
  isSent: boolean;
  isReply?: boolean;
  onReaction: (emoji: string) => void;
  onEmojiPicker?: (rect: DOMRect) => void;
}

export function ReactionBadge({ reactions, myUid, isSent, isReply, onReaction, onEmojiPicker }: ReactionBadgeProps) {
  if (!reactions || Object.keys(reactions).length === 0) return null;

  // Group by emoji, count occurrences, track if current user reacted
  const counts: Record<string, { count: number; mine: boolean }> = {};
  Object.entries(reactions).forEach(([key, emoji]) => {
    if (!counts[emoji]) counts[emoji] = { count: 0, mine: false };
    counts[emoji].count++;
    if (key.startsWith(`${myUid}_`)) counts[emoji].mine = true;
  });

  const emojiOrder = Object.keys(counts).sort();

  return (
    <div
      className={`flex flex-wrap gap-1 px-1 ${isSent ? "justify-end" : "justify-start"}`}
      style={{
        marginTop: "3px",
        paddingLeft: isReply && !isSent ? "calc(var(--bubble-font-size) + 8px)" : undefined,
        paddingRight: isReply && isSent ? "calc(var(--bubble-font-size) + 8px)" : undefined,
      }}
    >
      {emojiOrder.map((emoji) => {
        const data = counts[emoji];
        return (
          <button
            key={emoji}
            className="inline-flex items-center cursor-pointer transition-colors"
            style={{
              fontSize: "calc(var(--bubble-font-size) - 4px)",
              lineHeight: 1.3,
              padding: "2px 6px",
              gap: "3px",
              borderRadius: "12px",
              border: "1px solid",
              background: data.mine
                ? "color-mix(in srgb, var(--bubble-sent, #3b8df0) 10%, transparent)"
                : "var(--gray-bubble)",
              borderColor: data.mine
                ? "var(--bubble-sent, #3b8df0)"
                : "var(--hairline)",
            }}
            onClick={(e) => {
              e.stopPropagation();
              onReaction(emoji);
            }}
          >
            <span>{emoji}</span>
            <span
              className="font-normal"
              style={{
                fontSize: "calc(var(--bubble-font-size) - 5px)",
                color: data.mine ? "var(--bubble-sent, #3b8df0)" : "var(--meta)",
              }}
            >
              {data.count}
            </span>
          </button>
        );
      })}
      <button
        className="inline-flex items-center justify-center cursor-pointer"
        style={{
          fontSize: "calc(var(--bubble-font-size) - 5px)",
          padding: "2px 8px",
          borderRadius: "12px",
          border: "1px dashed var(--hairline)",
          minHeight: "22px",
          minWidth: "30px",
          background: "var(--gray-bubble)",
          color: "var(--meta)",
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (onEmojiPicker) onEmojiPicker(e.currentTarget.getBoundingClientRect());
        }}
      >
        +
      </button>
    </div>
  );
}
