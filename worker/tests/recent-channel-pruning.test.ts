import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const recentChannelsSource = readFileSync(
  new URL("../src/routes/recent-channels.ts", import.meta.url),
  "utf8",
);

test("recent-channel pruning probes for row 101 before deleting", () => {
  assert.match(
    recentChannelsSource,
    /async function pruneRecentChannelsIfNeeded[\s\S]*ORDER BY pinned DESC, last_visited_at DESC, channel_id DESC[\s\S]*LIMIT 1 OFFSET \?[\s\S]*if \(!overflow\) return;[\s\S]*DELETE FROM user_recent_channels/,
  );
});

test("existing visit and color rows update without pruning", () => {
  assert.match(
    recentChannelsSource,
    /body\.action === "visit"[\s\S]*UPDATE user_recent_channels[\s\S]*if \(!updated\.meta\.changes\) \{[\s\S]*INSERT INTO user_recent_channels[\s\S]*pruneRecentChannelsIfNeeded/,
  );
  assert.match(
    recentChannelsSource,
    /body\.action === "color"[\s\S]*UPDATE user_recent_channels[\s\S]*if \(!updated\.meta\.changes\) \{[\s\S]*INSERT INTO user_recent_channels[\s\S]*pruneRecentChannelsIfNeeded/,
  );
});

test("pin changes cannot grow recent history and do not prune", () => {
  const pinBranch = recentChannelsSource.match(
    /body\.action === "pin"([\s\S]*?)body\.action === "color"/,
  )?.[1] || "";
  assert.match(pinBranch, /UPDATE user_recent_channels SET pinned/);
  assert.doesNotMatch(pinBranch, /pruneRecentChannels/);
});

test("merge checks whether it can add rows before probing overflow", () => {
  assert.match(
    recentChannelsSource,
    /LEFT JOIN user_recent_channels r[\s\S]*r\.user_id = \?[\s\S]*const mayAddRows = results\.some[\s\S]*if \(mayAddRows\) \{[\s\S]*pruneRecentChannelsIfNeeded/,
  );
});
