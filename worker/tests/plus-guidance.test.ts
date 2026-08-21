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
const settingsPanelSource = readFileSync(
  new URL("../../src/components/chat/SettingsPanel.tsx", import.meta.url),
  "utf8",
);
const chatBootstrapSource = readFileSync(
  new URL("../../src/components/chat/useChatChannelBootstrap.ts", import.meta.url),
  "utf8",
);
const initRouteSource = readFileSync(
  new URL("../src/routes/init.ts", import.meta.url),
  "utf8",
);
const recentChannelsRouteSource = readFileSync(
  new URL("../src/routes/recent-channels.ts", import.meta.url),
  "utf8",
);
const koreanLocaleSource = readFileSync(
  new URL("../../src/lib/locales/ko.ts", import.meta.url),
  "utf8",
);
const monetizationPlanSource = readFileSync(
  new URL("../../MONETIZATION_PLAN.md", import.meta.url),
  "utf8",
);
const monetizationLogSource = readFileSync(
  new URL("../../MONETIZATION_LOG.md", import.meta.url),
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

test("personal bubble colors require the viewer's Plus entitlement", () => {
  assert.match(initRouteSource, /viewerPlusEntitlement[\s\S]*viewerPlan:[\s\S]*personalBubbleColor/);
  assert.match(
    recentChannelsRouteSource,
    /body\.action === "color"[\s\S]*viewerHasPlus\(\)[\s\S]*plus_required[\s\S]*UPDATE user_recent_channels/,
  );
  assert.match(recentChannelsRouteSource, /personal_bubble_color: hasPlus \? channel\.personal_bubble_color : null/);
  assert.match(recentChannelsRouteSource, /hasPlus \? validColor\(channel\.bubbleColor\) : null/);
  assert.match(chatBootstrapSource, /if \(!input\.personalBubbleColorEnabled\)[\s\S]*setLocalBubbleColor\(null\)/);
  assert.match(chatBootstrapSource, /data\.viewerPlan\?\.features\.personalBubbleColor !== true\) return/);
});

test("personal bubble color controls remain visible but disabled without Plus", () => {
  assert.match(settingsPanelSource, /t\("bubbleColor"\)[\s\S]*t\("plusBadge"\)/);
  assert.match(settingsPanelSource, /disabled=\{!personalBubbleColorEnabled\}/);
  assert.match(settingsPanelSource, /if \(!personalBubbleColorEnabled\) return/);
});

test("Korean user-facing values preserve Plus branding without other untranslated plan terminology", () => {
  assert.match(koreanLocaleSource, /plusBadge: "Plus"/);
  assert.doesNotMatch(koreanLocaleSource, /플러스/);
  for (const term of ["Free", "quota", "live", "freeze", "DM", "Google", "MB", "letsplay"]) {
    const valuePattern = new RegExp(`:\\s*"[^"\\n]*${term}[^"\\n]*"`);
    assert.doesNotMatch(koreanLocaleSource, valuePattern);
  }
});

test("monetization history is kept in a newest-first branch log", () => {
  assert.doesNotMatch(monetizationPlanSource, /^## Progress log$/m);
  assert.match(monetizationPlanSource, /MONETIZATION_LOG\.md/);
  assert.match(monetizationLogSource, /newest entry is always first/);
  assert.match(monetizationLogSource, /^## Latest changes$/m);
});
