import assert from "node:assert/strict";
import test from "node:test";
import {
  MESSAGE_SEND_ATTEMPT_MAX_AGE_MS,
  hashMessageSendSignature,
  parseStoredMessageSendAttempt,
} from "../../src/lib/message-send-attempt.ts";

test("pending send signatures do not expose message text and remain deterministic", () => {
  const first = hashMessageSendSignature(JSON.stringify(["channel", false, "private text"]));
  const second = hashMessageSendSignature(JSON.stringify(["channel", false, "private text"]));
  assert.equal(first, second);
  assert.equal(first.includes("private text"), false);
});

test("pending send attempts survive remounts only for the same recent submission", () => {
  const now = Date.now();
  const signature = hashMessageSendSignature("submission");
  const attempt = {
    signature,
    id: "71c2511a-9790-448d-87ca-3a364472bc96",
    savedAt: now,
  };
  const raw = JSON.stringify(attempt);

  assert.deepEqual(parseStoredMessageSendAttempt(raw, signature, now), attempt);
  assert.equal(parseStoredMessageSendAttempt(raw, hashMessageSendSignature("other"), now), null);
  assert.equal(
    parseStoredMessageSendAttempt(raw, signature, now + MESSAGE_SEND_ATTEMPT_MAX_AGE_MS + 1),
    null,
  );
});
