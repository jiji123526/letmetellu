import assert from "node:assert/strict";
import test from "node:test";

import { signProtectedMediaInPayload } from "../../src/lib/media-access-token.ts";
import { handleMediaServe } from "../src/routes/upload.ts";
import { createRoomToken } from "../src/routes/passcode.ts";
import type { Env } from "../src/types.ts";

const INTERNAL_SECRET = "media-revocation-test-secret";
const CHANNEL_ID = "media-room";
const MEDIA_KEY = `${CHANNEL_ID}/photo.jpg`;
const OWNER_ID = "owner-a";
const OLD_PASSCODE_HASH = "old-passcode-hash";
const NEW_PASSCODE_HASH = "new-passcode-hash";

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function createMediaFixture(
  initialPasscode: string | null,
  options: { attachedTicket?: boolean } = {},
) {
  const attachedTicket = options.attachedTicket ?? true;
  let channelExists = true;
  let passcode = initialPasscode;
  let mediaReads = 0;

  function statement(sqlText: string) {
    const sql = normalizeSql(sqlText);
    return {
      bind() {
        return statement(sql);
      },
      async first() {
        if (sql.includes("FROM upload_tickets WHERE key = ? LIMIT 1")) {
          return attachedTicket
            ? {
                channel_id: CHANNEL_ID,
                purpose: "message",
                status: "attached",
                expires_at: "2099-01-01T00:00:00.000Z",
              }
            : null;
        }
        if (sql.includes("SELECT passcode, owner_uid FROM channels WHERE id = ?")) {
          return channelExists ? { passcode, owner_uid: OWNER_ID } : null;
        }
        return null;
      },
      async all() {
        return { results: [] };
      },
      async run() {
        return { success: true, meta: { changes: 1 } };
      },
    };
  }

  const env = {
    INTERNAL_SECRET,
    DB: {
      prepare: statement,
      async batch(statements: Array<{ all(): Promise<{ results: unknown[] }> }>) {
        return Promise.all(statements.map((current) => current.all()));
      },
    },
    MEDIA: {
      async get(key: string) {
        mediaReads++;
        if (key !== MEDIA_KEY) return null;
        return {
          body: new TextEncoder().encode("image"),
          httpMetadata: { contentType: "image/jpeg" },
        };
      },
    },
  } as unknown as Env;

  return {
    env,
    get mediaReads() {
      return mediaReads;
    },
    deleteChannel() {
      channelExists = false;
    },
    setPasscode(nextPasscode: string | null) {
      passcode = nextPasscode;
    },
  };
}

function mediaRequest(headers?: HeadersInit): Request {
  return new Request(`https://api.example.test/api/media/${MEDIA_KEY}`, { headers });
}

async function createDirectMediaUrl(input: {
  roomToken?: string;
  userId?: string;
}): Promise<string> {
  process.env.INTERNAL_SECRET = INTERNAL_SECRET;
  const signed = await signProtectedMediaInPayload({
    messages: [{ image: `/api/media/${MEDIA_KEY}` }],
  }, input);
  return signed.messages[0].image;
}

test("fresh media requests reject a room token after the passcode changes", async () => {
  const fixture = createMediaFixture(OLD_PASSCODE_HASH);
  const oldToken = await createRoomToken(CHANNEL_ID, OLD_PASSCODE_HASH, fixture.env);

  const initialResponse = await handleMediaServe(mediaRequest({
    "X-Room-Token": oldToken,
  }), fixture.env, MEDIA_KEY);
  assert.equal(initialResponse.status, 200);
  assert.equal(initialResponse.headers.get("Cache-Control"), "private, max-age=300, must-revalidate");

  fixture.setPasscode(NEW_PASSCODE_HASH);
  const staleResponse = await handleMediaServe(mediaRequest({
    "X-Room-Token": oldToken,
  }), fixture.env, MEDIA_KEY);
  assert.equal(staleResponse.status, 403);
  assert.equal((await staleResponse.json() as { error?: string }).error, "invalid token");

  const currentToken = await createRoomToken(CHANNEL_ID, NEW_PASSCODE_HASH, fixture.env);
  const currentResponse = await handleMediaServe(mediaRequest({
    "X-Room-Token": currentToken,
  }), fixture.env, MEDIA_KEY);
  assert.equal(currentResponse.status, 200);
});

test("direct media capabilities are invalidated by passcode rotation", async () => {
  const fixture = createMediaFixture(OLD_PASSCODE_HASH);
  const oldToken = await createRoomToken(CHANNEL_ID, OLD_PASSCODE_HASH, fixture.env);
  const directUrl = await createDirectMediaUrl({ roomToken: oldToken });

  const initialResponse = await handleMediaServe(
    new Request(directUrl),
    fixture.env,
    MEDIA_KEY,
  );
  assert.equal(initialResponse.status, 200);

  fixture.setPasscode(NEW_PASSCODE_HASH);
  const staleResponse = await handleMediaServe(
    new Request(directUrl),
    fixture.env,
    MEDIA_KEY,
  );
  assert.equal(staleResponse.status, 403);
  assert.equal((await staleResponse.json() as { error?: string }).error, "passcode required");
});

test("channel owners retain media access without a room token", async () => {
  const fixture = createMediaFixture(NEW_PASSCODE_HASH);
  const response = await handleMediaServe(mediaRequest({
    "X-Internal-Token": INTERNAL_SECRET,
    "X-User-Id": OWNER_ID,
  }), fixture.env, MEDIA_KEY);

  assert.equal(response.status, 200);
});

test("direct owner media capabilities require current channel ownership", async () => {
  const fixture = createMediaFixture(NEW_PASSCODE_HASH);
  const directUrl = await createDirectMediaUrl({ userId: OWNER_ID });

  const response = await handleMediaServe(
    new Request(directUrl),
    fixture.env,
    MEDIA_KEY,
  );

  assert.equal(response.status, 200);
});

test("deleted channels deny fresh media reads before pending R2 cleanup", async () => {
  const fixture = createMediaFixture(null);
  const directUrl = await createDirectMediaUrl({});
  fixture.deleteChannel();

  const response = await handleMediaServe(
    new Request(directUrl),
    fixture.env,
    MEDIA_KEY,
  );

  assert.equal(response.status, 404);
  assert.equal(fixture.mediaReads, 0);
});

test("deleted channels deny unlinked channel-key media before R2 cleanup", async () => {
  const fixture = createMediaFixture(null, { attachedTicket: false });
  fixture.deleteChannel();

  const response = await handleMediaServe(mediaRequest(), fixture.env, MEDIA_KEY);

  assert.equal(response.status, 404);
  assert.equal(fixture.mediaReads, 0);
});
