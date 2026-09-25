import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const passcodeRouteSource = readFileSync(
  new URL("../src/routes/passcode.ts", import.meta.url),
  "utf8",
);
const passcodeOverlaySource = readFileSync(
  new URL("../../src/components/chat/PasscodeOverlay.tsx", import.meta.url),
  "utf8",
);
const englishLocaleSource = readFileSync(
  new URL("../../src/lib/locales/en.ts", import.meta.url),
  "utf8",
);
const koreanLocaleSource = readFileSync(
  new URL("../../src/lib/locales/ko.ts", import.meta.url),
  "utf8",
);

test("passcode verification allows ten requests per minute", () => {
  assert.match(passcodeRouteSource, /PASSCODE_VERIFY_LIMIT = 10/);
  assert.match(passcodeRouteSource, /PASSCODE_VERIFY_WINDOW_MS = 60_000/);
});

test("passcode lockouts use a distinct localized UI message", () => {
  assert.match(
    passcodeOverlaySource,
    /result\.error === "too_many_attempts"[\s\S]*t\("tooManyPasscodeAttempts"\)/,
  );
  assert.match(
    englishLocaleSource,
    /tooManyPasscodeAttempts: "Too many attempts\. Wait for a bit\."/,
  );
  assert.match(koreanLocaleSource, /tooManyPasscodeAttempts:/);
});
