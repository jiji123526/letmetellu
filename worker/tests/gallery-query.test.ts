import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dataRouteSource = readFileSync(
  new URL("../src/routes/data.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL("../migrations/0040_gallery_lookup_indexes.sql", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../../src/lib/api-chat.ts", import.meta.url),
  "utf8",
);
const channelActionsSource = readFileSync(
  new URL("../../src/components/chat/useChatAdminChannelActions.ts", import.meta.url),
  "utf8",
);

test("gallery paging drives ordered gallery rows into indexed visibility lookups", () => {
  const galleryCaseStart = dataRouteSource.indexOf('case "gallery"');
  const dmCaseStart = dataRouteSource.indexOf('case "dm"', galleryCaseStart);
  const galleryCase = dataRouteSource.slice(galleryCaseStart, dmCaseStart);

  assert.match(galleryCase, /FROM gallery g\s+CROSS JOIN messages m/);
  assert.match(galleryCase, /m\.gallery_id = g\.id/);
  assert.match(galleryCase, /m\.deleted = 0/);
  assert.match(galleryCase, /ORDER BY g\.created_at DESC, g\.id DESC LIMIT 50/);
  assert.doesNotMatch(galleryCase, /INNER JOIN messages/);
});

test("gallery paging uses a stable timestamp and id cursor", () => {
  assert.match(
    dataRouteSource,
    /g\.created_at < \? OR \(g\.created_at = \? AND g\.id < \?\)/,
  );
  assert.match(apiSource, /params\.set\("cursor_id", cursorId\)/);
  assert.match(
    channelActionsSource,
    /fetchGallery\(fetchChannel, oldest\.created_at, oldest\.id\)/,
  );
});

test("gallery indexes cover display order and visible message mappings", () => {
  assert.match(
    migrationSource,
    /gallery_channel_created_id_idx\s+ON gallery\(channel_id, created_at DESC, id DESC\)/,
  );
  assert.match(
    migrationSource,
    /messages_visible_gallery_lookup_idx\s+ON messages\(channel_id, gallery_id\)\s+WHERE deleted = 0 AND gallery_id IS NOT NULL/,
  );
});
