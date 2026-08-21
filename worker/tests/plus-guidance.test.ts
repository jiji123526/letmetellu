import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const onboardingSource = readFileSync(
  new URL("../../src/components/dashboard/FirstChannelOnboarding.tsx", import.meta.url),
  "utf8",
);
const adminGuideSource = readFileSync(
  new URL("../../src/components/admin/AdminGuideContent.tsx", import.meta.url),
  "utf8",
);
const userGuideSource = readFileSync(
  new URL("../../src/components/chat/UserGuidePanel.tsx", import.meta.url),
  "utf8",
);
const billingSuccessSource = readFileSync(
  new URL("../../src/app/billing/callback/toss/success/page.tsx", import.meta.url),
  "utf8",
);
const koreanLocaleSource = readFileSync(
  new URL("../../src/lib/locales/ko.ts", import.meta.url),
  "utf8",
);

test("owner onboarding and admin guide label paid-only controls", () => {
  for (const key of [
    "firstGuideColorTitle",
    "firstGuideBackgroundTitle",
    "firstGuideFreezeTitle",
    "firstGuideLiveTitle",
  ]) {
    assert.match(onboardingSource, new RegExp(`${key}[^\\n]+premium: true`));
  }
  for (const key of ["guideColor", "guideBackground", "guideFreeze", "guideLive"]) {
    assert.match(adminGuideSource, new RegExp(`${key}[^\\n]+premium: true`));
  }
});

test("general user guide explains image limits and signed-in plus bypass", () => {
  assert.match(userGuideSource, /userGuideImagesTitle/);
  assert.match(userGuideSource, /userGuideImageQuota/);
  assert.match(koreanLocaleSource, /무료 이용자는 하루 5장까지/);
  assert.match(koreanLocaleSource, /하루 전송 횟수 제한이 적용되지 않아요/);
});

test("successful checkout offers the activation card actions", () => {
  assert.match(billingSuccessSource, /billingSuccessFeatureChannels/);
  assert.match(billingSuccessSource, /billingSuccessCreateChannel/);
  assert.match(billingSuccessSource, /billingSuccessOpenAdminGuide/);
  assert.match(billingSuccessSource, /AdminGuidePanel/);
});

test("Korean user-facing values avoid untranslated plan terminology", () => {
  for (const term of ["Plus", "Free", "quota", "live", "freeze", "DM", "Google", "MB", "letsplay"]) {
    const valuePattern = new RegExp(`:\\s*"[^"\\n]*${term}[^"\\n]*"`);
    assert.doesNotMatch(koreanLocaleSource, valuePattern);
  }
});
