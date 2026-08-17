export interface ActionRuleMessage {
  is_admin: number;
  image?: string | null;
  nick?: string | null;
  text: string;
  dm?: boolean;
  protected_sender?: boolean;
  report_meta?: unknown;
  petition_meta?: unknown;
}

export function isInboxModerationMessage(message: ActionRuleMessage): boolean {
  if (message.report_meta || message.petition_meta) return true;
  if (!message.is_admin || message.image) return false;
  const nick = message.nick || "";
  if (nick === "신고함" || nick === "Reports" || nick === "이의 제기" || nick === "Appeal") {
    return true;
  }
  const text = message.text || "";
  return text.startsWith("🚨 채널 신고")
    || text.startsWith("🚨 Channel report")
    || text.startsWith("📝 채널 이의 제기")
    || text.startsWith("📝 Channel appeal");
}

export function canReplyToMessage(message: Pick<ActionRuleMessage, "dm" | "protected_sender">, effectiveAdmin: boolean): boolean {
  if (message.dm) return effectiveAdmin && !message.protected_sender;
  return !message.protected_sender;
}

export function canBlockMessage(message: Pick<ActionRuleMessage, "protected_sender">): boolean {
  return !message.protected_sender;
}
