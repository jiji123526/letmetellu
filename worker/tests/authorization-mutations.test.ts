import assert from "node:assert/strict";
import test from "node:test";

import { createAnonymousIdentity, createDeviceIdentity } from "../src/lib/anonymous-identity.ts";
import { createRoomToken } from "../src/routes/passcode.ts";
import { handleChannelReports } from "../src/routes/channel-reports.ts";
import { handleMessages } from "../src/routes/messages.ts";
import { handleSupport } from "../src/routes/support.ts";
import type { Env } from "../src/types.ts";

const INTERNAL_SECRET = "authorization-test-secret";
const CHANNEL_ID = "channel-a";
const OWNER_ID = "owner-a";

interface FakeDbOptions {
  channelPasscode?: string | null;
  supportSessionOwner?: string;
  supportThreadOwner?: string;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function createFakeEnv(options: FakeDbOptions = {}): {
  env: Env;
  writes: string[];
  durableRequests: string[];
} {
  const writes: string[] = [];
  const durableRequests: string[] = [];
  const channelPasscode = options.channelPasscode ?? null;
  const now = new Date().toISOString();

  function firstResult(sql: string): unknown {
    if (sql.includes("FROM channel_moderation")) return null;
    if (sql.includes("FROM blocked")) return null;
    if (sql.includes("FROM messages WHERE client_message_id")) return null;
    if (sql.includes("WITH RECURSIVE ancestors")) return null;
    if (sql.includes("SELECT id FROM messages WHERE id = ? AND channel_id = ? AND deleted = 0")) return null;
    if (sql.includes("SELECT uid, image FROM messages WHERE id = ? AND channel_id = ?")) return null;
    if (sql.includes("SELECT uid, created_at FROM messages WHERE id = ? AND channel_id = ?")) return null;
    if (sql.includes("SELECT reactions FROM messages WHERE id = ? AND channel_id = ?")) return null;
    if (sql.includes("FROM upload_tickets")) return null;
    if (sql.includes("SELECT locale FROM users WHERE id = ?")) return { locale: "en" };
    if (sql.includes("FROM support_sessions") && sql.includes("WHERE id = ?")) {
      return {
        id: "foreign-session",
        user_id: options.supportSessionOwner || "victim-user",
        status: "open",
        entry_topic: null,
        current_node_id: "start",
        resolved_via_tree: 0,
        escalated_thread_id: null,
        created_at: now,
        updated_at: now,
        completed_at: null,
      };
    }
    if (sql.includes("FROM support_threads st") && sql.includes("WHERE st.id = ?")) {
      return {
        id: "foreign-thread",
        user_id: options.supportThreadOwner || "victim-user",
        source_session_id: null,
        entry_topic: null,
        summary: "private support request",
        status: "open",
        created_at: now,
        updated_at: now,
        closed_at: null,
        closed_by: null,
        user_acknowledged_at: null,
        last_sender_role: "platform_admin",
        has_admin_reply: 1,
      };
    }
    if (sql.includes("SELECT id, is_frozen, owner_uid, passcode")) {
      return {
        id: CHANNEL_ID,
        is_frozen: 0,
        owner_uid: OWNER_ID,
        passcode: channelPasscode,
        target_is_frozen: 0,
      };
    }
    if (sql.includes("SELECT passcode, owner_uid FROM channels WHERE id = ?")) {
      return { passcode: channelPasscode, owner_uid: OWNER_ID };
    }
    if (sql.includes("SELECT owner_uid FROM channels WHERE id = ?")) {
      return { owner_uid: "platform-admin" };
    }
    return null;
  }

  function statement(sqlText: string, params: unknown[] = {}) {
    const sql = normalizeSql(sqlText);
    return {
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
        writes.push(`${sql} :: ${JSON.stringify(params)}`);
        return { success: true, meta: { changes: 1 } };
      },
    };
  }

  const env = {
    INTERNAL_SECRET,
    REPORTS_CHANNEL_ID: "reports",
    DB: {
      prepare: statement,
      async batch(statements: unknown[]) {
        writes.push(`batch:${statements.length}`);
        return [];
      },
    },
    CHAT_ROOM: {
      idFromName(name: string) {
        return name;
      },
      get() {
        return {
          async fetch(request: Request) {
            durableRequests.push(new URL(request.url).pathname);
            if (request.url.includes("/channel-rate-limit")) {
              return Response.json({ ok: true });
            }
            return Response.json({ ok: true });
          },
        };
      },
    },
    MEDIA: {
      async delete() {},
    },
  } as unknown as Env;

  return { env, writes, durableRequests };
}

function ownerHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Internal-Token": INTERNAL_SECRET,
    "X-User-Id": OWNER_ID,
  };
}

function jsonRequest(method: string, body: Record<string, unknown>, headers: HeadersInit = ownerHeaders()): Request {
  return new Request("https://api.example.test/api", {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

async function expectError(response: Response, status: number, error: string): Promise<void> {
  assert.equal(response.status, status);
  assert.equal((await response.json() as { error?: string }).error, error);
}

function assertOnlyRateLimitWrites(writes: string[]): void {
  assert.deepEqual(
    writes.filter((write) => !write.startsWith("INSERT INTO durable_rate_limits")),
    [],
  );
}

test("message send rejects a room token issued for another channel", async () => {
  const { env, writes } = createFakeEnv({ channelPasscode: "hash-a" });
  const foreignToken = await createRoomToken("channel-b", "hash-b", env);
  const response = await handleMessages(jsonRequest("POST", {
    channel_id: CHANNEL_ID,
    text: "hello",
  }, {
    "Content-Type": "application/json",
    "X-Room-Token": foreignToken,
  }), env);

  await expectError(response, 403, "invalid token");
  assert.deepEqual(writes, []);
});

test("message send rejects reply and report targets from another channel", async () => {
  for (const body of [
    { reply_to: "foreign-message", expected: "invalid_reply_target" },
    { report: true, reported_msg_id: "foreign-message", expected: "invalid_report_target" },
  ]) {
    const { env, writes } = createFakeEnv();
    const response = await handleMessages(jsonRequest("POST", {
      channel_id: CHANNEL_ID,
      client_message_id: crypto.randomUUID(),
      text: "cross-channel attempt",
      ...body,
    }), env);

    await expectError(response, 400, body.expected);
    assert.deepEqual(writes, []);
  }
});

test("message send rejects an upload ticket from another channel", async () => {
  const { env, writes } = createFakeEnv();
  const response = await handleMessages(jsonRequest("POST", {
    channel_id: CHANNEL_ID,
    client_message_id: crypto.randomUUID(),
    text: "foreign attachment",
    image: "/api/media/channel-b/foreign.jpg",
    upload_id: "foreign-ticket",
  }), env);

  await expectError(response, 400, "invalid_upload_ticket");
  assert.deepEqual(writes, []);
});

test("delete, edit and reaction reject message IDs outside the requested channel", async () => {
  const deleteEnv = createFakeEnv();
  const anonymous = await createAnonymousIdentity(deleteEnv.env, "message-owner");
  const deleteResponse = await handleMessages(jsonRequest("DELETE", {
    channel_id: CHANNEL_ID,
    message_id: "foreign-message",
  }, {
    "Content-Type": "application/json",
    "X-Anonymous-Token": anonymous.token,
  }), deleteEnv.env);
  await expectError(deleteResponse, 404, "not found");
  assert.deepEqual(deleteEnv.writes, []);

  const actorEnv = createFakeEnv();
  const actor = await createAnonymousIdentity(actorEnv.env, "message-owner");
  const device = await createDeviceIdentity(actorEnv.env, "device-owner");

  for (const [method, extra] of [
    ["PUT", { text: "edited" }],
    ["PATCH", { emoji: "👍" }],
  ] as const) {
    const response = await handleMessages(jsonRequest(method, {
      channel_id: CHANNEL_ID,
      message_id: "foreign-message",
      ...extra,
    }, {
      "Content-Type": "application/json",
      "X-Anonymous-Token": actor.token,
      "X-Device-Token": device.token,
    }), actorEnv.env);
    await expectError(response, 404, "not found");
    assert.deepEqual(actorEnv.writes, []);
  }
});

test("guided support mutations hide sessions and threads owned by another user", async () => {
  const sessionActions = ["answer_session", "escalate_session", "clear_session"];
  const threadActions = ["send_thread_message", "close_thread", "mark_thread_read", "acknowledge_closure"];

  for (const action of sessionActions) {
    const current = createFakeEnv();
    const response = await handleSupport(jsonRequest("POST", {
      action,
      session_id: "foreign-session",
      choice_id: "account",
    }, {
      "Content-Type": "application/json",
      "X-Internal-Token": INTERNAL_SECRET,
      "X-User-Id": "attacker-user",
    }), current.env);
    await expectError(response, 404, "session_not_found");
    assertOnlyRateLimitWrites(current.writes);
  }

  for (const action of threadActions) {
    const current = createFakeEnv();
    const response = await handleSupport(jsonRequest("POST", {
      action,
      thread_id: "foreign-thread",
      text: "unauthorized",
    }, {
      "Content-Type": "application/json",
      "X-Internal-Token": INTERNAL_SECRET,
      "X-User-Id": "attacker-user",
    }), current.env);
    await expectError(response, 404, "thread_not_found");
    assertOnlyRateLimitWrites(current.writes);
  }
});

test("all report and petition actions require the platform-admin role", async () => {
  const reportActions = ["resolve", "dismiss", "warn_owner", "send_suspend_notice", "freeze_channel", "unfreeze_channel", "delete_channel"];
  const petitionActions = ["accept_petition", "reject_petition", "unfreeze_channel"];

  for (const userId of [null, "normal-user", OWNER_ID]) {
    for (const action of [...reportActions, ...petitionActions]) {
      const current = createFakeEnv();
      const petitionAction = petitionActions.includes(action);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (userId) {
        headers["X-Internal-Token"] = INTERNAL_SECRET;
        headers["X-User-Id"] = userId;
      }
      const response = await handleChannelReports(jsonRequest("PATCH", {
        action,
        ...(petitionAction ? { petition_id: "petition-a" } : { report_id: "report-a" }),
      }, headers), current.env);
      await expectError(response, 403, "owner access required");
      assert.deepEqual(current.writes, []);
    }
  }
});

test("platform admin reaches target-scoped report and petition lookup", async () => {
  for (const [action, idField, expected] of [
    ["resolve", "report_id", "report_not_found"],
    ["freeze_channel", "report_id", "report_not_found"],
    ["accept_petition", "petition_id", "petition_not_found"],
  ] as const) {
    const current = createFakeEnv();
    const response = await handleChannelReports(jsonRequest("PATCH", {
      action,
      [idField]: "missing-target",
    }, {
      "Content-Type": "application/json",
      "X-Internal-Token": INTERNAL_SECRET,
      "X-User-Id": "platform-admin",
    }), current.env);
    await expectError(response, 404, expected);
    assert.deepEqual(current.writes, []);
  }
});
