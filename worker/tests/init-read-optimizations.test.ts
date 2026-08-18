import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const initSource = readFileSync(
  new URL("../src/routes/init.ts", import.meta.url),
  "utf8",
);
const indexSource = readFileSync(
  new URL("../src/index.ts", import.meta.url),
  "utf8",
);
const channelStateSource = readFileSync(
  new URL("../src/routes/channel-state.ts", import.meta.url),
  "utf8",
);
const apiChatSource = readFileSync(
  new URL("../../src/lib/api-chat.ts", import.meta.url),
  "utf8",
);
const bootstrapSource = readFileSync(
  new URL("../../src/components/chat/useChatChannelBootstrap.ts", import.meta.url),
  "utf8",
);

test("init only reads live-channel frozen state when the live row is relevant", () => {
  assert.match(initSource, /const liveChannelFrozenIndex = isLiveChannel \? statements\.length : null/);
  assert.match(initSource, /if \(isLiveChannel\) \{\s*statements\.push\(/);
  assert.match(initSource, /const moderationRow = batchResults\[1\]\.results\?\.\[0\]/);
});

test("owner moderation refresh uses a dedicated narrow channel-state route", () => {
  const refreshOwnerModerationStart = bootstrapSource.indexOf("const refreshOwnerModeration = useCallback");
  const refreshOwnerModerationEnd = bootstrapSource.indexOf("useEffect(() => {", refreshOwnerModerationStart);
  const refreshOwnerModerationSource = bootstrapSource.slice(
    refreshOwnerModerationStart,
    refreshOwnerModerationEnd,
  );

  assert.match(indexSource, /url\.pathname\.startsWith\("\/api\/channel-state"\)/);
  assert.match(channelStateSource, /parentChannel\.owner_uid !== userId/);
  assert.match(channelStateSource, /SELECT owner_uid, is_frozen/);
  assert.match(channelStateSource, /ownerModeration: \{\s*status: moderation\.status,\s*petitionStatus: moderation\.petition_status,/);
  assert.match(apiChatSource, /fetch\(`\/api\/channel-state\?channel=/);
  assert.match(refreshOwnerModerationSource, /fetchOwnerModerationState\(fetchChannel\)/);
  assert.doesNotMatch(refreshOwnerModerationSource, /fetchInit\(fetchChannel\)/);
});
