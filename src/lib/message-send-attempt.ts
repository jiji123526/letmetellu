export const MESSAGE_SEND_ATTEMPT_MAX_AGE_MS = 30 * 60 * 1000;

export interface StoredMessageSendAttempt {
  signature: string;
  id: string;
  savedAt: number;
}

export function hashMessageSendSignature(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

export function parseStoredMessageSendAttempt(
  rawValue: string | null,
  expectedSignature: string,
  now = Date.now(),
): StoredMessageSendAttempt | null {
  if (!rawValue) return null;
  try {
    const value = JSON.parse(rawValue) as Partial<StoredMessageSendAttempt>;
    if (
      value.signature !== expectedSignature
      || typeof value.id !== "string"
      || !/^[0-9a-f-]{36}$/i.test(value.id)
      || !Number.isFinite(value.savedAt)
      || now - Number(value.savedAt) > MESSAGE_SEND_ATTEMPT_MAX_AGE_MS
    ) {
      return null;
    }
    return {
      signature: value.signature,
      id: value.id,
      savedAt: Number(value.savedAt),
    };
  } catch {
    return null;
  }
}
