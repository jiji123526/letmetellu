import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationSource = readFileSync(
  new URL("../migrations/0068_dm_reply_shard_boundary.sql", import.meta.url),
  "utf8",
);

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE channels (id TEXT PRIMARY KEY);
    CREATE TABLE dm (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id),
      activity_at TEXT
    );
    CREATE TABLE dm_replies (
      id TEXT PRIMARY KEY,
      client_reply_id TEXT NOT NULL,
      dm_id TEXT NOT NULL REFERENCES dm(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL REFERENCES channels(id),
      owner_uid TEXT NOT NULL REFERENCES users(id),
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      pending_delete_at TEXT,
      image TEXT,
      image_w INTEGER,
      image_h INTEGER,
      UNIQUE(owner_uid, client_reply_id)
    );
    CREATE INDEX dm_replies_dm_created_idx
      ON dm_replies(dm_id, created_at, id);
    CREATE TRIGGER dm_bump_activity_at_after_reply
    AFTER INSERT ON dm_replies
    BEGIN
      UPDATE dm
      SET activity_at = CASE
        WHEN activity_at IS NULL OR activity_at < NEW.created_at
          THEN NEW.created_at
        ELSE activity_at
      END
      WHERE id = NEW.dm_id;
    END;

    INSERT INTO users (id) VALUES ('owner-1');
    INSERT INTO channels (id) VALUES ('room-one');
    INSERT INTO dm (id, channel_id, activity_at)
    VALUES ('dm-1', 'room-one', '2026-09-01T00:00:00.000Z');
    INSERT INTO dm_replies (
      id, client_reply_id, dm_id, channel_id, owner_uid, text, created_at,
      pending_delete_at, image, image_w, image_h
    ) VALUES (
      'reply-1', 'client-1', 'dm-1', 'room-one', 'owner-1', 'private',
      '2026-09-02T00:00:00.000Z', NULL, 'private-image', 640, 480
    );
  `);
  return database;
}

test("dm reply boundary migration preserves data and shard-local integrity", () => {
  const database = createDatabase();
  database.exec(migrationSource);

  const row = database.prepare(`
    SELECT
      id, client_reply_id, dm_id, channel_id, owner_uid, text, created_at,
      pending_delete_at, image, image_w, image_h
    FROM dm_replies
  `).get();
  assert.deepEqual({ ...row }, {
    id: "reply-1",
    client_reply_id: "client-1",
    dm_id: "dm-1",
    channel_id: "room-one",
    owner_uid: "owner-1",
    text: "private",
    created_at: "2026-09-02T00:00:00.000Z",
    pending_delete_at: null,
    image: "private-image",
    image_w: 640,
    image_h: 480,
  });

  const foreignKeys = database.prepare(`
    SELECT "table" AS referenced_table, "from" AS source_column, on_delete
    FROM pragma_foreign_key_list('dm_replies')
    ORDER BY referenced_table
  `).all().map((foreignKey) => ({ ...foreignKey }));
  assert.deepEqual(foreignKeys, [
    {
      referenced_table: "channels",
      source_column: "channel_id",
      on_delete: "NO ACTION",
    },
    {
      referenced_table: "dm",
      source_column: "dm_id",
      on_delete: "CASCADE",
    },
  ]);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
});

test("dm reply boundary retains uniqueness, cascade, and activity trigger", () => {
  const database = createDatabase();
  database.exec(migrationSource);

  assert.throws(
    () => database.prepare(`
      INSERT INTO dm_replies (
        id, client_reply_id, dm_id, channel_id, owner_uid, text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "reply-duplicate",
      "client-1",
      "dm-1",
      "room-one",
      "owner-1",
      "duplicate",
      "2026-09-03T00:00:00.000Z",
    ),
    /UNIQUE constraint failed/,
  );

  database.prepare(`
    INSERT INTO dm_replies (
      id, client_reply_id, dm_id, channel_id, owner_uid, text, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "reply-2",
    "client-2",
    "dm-1",
    "room-one",
    "owner-not-copied-to-shard",
    "new reply",
    "2026-09-04T00:00:00.000Z",
  );
  assert.equal(
    database.prepare("SELECT activity_at FROM dm WHERE id = 'dm-1'").get()
      ?.activity_at,
    "2026-09-04T00:00:00.000Z",
  );

  database.prepare("DELETE FROM dm WHERE id = 'dm-1'").run();
  assert.equal(
    database.prepare("SELECT COUNT(*) AS rows FROM dm_replies").get()?.rows,
    0,
  );
});
