import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getTrustedUserId,
  isTrustedInternalRequest,
} from "../src/lib/trusted-identity.ts";
import type { Env } from "../src/types.ts";

const adminSource = readFileSync(new URL("../src/routes/admin.ts", import.meta.url), "utf8");
const initSource = readFileSync(new URL("../src/routes/init.ts", import.meta.url), "utf8");
const dataSource = readFileSync(new URL("../src/routes/data.ts", import.meta.url), "utf8");
const messagesSource = readFileSync(new URL("../src/routes/messages.ts", import.meta.url), "utf8");
const dmSource = readFileSync(new URL("../src/routes/dm.ts", import.meta.url), "utf8");
const unifiedTimelineSource = readFileSync(new URL("../src/routes/unified-timeline.ts", import.meta.url), "utf8");
const socketAuthSource = readFileSync(new URL("../src/routes/socket-auth.ts", import.meta.url), "utf8");
const supportSource = readFileSync(new URL("../src/routes/support.ts", import.meta.url), "utf8");
const reportsSource = readFileSync(new URL("../src/routes/channel-reports.ts", import.meta.url), "utf8");
const userSource = readFileSync(new URL("../src/routes/user.ts", import.meta.url), "utf8");

const env = { INTERNAL_SECRET: "test-internal-secret" } as Env;

test("trusted identity requires the internal proxy secret", () => {
  const forged = new Request("https://api.example.test", {
    headers: { "X-User-Id": "victim-user" },
  });
  assert.equal(isTrustedInternalRequest(forged, env), false);
  assert.equal(getTrustedUserId(forged, env), null);
});

test("trusted identity requires a user id in addition to the proxy secret", () => {
  const missingUser = new Request("https://api.example.test", {
    headers: { "X-Internal-Token": env.INTERNAL_SECRET },
  });
  assert.equal(isTrustedInternalRequest(missingUser, env), true);
  assert.equal(getTrustedUserId(missingUser, env), null);
});

test("trusted identity accepts the proxy-asserted user only with both headers", () => {
  const trusted = new Request("https://api.example.test", {
    headers: {
      "X-Internal-Token": env.INTERNAL_SECRET,
      "X-User-Id": "verified-user",
    },
  });
  assert.equal(getTrustedUserId(trusted, env), "verified-user");
});

test("privileged channel boundaries use the shared trusted identity helper", () => {
  assert.match(adminSource, /isTrustedInternalRequest\(request, env\)/);
  assert.match(dataSource, /getTrustedUserId\(request, env\)/);
  assert.match(socketAuthSource, /getTrustedUserId\(request, env\)/);
  assert.match(supportSource, /return getTrustedUserId\(request, env\)/);
  assert.match(reportsSource, /const userId = getTrustedUserId\(request, env\)/);
  assert.match(reportsSource, /const verifiedUserId = getTrustedUserId\(request, env\)/);
});

test("channel owner and platform admin checks remain server-side", () => {
  assert.match(adminSource, /channel\.owner_uid !== userId/);
  assert.match(dataSource, /const isOwner = trustedUserId === owner_uid/);
  assert.match(socketAuthSource, /const isOwner = trustedUserId === channel\.owner_uid/);
  assert.match(supportSource, /isReportsChannelOwner\(userId, env\)/);
  assert.match(reportsSource, /isReportsChannelOwner\(userId, env\)/);
});

test("owner-only collections are denied before their data switch", () => {
  const boundary = dataSource.indexOf('type === "blocked" || type === "dm" || type === "banned-words"');
  const routeSwitch = dataSource.indexOf("switch (type)");
  assert.ok(boundary >= 0);
  assert.ok(routeSwitch > boundary);
  assert.match(dataSource.slice(boundary, routeSwitch), /if \(!isOwner\)/);
});

test("platform admin passcode bypass remains read-only and server-verified", () => {
  assert.match(initSource, /await isPlatformAdmin\(trustedUserId, env\)/);
  assert.match(dataSource, /await isPlatformAdmin\(trustedUserId, env\)/);
  assert.match(unifiedTimelineSource, /await isPlatformAdmin\(trustedUserId, env\)/);
  assert.match(dataSource, /type === "blocked" \|\| type === "dm" \|\| type === "banned-words"/);
  assert.doesNotMatch(messagesSource, /\bisPlatformAdmin\b/);
  assert.doesNotMatch(dmSource, /\bisPlatformAdmin\b/);
});

test("account preference writes still require the internal proxy secret", () => {
  const patchStart = userSource.indexOf('if (request.method === "PATCH")');
  const deleteStart = userSource.indexOf('if (request.method === "DELETE")');
  assert.ok(patchStart >= 0 && deleteStart > patchStart);
  assert.match(
    userSource.slice(patchStart, deleteStart),
    /request\.headers\.get\("X-Internal-Token"\) !== env\.INTERNAL_SECRET/,
  );
});
