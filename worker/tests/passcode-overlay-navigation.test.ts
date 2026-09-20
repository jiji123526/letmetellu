import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const overlaySource = readFileSync(
  new URL("../../src/components/chat/PasscodeOverlay.tsx", import.meta.url),
  "utf8",
);
const koreanLocale = readFileSync(
  new URL("../../src/lib/locales/ko.ts", import.meta.url),
  "utf8",
);
const englishLocale = readFileSync(
  new URL("../../src/lib/locales/en.ts", import.meta.url),
  "utf8",
);

test("the passcode gate provides a localized dashboard exit", () => {
  assert.match(overlaySource, /<Link[\s\S]*href="\/dashboard"[\s\S]*replace/);
  assert.match(overlaySource, /t\("passcodeBackToDashboard"\)/);
  assert.match(koreanLocale, /passcodeBackToDashboard: "대시보드로 돌아가기"/);
  assert.match(englishLocale, /passcodeBackToDashboard: "Back to dashboard"/);
});
