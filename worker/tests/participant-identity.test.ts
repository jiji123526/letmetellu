import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createAnonymousIdentity } from "../src/lib/anonymous-identity.ts";
import { handleUpload } from "../src/routes/upload.ts";
import type { Env } from "../src/types.ts";

const messagesProxySource = readFileSync(
  new URL("../../src/app/api/messages/route.ts", import.meta.url),
  "utf8",
);
const uploadProxySource = readFileSync(
  new URL("../../src/app/api/upload/route.ts", import.meta.url),
  "utf8",
);

const INTERNAL_SECRET = "participant-identity-secret";
const CHANNEL_ID = "channel-a";
const OWNER_ID = "owner-a";
const PARTICIPANT_USER_ID = "participant-user";

function createUploadEnv() {
  const insertedUploadTickets: Array<{
    uid: string | null;
    authUid: string | null;
    purpose: string;
  }> = [];

  function statement(sql: string, params: unknown[] = []) {
    return {
      bind(...nextParams: unknown[]) {
        return statement(sql, nextParams);
      },
      async first() {
        if (sql.includes("SELECT owner_uid FROM channels WHERE id = ?")) {
          return { owner_uid: OWNER_ID };
        }
        if (sql.includes("SELECT passcode, owner_uid FROM channels WHERE id = ?")) {
          return { passcode: null, owner_uid: OWNER_ID };
        }
        if (sql.includes("SELECT COUNT(*) AS count FROM upload_tickets")) {
          return { count: 0 };
        }
        return null;
      },
      async run() {
        if (sql.includes("INSERT INTO upload_tickets")) {
          insertedUploadTickets.push({
            uid: (params[3] as string | null) || null,
            authUid: (params[4] as string | null) || null,
            purpose: String(params[5] || ""),
          });
        }
        return { success: true, meta: { changes: 1 } };
      },
      async all() {
        return { results: [] };
      },
    };
  }

  const env = {
    INTERNAL_SECRET,
    REPORTS_CHANNEL_ID: "reports",
    DB: {
      prepare: statement,
    },
    MEDIA: {
      async put() {},
      async get() { return null; },
      async delete() {},
    },
  } as unknown as Env;

  return { env, insertedUploadTickets };
}

test("authenticated participant upload stays anonymous publicly but records auth identity on the ticket", async () => {
  const { env, insertedUploadTickets } = createUploadEnv();
  const anonymous = await createAnonymousIdentity(env, "anon-1");
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

  const response = await handleUpload(new Request(
    `https://api.example.test/api/upload?channel=${CHANNEL_ID}&purpose=message`,
    {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(pngBytes.byteLength),
        "X-Internal-Token": INTERNAL_SECRET,
        "X-Authenticated-User-Id": PARTICIPANT_USER_ID,
        "X-Anonymous-Token": anonymous.token,
      },
      body: pngBytes,
    },
  ), env);

  assert.equal(response.status, 200);
  const data = await response.json() as { ok?: boolean; upload_id?: string };
  assert.equal(data.ok, true);
  assert.equal(typeof data.upload_id, "string");
  assert.deepEqual(insertedUploadTickets, [{
    uid: "anon-1",
    authUid: PARTICIPANT_USER_ID,
    purpose: "message",
  }]);
});

test("anonymous participant proxies forward authenticated account identity in a dedicated internal header", () => {
  assert.match(messagesProxySource, /X-Authenticated-User-Id/);
  assert.match(uploadProxySource, /X-Authenticated-User-Id/);
  assert.match(messagesProxySource, /session\?\.user\?\.id && anonymousMode/);
  assert.match(uploadProxySource, /session\?\.user\?\.id && anonymousMode/);
});
