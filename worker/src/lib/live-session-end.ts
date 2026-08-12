export type LiveSessionEndDisposition = "end" | "already_ended" | "session_changed";

export function getLiveSessionEndDisposition(
  currentSessionId: string | null,
  expectedSessionId: string,
): LiveSessionEndDisposition {
  if (!currentSessionId) return "already_ended";
  return currentSessionId === expectedSessionId ? "end" : "session_changed";
}
