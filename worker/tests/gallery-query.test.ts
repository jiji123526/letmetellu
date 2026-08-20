import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dataRouteSource = readFileSync(
  new URL("../src/routes/data.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL("../migrations/0052_gallery_message_consistency.sql", import.meta.url),
  "utf8",
);
const canonicalMessageMigrationSource = readFileSync(
  new URL("../migrations/0053_gallery_canonical_message_id.sql", import.meta.url),
  "utf8",
);
const messagesSource = readFileSync(
  new URL("../src/routes/messages.ts", import.meta.url),
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

test("gallery paging reads the synchronized ordered gallery table directly", () => {
  const galleryCaseStart = dataRouteSource.indexOf('case "gallery"');
  const dmCaseStart = dataRouteSource.indexOf('case "dm"', galleryCaseStart);
  const galleryCase = dataRouteSource.slice(galleryCaseStart, dmCaseStart);

  assert.match(galleryCase, /message_id AS id/);
  assert.match(galleryCase, /FROM gallery\s+WHERE channel_id = \?/);
  assert.match(galleryCase, /ORDER BY created_at DESC, message_id DESC LIMIT 50/);
  assert.doesNotMatch(galleryCase, /JOIN messages|FROM messages/);
});

test("gallery paging uses a stable timestamp and id cursor", () => {
  assert.match(
    dataRouteSource,
    /\(created_at, message_id\) < \(\?, \?\)/,
  );
  assert.match(apiSource, /params\.set\("cursor_id", cursorId\)/);
  assert.match(
    channelActionsSource,
    /fetchGallery\(fetchChannel, oldest\.created_at, oldest\.id\)/,
  );
});

test("message lifecycle triggers keep gallery rows synchronized", () => {
  assert.match(
    migrationSource,
    /DELETE FROM gallery\s+WHERE NOT EXISTS/,
  );
  assert.match(
    migrationSource,
    /CREATE TRIGGER IF NOT EXISTS messages_gallery_after_insert/,
  );
  assert.match(migrationSource, /CREATE TRIGGER IF NOT EXISTS messages_gallery_after_update/);
  assert.match(
    migrationSource,
    /WHEN OLD\.gallery_id IS NOT NULL OR NEW\.gallery_id IS NOT NULL/,
  );
  assert.match(migrationSource, /CREATE TRIGGER IF NOT EXISTS messages_gallery_after_delete/);
  assert.match(migrationSource, /DROP INDEX IF EXISTS messages_visible_gallery_lookup_idx/);
  assert.match(canonicalMessageMigrationSource, /ALTER TABLE gallery ADD COLUMN message_id TEXT/);
  assert.match(
    canonicalMessageMigrationSource,
    /CREATE INDEX gallery_channel_created_message_idx\s+ON gallery\(channel_id, created_at DESC, message_id DESC\)/,
  );
  assert.match(
    canonicalMessageMigrationSource,
    /CREATE UNIQUE INDEX gallery_channel_message_id_idx\s+ON gallery\(channel_id, message_id\)/,
  );
  assert.match(canonicalMessageMigrationSource, /NEW\.gallery_id, NEW\.id, NEW\.image/);
  assert.doesNotMatch(messagesSource, /INSERT INTO gallery/);
});
