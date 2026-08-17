import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const previewSource = readFileSync(new URL("../../src/lib/channel-preview.ts", import.meta.url), "utf8");
const adminProxySource = readFileSync(new URL("../../src/app/api/admin/route.ts", import.meta.url), "utf8");

test("channel preview cache is scoped and immediately invalidated after visible mutations", () => {
  assert.match(previewSource, /channelPreviewCacheTag\(channelId\)/);
  assert.match(previewSource, /revalidate: 300,[\s\S]*tags: \[channelPreviewCacheTag\(channelId\)\]/);
  assert.match(adminProxySource, /revalidateTag\(channelPreviewCacheTag\(channelId\), \{ expire: 0 \}\)/);
  assert.match(adminProxySource, /revalidatePath\(`\/ch\/\$\{channelId\}`\)/);
  assert.match(adminProxySource, /revalidatePath\(`\/ch\/\$\{channelId\}\/opengraph-image`\)/);
  assert.match(adminProxySource, /\["name", "profile_image", "bubble_color"\]/);
  assert.match(adminProxySource, /body\.action === "set-passcode"/);
});
