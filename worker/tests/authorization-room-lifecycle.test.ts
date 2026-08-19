import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createAnonymousIdentity,
  createDeviceIdentity,
} from "../src/lib/anonymous-identity.ts";
import {
  getLiveJoinDisposition,
  type LiveSessionState,
} from "../src/lib/live-sessions.ts";
import { getChannelPasscodeInfo } from "../src/lib/validation.ts";
import { handleMessages } from "../src/routes/messages.ts";
import {
  authorizeRoomToken,
  createRoomToken,
} from "../src/routes/passcode.ts";
import type { Env } from "../src/types.ts";

const INTERNAL_SECRET = "room-lifecycle-test-secret";
const OWNER_ID = "owner-a";
const OLD_PASSCODE_HASH = "old-passcode-hash";
const NEW_PASSCODE_HASH = "new-passcode-hash";

interface FakeEnvOptions {
  channelExists?: boolean;
  channelId?: string;
  passcode?: string | null;
  liveSession?: LiveSessionState | null;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function createFakeEnv(options: FakeEnvOptions = {}): {
  cleanupBatches: number;
  env: Env;
  setPasscode(passcode: string | null): void;
} {
  const channelExists = options.channelExists ?? true;
  const channelId = options.channelId || "room-a";
  let passcode = options.passcode ?? null;
  const liveSession = options.liveSession ?? null;
  let cleanupBatches = 0;

  function firstResult(sql: string): unknown {
    if (sql.includes("FROM channels") && sql.includes("owner_name") && sql.includes("owner_channel_count")) {
      return channelExists
        ? {
            id: channelId,
            name: "Room A",
            owner_uid: OWNER_ID,
            passcode,
            passcode_hint: "hint",
            profile_image: null,
            bubble_color: "#ffffff",
            owner_channel_count: 1,
            moderation_status: "active",
          }
        : null;
    }
    if (sql.includes("SELECT passcode, owner_uid FROM channels")) {
      return channelExists ? { passcode, owner_uid: OWNER_ID } : null;
    }
    if (sql.includes("SELECT text, updated_at FROM config WHERE id = ?")) {
      return liveSession
        ? { text: JSON.stringify(liveSession), updated_at: liveSession.startedAt }
        : null;
    }
    if (sql.includes("SELECT id, is_frozen, owner_uid, passcode")) {
      return channelExists
        ? {
            id: channelId,
            is_frozen: 0,
            owner_uid: OWNER_ID,
            passcode,
            target_is_frozen: 0,
          }
        : null;
    }
    return null;
  }

  function statement(sqlText: string, params: unknown[] = []) {
    const sql = normalizeSql(sqlText);
    return {
      sql,
      bind(...nextParams: unknown[]) {
        return statement(sql, nextParams);
      },
      async first() {
        return firstResult(sql);
      },
      async all() {
        return { results: [] };
      },
      async run() {
        void params;
        return { success: true, meta: { changes: 1 } };
      },
    };
  }

  const env = {
    INTERNAL_SECRET,
    DB: {
      prepare: statement,
      async batch() {
        cleanupBatches++;
        return [];
      },
    },
    CHAT_ROOM: {
      idFromName(name: string) {
        return name;
      },
      get() {
        return {
          async fetch() {
            return Response.json({ ok: true });
          },
        };
      },
    },
    MEDIA: {
      async delete() {},
    },
  } as unknown as Env;

  return {
    env,
    get cleanupBatches() {
      return cleanupBatches;
    },
    setPasscode(nextPasscode: string | null) {
      passcode = nextPasscode;
    },
  };
}

async function expectError(response: Response, status: number, error: string): Promise<void> {
  assert.equal(response.status, status);
  assert.equal((await response.json() as { error?: string }).error, error);
}

function expiredLiveSession(): LiveSessionState {
  return {
    active: true,
    title: "Expired",
    sessionId: "expired-session",
    startedAt: "2026-08-12T00:00:00.000Z",
    expiresAt: "2026-08-12T08:00:00.000Z",
  };
}

test("room tokens are bound to the current passcode hash", async () => {
  const { env } = createFakeEnv();
  const token = await createRoomToken("room-token-binding", OLD_PASSCODE_HASH, env);

  assert.ok(await authorizeRoomToken(token, "room-token-binding", OLD_PASSCODE_HASH, env));
  assert.equal(
    await authorizeRoomToken(token, "room-token-binding", NEW_PASSCODE_HASH, env),
    null,
  );
});

test("channel authorization reads do not retain stale passcode state", async () => {
  const fixture = createFakeEnv({
    channelId: "room-uncached-policy",
    passcode: OLD_PASSCODE_HASH,
  });

  assert.equal(
    (await getChannelPasscodeInfo("room-uncached-policy", fixture.env)).passcode,
    OLD_PASSCODE_HASH,
  );
  fixture.setPasscode(NEW_PASSCODE_HASH);
  assert.equal(
    (await getChannelPasscodeInfo("room-uncached-policy", fixture.env)).passcode,
    NEW_PASSCODE_HASH,
  );
});

test("stale room tokens cannot mutate a room after a passcode change", async () => {
  const channelId = "room-passcode-change";
  const { env } = createFakeEnv({ channelId, passcode: NEW_PASSCODE_HASH });
  const token = await createRoomToken(channelId, OLD_PASSCODE_HASH, env);

  const response = await handleMessages(new Request("https://api.example.test/api/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Room-Token": token,
    },
    body: JSON.stringify({ channel_id: channelId, text: "stale access" }),
  }), env);
  await expectError(response, 403, "invalid token");
});

test("deleted channels reject old room tokens before message mutation", async () => {
  const channelId = "room-deleted";
  const tokenEnv = createFakeEnv({ channelId, passcode: OLD_PASSCODE_HASH });
  const token = await createRoomToken(channelId, OLD_PASSCODE_HASH, tokenEnv.env);
  const { env } = createFakeEnv({ channelExists: false, channelId });

  const response = await handleMessages(new Request("https://api.example.test/api/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Room-Token": token,
    },
    body: JSON.stringify({ channel_id: channelId, text: "deleted access" }),
  }), env);
  await expectError(response, 404, "channel not found");
});

test("expired live sessions reject every live message mutation before authorization or writes", async () => {
  const channelId = "room-expired-mutations";
  const liveChannelId = `${channelId}_live`;
  const methods = [
    ["POST", { channel_id: liveChannelId, text: "new" }],
    ["DELETE", { channel_id: liveChannelId, message_id: "message-a" }],
    ["PUT", { channel_id: liveChannelId, message_id: "message-a", text: "edited" }],
    ["PATCH", { channel_id: liveChannelId, message_id: "message-a", emoji: "x" }],
  ] as const;

  for (const [method, body] of methods) {
    const fixture = createFakeEnv({
      channelId,
      liveSession: expiredLiveSession(),
    });
    const response = await handleMessages(new Request("https://api.example.test/api/messages", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }), fixture.env);

    await expectError(response, 403, "live_session_ended");
    assert.equal(fixture.cleanupBatches, 1);
  }
});

test("init, data, upload and DM routes retain lifecycle authorization gates", () => {
  const initSource = readFileSync(
    new URL("../src/routes/init.ts", import.meta.url),
    "utf8",
  );
  const dataSource = readFileSync(
    new URL("../src/routes/data.ts", import.meta.url),
    "utf8",
  );
  const uploadSource = readFileSync(
    new URL("../src/routes/upload.ts", import.meta.url),
    "utf8",
  );
  const dmSource = readFileSync(
    new URL("../src/routes/dm.ts", import.meta.url),
    "utf8",
  );

  assert.match(initSource, /authorizeRoomToken\(token, parentChannelId, \(channel as any\)\.passcode, env\)/);
  assert.match(initSource, /if \(!channel\)[\s\S]*status: 404/);
  assert.match(dataSource, /if \(!exists\)[\s\S]*status: 404/);
  assert.match(dataSource, /authorizeRoomToken\(roomToken, parentChannelId, passcode, env\)/);
  assert.match(uploadSource, /if \(!await ensureActiveLiveSession\(env, parentChannelId\)\)/);
  assert.match(uploadSource, /if \(!exists\)[\s\S]*status: 404/);
  assert.match(dmSource, /if \(!await ensureActiveLiveSession\(env, parentChannelId\)\)/);
  assert.match(dmSource, /if \(!exists\)[\s\S]*status: 404/);
});

test("live presence requires the current unexpired session while normal rooms keep normal access", async () => {
  const activeSession: LiveSessionState = {
    active: true,
    title: "Current",
    sessionId: "current-session",
    startedAt: "2026-08-13T20:00:00.000Z",
    expiresAt: "2026-08-14T04:00:00.000Z",
  };
  assert.equal(
    getLiveJoinDisposition(activeSession, "current-session", Date.parse("2026-08-13T21:00:00.000Z")),
    "join",
  );
  assert.equal(
    getLiveJoinDisposition(activeSession, "stale-session", Date.parse("2026-08-13T21:00:00.000Z")),
    "session_changed",
  );
  assert.equal(
    getLiveJoinDisposition(activeSession, "current-session", Date.parse("2026-08-14T05:00:00.000Z")),
    "ended",
  );
  assert.equal(getLiveJoinDisposition(null, "current-session"), "ended");

  const channelId = "room-normal-access";
  const { env } = createFakeEnv({ channelId });
  const anonymous = await createAnonymousIdentity(env, "viewer-a");
  const device = await createDeviceIdentity(env, "device-a");
  const response = await handleMessages(new Request("https://api.example.test/api/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Anonymous-Token": anonymous.token,
      "X-Device-Token": device.token,
    },
    body: JSON.stringify({ channel_id: channelId, text: "normal room" }),
  }), env);

  assert.notEqual(response.status, 403);
  assert.notEqual((await response.json() as { error?: string }).error, "live_session_ended");
});
