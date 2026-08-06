const CLIENT_MESSAGE_ID_PATTERN = /^[a-zA-Z0-9:_-]{8,128}$/;

export function isValidClientMessageId(value: unknown): value is string {
  return typeof value === "string" && CLIENT_MESSAGE_ID_PATTERN.test(value);
}
