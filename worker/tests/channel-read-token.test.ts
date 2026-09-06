import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createAnonymousIdentity } from "../src/lib/anonymous-identity.ts";
import {
  authorizeChannelReadToken,
  createChannelReadToken,
} from "../src/lib/channel-read-token.ts";
import type { Env } from "../src/types.ts";

const env = { INTERNAL_SECRET: "channel-read-test-secret" } as Env;

test("owner read capabilities are bound to channel and authenticated user", async () => {
  const token = await createChannelReadToken({
    channelId: "channel-a",
    viewer: "owner",
    subject: "owner-a",
    sensitive: true,
    env,
  });
  const authorized = await authorizeChannelReadToken(new Request("https://example.test", {
    headers: {
      "X-Channel-Read-Token": token,
      "X-Internal-Token": env.INTERNAL_SECRET,
      "X-User-Id": "owner-a",
    },
  }), "channel-a", env);
  assert.equal(authorized?.viewer, "owner");

  const wrongUser = await authorizeChannelReadToken(new Request("https://example.test", {
    headers: {
      "X-Channel-Read-Token": token,
      "X-Internal-Token": env.INTERNAL_SECRET,
      "X-User-Id": "owner-b",
    },
  }), "channel-a", env);
  assert.equal(wrongUser, null);
  assert.equal(await authorizeChannelReadToken(new Request("https://example.test", {
    headers: {
      "X-Channel-Read-Token": token,
      "X-Internal-Token": env.INTERNAL_SECRET,
      "X-User-Id": "owner-a",
    },
  }), "channel-b", env), null);
});

test("visitor read capabilities require the matching signed anonymous identity", async () => {
  const visitor = await createAnonymousIdentity(env, "visitor-a");
  const other = await createAnonymousIdentity(env, "visitor-b");
  const token = await createChannelReadToken({
    channelId: "channel-a",
    viewer: "visitor",
    subject: visitor.uid,
    sensitive: false,
    env,
  });
  const request = (anonymousToken: string) => new Request("https://example.test", {
    headers: {
      "X-Channel-Read-Token": token,
      "X-Anonymous-Token": anonymousToken,
    },
  });
  assert.equal(
    (await authorizeChannelReadToken(request(visitor.token), "channel-a", env))?.subject,
    visitor.uid,
  );
  assert.equal(await authorizeChannelReadToken(request(other.token), "channel-a", env), null);
});

test("read capabilities stay confined to read-only routes and HttpOnly cookies", () => {
  const initSource = readFileSync(new URL("../src/routes/init.ts", import.meta.url), "utf8");
  const dataSource = readFileSync(new URL("../src/routes/data.ts", import.meta.url), "utf8");
  const timelineSource = readFileSync(new URL("../src/routes/unified-timeline.ts", import.meta.url), "utf8");
  const cookieSource = readFileSync(
    new URL("../../src/lib/channel-read-token-cookie.ts", import.meta.url),
    "utf8",
  );
  const initProxySource = readFileSync(new URL("../../src/app/api/init/route.ts", import.meta.url), "utf8");
  const dataProxySource = readFileSync(new URL("../../src/app/api/data/route.ts", import.meta.url), "utf8");

  assert.match(initSource, /!reportsChannel && !isPlatformAdminViewer/);
  assert.match(dataSource, /const CHANNEL_READ_TOKEN_TYPES = new Set/);
  assert.doesNotMatch(dataSource, /CHANNEL_READ_TOKEN_TYPES[\s\S]{0,250}"dm"/);
  assert.match(timelineSource, /authorizeChannelReadToken\(request, channelId, env\)/);
  assert.match(cookieSource, /httpOnly: true/);
  assert.match(cookieSource, /sameSite: "lax"/);
  assert.match(initProxySource, /res\.headers\.get\("X-Channel-Read-Token"\)/);
  assert.doesNotMatch(initSource, /channelReadToken,\s*anonymousUid/);
  assert.match(dataProxySource, /readIdentityTokens\(/);
  assert.match(dataProxySource, /request\.headers\.get\("X-Anonymous-Token"\) \|\| cookieAnonymousToken/);
});
