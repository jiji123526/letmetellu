import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("room kick schema preserves existing blocks as send-only", () => {
  const migration = read("../migrations/0064_blocked_entry_mode.sql");
  assert.match(migration, /mode TEXT NOT NULL DEFAULT 'send_only'/);
  assert.match(migration, /'deny_entry'/);
});

test("kick is stored as deny-entry and broadcast separately from message blocks", () => {
  const admin = read("../src/routes/admin.ts");
  assert.match(admin, /case "block":\s*case "kick":/);
  assert.match(admin, /action === "kick" \? "deny_entry" : "send_only"/);
  assert.match(admin, /mode === "deny_entry" \? "user-kicked" : "user-blocked"/);
});

test("all authenticated room read boundaries reject denied entry", () => {
  for (const route of [
    "../src/routes/init.ts",
    "../src/routes/data.ts",
    "../src/routes/unified-timeline.ts",
    "../src/routes/dm.ts",
    "../src/routes/socket-auth.ts",
  ]) {
    assert.match(read(route), /entry_denied/, route);
  }
});

test("cached read capabilities remain bound to the denied visitor identity", () => {
  for (const route of [
    "../src/routes/init.ts",
    "../src/routes/data.ts",
    "../src/routes/unified-timeline.ts",
  ]) {
    const source = read(route);
    assert.match(source, /channelReadAccess\?\.viewer === "visitor"/, route);
    assert.match(source, /channelReadAccess\.subject/, route);
  }
});

test("client closes realtime and renders denied entry state", () => {
  const chatView = read("../../src/components/chat/ChatView.tsx");
  const realtime = read("../../src/components/chat/useChatRealtimeSync.ts");
  assert.match(chatView, /loading \|\| entryDenied \? null : channelId/);
  assert.match(chatView, /roomAccessRemovedTitle/);
  assert.match(realtime, /event\.type === "user-kicked"/);
  assert.match(realtime, /event\.type === "entry-denied"/);
  assert.match(realtime, /if \(!isOwner && kickedUid === uid\)/);
  assert.match(realtime, /event\.type === "entry-denied"[\s\S]*if \(!isOwner\)/);
});

test("message actions collapse moderation into a two-option user menu", () => {
  const menu = read("../../src/components/chat/ContextMenu.tsx");
  const actions = read("../../src/components/chat/useChatContextMenuActions.ts");
  assert.match(menu, /setShowUserManagement\(true\)/);
  assert.match(menu, /t\("userManagement"\)/);
  assert.match(menu, /t\("messageBlock"\)/);
  assert.match(menu, /t\("entryBlock"\)/);
  assert.match(menu, /disabled=\{isBlockedUser && !isEntryDeniedUser\}/);
  assert.match(menu, /disabled=\{isEntryDeniedUser\}/);
  assert.doesNotMatch(menu, />✓</);
  assert.match(actions, /entry\.mode !== "deny_entry"/);
});
