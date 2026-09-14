import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import canaryPreflight from "../src/canary-preflight.ts";
import type { Env } from "../src/types.ts";

test("isolated preflight entrypoint exposes one hidden read-only path", async () => {
  const env = {} as Env;
  const unknown = await canaryPreflight.fetch(
    new Request("https://operator.example/api/init"),
    env,
  );
  assert.equal(unknown.status, 404);
  assert.equal(unknown.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(unknown.headers.get("Cache-Control"), "no-store");

  const hidden = await canaryPreflight.fetch(
    new Request("https://operator.example/internal/d1-canary/copy-preflight"
      + "?shard=canary-a&channel=10997"),
    env,
  );
  assert.equal(hidden.status, 404);
  assert.equal(hidden.headers.get("X-Frame-Options"), "DENY");
});

test("isolated preflight config cannot serve or mutate application traffic", () => {
  const config = readFileSync(
    new URL("../wrangler.channel-10997-preflight.toml", import.meta.url),
    "utf8",
  );
  const entrypoint = readFileSync(
    new URL("../src/canary-preflight.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(config, /\[triggers\]|\[\[routes\]\]|ALLOWED_ORIGIN|WRITE_MAINTENANCE_MODE/);
  assert.doesNotMatch(config, /D1_CANARY_OPERATOR_TOKEN/);
  assert.doesNotMatch(config, /CHAT_ROOM|MEDIA/);
  assert.doesNotMatch(entrypoint, /handleCanaryChannelCopyMutation|handleMessages|handleInit/);
  assert.match(entrypoint, /pathname !== "\/internal\/d1-canary\/copy-preflight"/);
  assert.doesNotMatch(entrypoint, /Access-Control-Allow-Origin",\s*"/);
});
