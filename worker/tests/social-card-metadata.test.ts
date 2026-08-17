import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layout = readFileSync(new URL("../../src/app/layout.tsx", import.meta.url), "utf8");
const robots = readFileSync(new URL("../../src/app/robots.ts", import.meta.url), "utf8");
const rootCard = readFileSync(new URL("../../src/app/opengraph-image.tsx", import.meta.url), "utf8");
const channelPage = readFileSync(new URL("../../src/app/ch/[slug]/page.tsx", import.meta.url), "utf8");

test("root metadata publishes a large branded social card", () => {
  assert.match(layout, /metadataBase: new URL\(APP_ORIGIN\)/);
  assert.match(layout, /card: "summary_large_image"/);
  assert.match(layout, /url: "\/opengraph-image"/);
  assert.match(rootCard, /width: 1200, height: 630/);
  assert.match(rootCard, /yap\./);
  assert.match(rootCard, /#3598fe/);
});

test("Twitterbot can crawl channel metadata while generic crawlers cannot index channels", () => {
  assert.match(robots, /userAgent: "Twitterbot"[\s\S]*allow: \["\/", "\/ch\/"/);
  assert.match(robots, /userAgent: "\*"[\s\S]*disallow: \["\/ch\/"/);
  assert.match(channelPage, /card: "summary_large_image"/);
  assert.match(channelPage, /opengraph-image/);
});
