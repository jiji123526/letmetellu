import assert from "node:assert/strict";
import test from "node:test";

import { readInitPresenceCount } from "../src/lib/init-presence.ts";
import type { Env } from "../src/types.ts";

function createPresenceEnv(fetchPresence: () => Promise<Response>): {
  env: Env;
  events: Array<{ route: string; eventType: string; targetId: string; detail: Record<string, unknown> }>;
} {
  const events: Array<{ route: string; eventType: string; targetId: string; detail: Record<string, unknown> }> = [];
  const env = {
    CHAT_ROOM: {
      idFromName(channelId: string) {
        return channelId;
      },
      get() {
        return { fetch: fetchPresence };
      },
    },
    DB: {
      prepare() {
        return {
          bind(...params: unknown[]) {
            return {
              async run() {
                events.push({
                  route: String(params[2]),
                  eventType: String(params[3]),
                  targetId: String(params[6]),
                  detail: JSON.parse(String(params[7])) as Record<string, unknown>,
                });
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  } as unknown as Env;
  return { env, events };
}

test("init returns the Durable Object presence count when available", async () => {
  const { env, events } = createPresenceEnv(async () => Response.json({ count: 7 }));

  assert.equal(await readInitPresenceCount(env, "channel-a"), 7);
  assert.deepEqual(events, []);
});

test("init degrades to zero presence and records Durable Object failures", async () => {
  const { env, events } = createPresenceEnv(async () => {
    throw new Error("Internal error in Durable Object storage caused object to be reset");
  });

  assert.equal(await readInitPresenceCount(env, "channel-a"), 0);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    route: "GET /api/init",
    eventType: "realtime_unavailable",
    targetId: "channel-a",
    detail: {
      route_stage: "load_presence",
      request_channel_id: "channel-a",
      error: "Internal error in Durable Object storage caused object to be reset",
    },
  });
});

test("init rejects malformed presence responses without failing bootstrap", async () => {
  const { env, events } = createPresenceEnv(async () => Response.json({ count: "unknown" }));

  assert.equal(await readInitPresenceCount(env, "channel-a"), 0);
  assert.equal(events[0]?.eventType, "realtime_unavailable");
  assert.equal(events[0]?.detail.error, "presence response was invalid");
});
