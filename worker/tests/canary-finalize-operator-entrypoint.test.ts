import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import canaryFinalizeOperator from "../src/canary-finalize-operator.ts";
import type { Env } from "../src/types.ts";

test("isolated finalize operator exposes only the hidden frozen-delta path", async () => {
  const env = {} as Env;
  const unknown = await canaryFinalizeOperator.fetch(
    new Request("https://operator.example/api/init"),
    env,
  );
  assert.equal(unknown.status, 404);
  assert.equal(unknown.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(unknown.headers.get("Cache-Control"), "no-store");

  const hiddenDelta = await canaryFinalizeOperator.fetch(
    new Request("https://operator.example/internal/d1-canary/message-delta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", shard: "canary-a", channel: "zziks" }),
    }),
    env,
  );
  assert.equal(hiddenDelta.status, 404);
  assert.equal(hiddenDelta.headers.get("X-Frame-Options"), "DENY");
});

test("isolated finalize operator cannot serve application traffic or dispatch projections", () => {
  const config = readFileSync(
    new URL("../wrangler.channel-zziks-finalize.toml", import.meta.url),
    "utf8",
  );
  const entrypoint = readFileSync(
    new URL("../src/canary-finalize-operator.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    config,
    /\[triggers\]|\[\[routes\]\]|ALLOWED_ORIGIN|D1_CANARY_PROJECTION_DISPATCH_ENABLED/,
  );
  assert.doesNotMatch(config, /D1_CANARY_FINALIZE_TOKEN/);
  assert.doesNotMatch(config, /CHAT_ROOM|MEDIA/);
  assert.match(config, /WRITE_MAINTENANCE_MODE = "true"/);
  assert.match(entrypoint, /handleCanaryMessageDelta/);
  assert.doesNotMatch(
    entrypoint,
    /handleMessages|handleInit|handleCanaryProjectionDispatchOnce|handleCanaryChannelCopyMutation/,
  );
  assert.doesNotMatch(entrypoint, /Access-Control-Allow-Origin",\s*"/);
});
