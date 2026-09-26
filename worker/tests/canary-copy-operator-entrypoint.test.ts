import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import canaryCopyOperator from "../src/canary-copy-operator.ts";
import type { Env } from "../src/types.ts";

test("isolated copy operator exposes only hidden canary copy paths", async () => {
  const env = {} as Env;
  const unknown = await canaryCopyOperator.fetch(
    new Request("https://operator.example/api/init"),
    env,
  );
  assert.equal(unknown.status, 404);
  assert.equal(unknown.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(unknown.headers.get("Cache-Control"), "no-store");

  const hiddenCopy = await canaryCopyOperator.fetch(
    new Request("https://operator.example/internal/d1-canary/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", shard: "canary-a", channel: "zziks" }),
    }),
    env,
  );
  assert.equal(hiddenCopy.status, 404);
  assert.equal(hiddenCopy.headers.get("X-Frame-Options"), "DENY");
});

test("isolated copy operator cannot serve application traffic or broad bindings", () => {
  const config = readFileSync(
    new URL("../wrangler.channel-zziks-copy.toml", import.meta.url),
    "utf8",
  );
  const entrypoint = readFileSync(
    new URL("../src/canary-copy-operator.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    config,
    /\[triggers\]|\[\[routes\]\]|ALLOWED_ORIGIN|WRITE_MAINTENANCE_MODE|D1_CANARY_PROJECTION_DISPATCH_ENABLED/,
  );
  assert.doesNotMatch(
    config,
    /D1_CANARY_OPERATOR_TOKEN|D1_CANARY_COPY_TOKEN|D1_CANARY_CLEANUP_TOKEN/,
  );
  assert.doesNotMatch(config, /CHAT_ROOM|MEDIA/);
  assert.match(entrypoint, /handleCanaryChannelCopyPreflight/);
  assert.match(entrypoint, /handleCanaryChannelCopyMutation/);
  assert.match(entrypoint, /handleCanaryChannelCopyVerification/);
  assert.match(entrypoint, /handleCanaryChannelCopyCleanup/);
  assert.doesNotMatch(entrypoint, /handleMessages|handleInit|handleCanaryMessageDelta|handleCanaryProjectionDispatchOnce/);
  assert.doesNotMatch(entrypoint, /Access-Control-Allow-Origin",\s*"/);
});
