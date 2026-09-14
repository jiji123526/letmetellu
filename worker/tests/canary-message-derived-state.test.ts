import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleCanaryChannelCopyMutation } from "../src/routes/canary-channel-copy-mutations.ts";
import { handleCanaryChannelCopyVerification } from "../src/routes/canary-channel-copy-verification.ts";
import { handleCanaryMessageDelta } from "../src/routes/canary-message-delta.ts";
import type { Env } from "../src/types.ts";

const COPY_TOKEN = "copy-token-that-is-at-least-thirty-two-characters";
const OPERATOR_TOKEN = "operator-token-at-least-thirty-two-characters";
const FINALIZE_TOKEN = "finalize-token-that-is-at-least-thirty-two-characters";

class SqliteStatement {
  readonly sql: string;
  private readonly database: DatabaseSync;
  private readonly values: unknown[];

  constructor(database: DatabaseSync, sql: string, values: unknown[] = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new SqliteStatement(this.database, this.sql, values);
  }

  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.values) || null) as T | null;
  }

  async all<T>() {
    return { results: this.database.prepare(this.sql).all(...this.values) as T[] };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }

  runSync() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { results: [], meta: { changes: Number(result.changes) } };
  }
}

class SqliteD1 {
  readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  prepare(sql: string) {
    return new SqliteStatement(this.database, sql);
  }

  async batch(statements: SqliteStatement[]) {
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function createDatabase(destination = false): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE channels (
      id TEXT PRIMARY KEY,
      projection_source_version INTEGER NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      text TEXT,
      reply_to TEXT REFERENCES messages(id),
      root_id TEXT,
      gallery_id TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      auth_uid TEXT,
      channel_id TEXT NOT NULL REFERENCES channels(id),
      created_at TEXT
    );
    CREATE TABLE message_actor_identities (
      record_id TEXT NOT NULL,
      record_type TEXT NOT NULL,
      channel_id TEXT NOT NULL REFERENCES channels(id),
      uid TEXT NOT NULL,
      device_id_hash TEXT NOT NULL,
      created_at TEXT,
      PRIMARY KEY (record_id, record_type)
    );
    CREATE TABLE pending_admin_deletions (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL
    );
    CREATE TABLE gallery (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      image TEXT NOT NULL,
      auth_uid TEXT,
      channel_id TEXT NOT NULL,
      created_at TEXT
    );
    CREATE TABLE message_links (
      message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE messages_fts USING fts5(
      text,
      content='messages',
      content_rowid='rowid'
    );
    CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
    CREATE TRIGGER messages_gallery_after_insert
    AFTER INSERT ON messages
    WHEN NEW.deleted = 0 AND NEW.gallery_id IS NOT NULL AND NEW.image IS NOT NULL
    BEGIN
      INSERT INTO gallery (id, message_id, image, auth_uid, channel_id, created_at)
      VALUES (NEW.gallery_id, NEW.id, NEW.image, NEW.auth_uid, NEW.channel_id, NEW.created_at);
    END;
  `);
  if (destination) {
    database.exec(`
      CREATE TABLE canary_channel_copy_jobs (
        channel_id TEXT PRIMARY KEY,
        source_projection_version INTEGER NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        cursor_created_at TEXT,
        cursor_row_id TEXT,
        message_snapshot_created_at TEXT,
        message_snapshot_id TEXT,
        stage_rows_copied INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }
  database.prepare(`
    INSERT INTO channels (id, projection_source_version) VALUES ('room-one', 7)
  `).run();
  database.prepare(`
    INSERT INTO channels (id, projection_source_version) VALUES ('room-one_live', 7)
  `).run();
  return database;
}

function insertMessage(
  database: DatabaseSync,
  index: number,
  text = "ordinary message",
) {
  const id = `message-${String(index).padStart(3, "0")}`;
  const createdAt = `2026-09-13T01:${String(index).padStart(3, "0")}:00.000Z`;
  const image = index === 0 ? "private/image.jpg" : null;
  database.prepare(`
    INSERT INTO messages (
      id, text, reply_to, root_id, gallery_id, deleted, image, auth_uid,
      channel_id, created_at
    ) VALUES (?, ?, NULL, ?, ?, 0, ?, 'private-auth', 'room-one', ?)
  `).run(id, text, id, image ? id : null, image, createdAt);
  return { id, createdAt };
}

function env(source: DatabaseSync, destination: DatabaseSync): Env {
  return {
    DB: new SqliteD1(source) as unknown as D1Database,
    CHAT_DB_CANARY_A: new SqliteD1(destination) as unknown as D1Database,
    D1_CANARY_COPY_TOKEN: COPY_TOKEN,
    D1_CANARY_OPERATOR_TOKEN: OPERATOR_TOKEN,
    D1_CANARY_FINALIZE_TOKEN: FINALIZE_TOKEN,
    WRITE_MAINTENANCE_MODE: "true",
  } as unknown as Env;
}

function deltaRequest(action: "rebuild-dependents" | "complete") {
  return new Request("https://worker.example/internal/d1-canary/message-delta", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Canary-Finalize-Token": FINALIZE_TOKEN,
    },
    body: JSON.stringify({ action, shard: "canary-a", channel: "room-one" }),
  });
}

function mutationRequest() {
  return new Request("https://worker.example/internal/d1-canary/copy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Canary-Copy-Token": COPY_TOKEN,
    },
    body: JSON.stringify({
      action: "copy-message-dependents",
      shard: "canary-a",
      channel: "room-one",
    }),
  });
}

function verificationRequest() {
  return new Request(
    "https://worker.example/internal/d1-canary/copy-verify?shard=canary-a&channel=room-one",
    { headers: { "X-Canary-Operator-Token": OPERATOR_TOKEN } },
  );
}

function prepareCopiedHistory(source: DatabaseSync, destination: DatabaseSync) {
  let snapshot = { id: "", createdAt: "" };
  for (let index = 0; index < 101; index += 1) {
    const text = index === 1 || index === 100
      ? `link https://example.com/${index}`
      : "ordinary message";
    const sourceMessage = insertMessage(source, index, text);
    insertMessage(destination, index, text);
    source.prepare(`
      INSERT INTO message_actor_identities (
        record_id, record_type, channel_id, uid, device_id_hash, created_at
      ) VALUES (?, 'message', 'room-one', ?, ?, ?)
    `).run(
      sourceMessage.id,
      `private-uid-${index}`,
      `private-device-${index}`,
      sourceMessage.createdAt,
    );
    snapshot = sourceMessage;
  }
  destination.prepare(`
    INSERT INTO canary_channel_copy_jobs (
      channel_id, source_projection_version, stage, status,
      message_snapshot_created_at, message_snapshot_id,
      created_at, updated_at
    ) VALUES ('room-one', 7, 'messages_copied', 'active', ?, ?, ?, ?)
  `).run(snapshot.createdAt, snapshot.id, snapshot.createdAt, snapshot.createdAt);
}

test("message dependents copy actors in batches and rebuild links from text", async () => {
  const source = createDatabase();
  const destination = createDatabase(true);
  prepareCopiedHistory(source, destination);
  const inputEnv = env(source, destination);

  const first = await handleCanaryChannelCopyMutation(mutationRequest(), inputEnv);
  const firstBody = await first.json() as Record<string, unknown>;
  assert.equal(first.status, 200);
  assert.equal(firstBody.stage, "messages_copied");
  assert.equal(firstBody.batchRowsCopied, 100);
  assert.equal(firstBody.hasMore, true);

  const second = await handleCanaryChannelCopyMutation(mutationRequest(), inputEnv);
  const secondBody = await second.json() as Record<string, unknown>;
  assert.equal(secondBody.stage, "message_actors_copied");
  assert.equal(secondBody.batchRowsCopied, 1);
  assert.equal(destination.prepare(`
    SELECT COUNT(*) AS count FROM message_actor_identities
  `).get()?.count, 101);

  const third = await handleCanaryChannelCopyMutation(mutationRequest(), inputEnv);
  const thirdBody = await third.json() as Record<string, unknown>;
  assert.equal(thirdBody.stage, "message_links_rebuilt");
  assert.equal(thirdBody.batchRowsCopied, 2);
  assert.equal(destination.prepare(`
    SELECT COUNT(*) AS count FROM message_links
  `).get()?.count, 2);
  assert.doesNotMatch(
    JSON.stringify([firstBody, secondBody, thirdBody]),
    /private-uid|private-device|example\.com/,
  );

  const verified = await handleCanaryChannelCopyVerification(
    verificationRequest(),
    inputEnv,
  );
  assert.equal(verified.status, 200);
  const verifiedBody = await verified.json() as Record<string, unknown>;
  assert.equal(verifiedBody.ready, true);
  assert.deepEqual(verifiedBody.blockers, []);
  assert.equal((verifiedBody.counts as Record<string, number>).messages, 101);
  assert.equal((verifiedBody.counts as Record<string, number>).galleryExpected, 1);
  assert.equal((verifiedBody.counts as Record<string, number>).linksExpected, 2);
  assert.doesNotMatch(
    JSON.stringify(verifiedBody),
    /private-uid|private-device|ordinary message|example\.com|private\/image/,
  );
});

test("derived verification reports fixed mismatch codes without row content", async () => {
  const source = createDatabase();
  const destination = createDatabase(true);
  prepareCopiedHistory(source, destination);
  const inputEnv = env(source, destination);
  for (let index = 0; index < 3; index += 1) {
    await handleCanaryChannelCopyMutation(mutationRequest(), inputEnv);
  }
  destination.prepare("DELETE FROM gallery").run();

  const response = await handleCanaryChannelCopyVerification(
    verificationRequest(),
    inputEnv,
  );
  assert.equal(response.status, 409);
  const body = await response.json() as { blockers: string[]; ready: boolean };
  assert.equal(body.ready, false);
  assert.deepEqual(body.blockers, ["gallery_derived_mismatch"]);
});

test("frozen delta rebuilds dependents before marking the copy complete", async () => {
  const source = createDatabase();
  const destination = createDatabase(true);
  prepareCopiedHistory(source, destination);
  destination.prepare(`
    UPDATE canary_channel_copy_jobs SET stage = 'delta_messages_copied'
  `).run();
  const inputEnv = env(source, destination);
  let stage = "delta_messages_copied";
  for (let call = 0; call < 5 && stage !== "delta_links_rebuilt"; call += 1) {
    const response = await handleCanaryMessageDelta(
      deltaRequest("rebuild-dependents"),
      inputEnv,
    );
    assert.equal(response.status, 200);
    stage = (await response.json() as { stage: string }).stage;
  }
  assert.equal(stage, "delta_links_rebuilt");

  const completed = await handleCanaryMessageDelta(deltaRequest("complete"), inputEnv);
  assert.equal(completed.status, 200);
  const body = await completed.json() as Record<string, unknown>;
  assert.equal(body.status, "complete");
  assert.equal(body.stage, "delta_links_rebuilt");
  assert.doesNotMatch(
    JSON.stringify(body),
    /private-uid|private-device|ordinary message|example\.com|private\/image/,
  );
  assert.equal(
    destination.prepare("SELECT status FROM canary_channel_copy_jobs").get()?.status,
    "complete",
  );
});

test("derived verification is hidden, GET-only, and rejects malformed scope", async () => {
  const source = createDatabase();
  const destination = createDatabase(true);
  const inputEnv = env(source, destination);
  const unauthorized = new Request(
    "https://worker.example/internal/d1-canary/copy-verify?shard=canary-a&channel=room-one",
  );
  assert.equal(
    (await handleCanaryChannelCopyVerification(unauthorized, inputEnv)).status,
    404,
  );
  const post = new Request(verificationRequest().url, {
    method: "POST",
    headers: { "X-Canary-Operator-Token": OPERATOR_TOKEN },
  });
  assert.equal(
    (await handleCanaryChannelCopyVerification(post, inputEnv)).status,
    405,
  );
  const malformed = new Request(
    "https://worker.example/internal/d1-canary/copy-verify?shard=unknown&channel=room-one",
    { headers: { "X-Canary-Operator-Token": OPERATOR_TOKEN } },
  );
  assert.equal(
    (await handleCanaryChannelCopyVerification(malformed, inputEnv)).status,
    400,
  );

  const indexSource = readFileSync(
    new URL("../src/index.ts", import.meta.url),
    "utf8",
  );
  const routeSource = readFileSync(
    new URL("../src/routes/canary-channel-copy-verification.ts", import.meta.url),
    "utf8",
  );
  assert.match(indexSource, /\/internal\/d1-canary\/copy-verify/);
  assert.doesNotMatch(
    indexSource,
    /Access-Control-Allow-Headers[^\n]*X-Canary-Operator-Token/,
  );
  assert.doesNotMatch(routeSource, /X-Internal-Token|X-User-Id/);
});
