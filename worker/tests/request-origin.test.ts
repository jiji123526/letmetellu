import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isAllowedRequestOrigin } from "../src/lib/request-origin.ts";

const productionOrigins = [
  "https://yapndot.com",
  "https://www.yapndot.com",
  "https://letmetellu.vercel.app",
].join(",");

test("request origin policy accepts only exact configured origins", () => {
  assert.equal(isAllowedRequestOrigin("https://yapndot.com", productionOrigins), true);
  assert.equal(isAllowedRequestOrigin("https://www.yapndot.com", productionOrigins), true);
  assert.equal(isAllowedRequestOrigin("https://evil.yapndot.com", productionOrigins), false);
  assert.equal(isAllowedRequestOrigin("https://yapndot.com.evil.example", productionOrigins), false);
});

test("request origin policy rejects missing and empty origins", () => {
  assert.equal(isAllowedRequestOrigin(null, productionOrigins), false);
  assert.equal(isAllowedRequestOrigin("", productionOrigins), false);
});

test("request origin policy trims configuration and supports development wildcard", () => {
  assert.equal(
    isAllowedRequestOrigin("http://localhost:3000", " https://yapndot.com , http://localhost:3000 "),
    true
  );
  assert.equal(isAllowedRequestOrigin("https://preview.example", "*"), true);
  assert.equal(isAllowedRequestOrigin(null, "*"), false);
});

test("worker checks WebSocket origin before Durable Object access", () => {
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const websocketBranch = source.indexOf('url.pathname.startsWith("/ws/")');
  const originCheck = source.indexOf("isAllowedRequestOrigin(request.headers.get(\"Origin\")", websocketBranch);
  const durableObjectAccess = source.indexOf("env.CHAT_ROOM.idFromName", websocketBranch);

  assert.ok(websocketBranch >= 0, "WebSocket route should exist");
  assert.ok(originCheck > websocketBranch, "WebSocket route should enforce the origin policy");
  assert.ok(durableObjectAccess > originCheck, "origin policy must run before Durable Object access");
});
