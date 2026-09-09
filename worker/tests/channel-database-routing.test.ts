import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const channelStateSource = readFileSync(
  new URL("../src/routes/channel-state.ts", import.meta.url),
  "utf8",
);

test("channel state reads through the channel database boundary", () => {
  assert.match(
    channelStateSource,
    /resolveChannelDatabase\(env, parentChannelId\)/,
  );
  assert.match(
    channelStateSource,
    /resolvedDatabase\.database\.prepare\(`\s*SELECT owner_uid, is_frozen/,
  );
  assert.match(
    channelStateSource,
    /getChannelModeration\(parentChannelId, channelEnv\)/,
  );
  assert.doesNotMatch(channelStateSource, /env\.DB\.prepare/);
});
