import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync(
  new URL("../migrations/0058_channel_retention_choices.sql", import.meta.url),
  "utf8",
);
const lockSource = readFileSync(
  new URL("../src/lib/channel-plan-locks.ts", import.meta.url),
  "utf8",
);
const billingSource = readFileSync(
  new URL("../src/routes/billing.ts", import.meta.url),
  "utf8",
);
const renewalSource = readFileSync(
  new URL("../src/lib/billing-renewals.ts", import.meta.url),
  "utf8",
);
const initSource = readFileSync(
  new URL("../src/routes/init.ts", import.meta.url),
  "utf8",
);
const userSource = readFileSync(
  new URL("../src/routes/user.ts", import.meta.url),
  "utf8",
);
const adminSource = readFileSync(
  new URL("../src/routes/admin.ts", import.meta.url),
  "utf8",
);
const messageSource = readFileSync(
  new URL("../src/routes/messages.ts", import.meta.url),
  "utf8",
);
const dmSource = readFileSync(
  new URL("../src/routes/dm.ts", import.meta.url),
  "utf8",
);
const uploadSource = readFileSync(
  new URL("../src/routes/upload.ts", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../../src/app/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const composerSource = readFileSync(
  new URL("../../src/components/chat/ChatViewBottomShell.tsx", import.meta.url),
  "utf8",
);

test("channel retention choices are owner-scoped and preserve referential integrity", () => {
  assert.match(migrationSource, /user_id TEXT PRIMARY KEY REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(migrationSource, /retained_channel_id TEXT NOT NULL REFERENCES channels\(id\) ON DELETE CASCADE/);
  assert.match(migrationSource, /user_channel_retention_choices_channel_idx/);
  assert.match(lockSource, /channels\.owner_uid = choices\.user_id/);
  assert.match(lockSource, /channels\.owner_uid = \?/);
  assert.match(lockSource, /channel_not_owned/);
});

test("plan locking is derived from current entitlement, channel count, and retained choice", () => {
  assert.match(lockSource, /FROM user_entitlements/);
  assert.match(lockSource, /ends_at IS NULL OR ends_at > \?/);
  assert.match(lockSource, /owned_channel_count/);
  assert.match(lockSource, /Number\(row\.owned_channel_count\) > 1/);
  assert.match(lockSource, /row\.retained_channel_id !== channelId/);
  assert.match(lockSource, /isReportsChannel\(channelId, env\)/);
});

test("cancellation and terminal renewal failure create a default retention choice", () => {
  assert.match(billingSource, /ensureDefaultChannelRetentionChoice/);
  assert.match(billingSource, /\/api\/billing\/channel-retention/);
  assert.match(renewalSource, /BILLING_RENEWAL_MAX_FAILURES/);
  assert.match(renewalSource, /SET auto_renews = 0/);
  assert.match(renewalSource, /ensureDefaultChannelRetentionChoice/);
});

test("persistent channel mutations reject locked plans while deletion and live ending remain available", () => {
  for (const source of [messageSource, dmSource, uploadSource, adminSource]) {
    assert.match(source, /channel_plan_locked/);
    assert.match(source, /readChannelPlanLockState/);
  }
  assert.match(adminSource, /action !== "delete-channel"/);
  assert.match(adminSource, /action !== "end-live"/);
});

test("reads expose lock state and the client presents selection and read-only UX", () => {
  assert.match(initSource, /safeChannel\.plan_locked = channelPlanLock\.locked/);
  assert.match(userSource, /plan_locked: planLocked/);
  assert.match(userSource, /channelRetention:/);
  assert.match(dashboardSource, /selectBillingRetentionChannel/);
  assert.match(dashboardSource, /dashboardRetentionWillLock/);
  assert.match(composerSource, /planLockedBannerLabel/);
  assert.match(composerSource, /inputDisabled = .*planLocked/);
});
