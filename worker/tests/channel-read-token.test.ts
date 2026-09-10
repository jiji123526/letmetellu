import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createAnonymousIdentity } from "../src/lib/anonymous-identity.ts";
import {
  authorizeChannelReadToken,
  channelReadMatchesPlacement,
  createChannelAccessToken,
  createChannelReadToken,
} from "../src/lib/channel-read-token.ts";
import type { Env } from "../src/types.ts";

const env = { INTERNAL_SECRET: "channel-read-test-secret" } as Env;
const placement = {
  partitionKey: "channel-a",
  shardId: "primary",
  placementVersion: 1,
};
const channel = {
  id: "channel-a",
  owner_uid: "owner-a",
  name: "Channel A",
  profile_image: null,
  bubble_color: "#3598fe",
  notice: null,
  is_frozen: 0,
  created_at: "2026-09-06T00:00:00.000Z",
  passcode_hint: null,
  instance_id: null,
  show_on_profile: 1,
  background_type: "default",
  background_color: null,
  background_image: null,
  background_overlay: 14,
  background_blur: 0,
  owner_name: "Owner A",
  moderation_status: "active",
  moderation_petition_status: "none",
  owner_channel_count: 1,
  has_passcode: false,
};

test("owner read capabilities are bound to channel and authenticated user", async () => {
  const token = await createChannelReadToken({
    channelId: "channel-a",
    viewer: "owner",
    subject: "owner-a",
    sensitive: true,
    channel,
    placement,
    env,
  });
  const authorized = await authorizeChannelReadToken(new Request("https://example.test", {
    headers: {
      "X-Channel-Read-Token": token,
      "X-Internal-Token": env.INTERNAL_SECRET,
      "X-User-Id": "owner-a",
    },
  }), "channel-a", env, placement);
  assert.equal(authorized?.version, 3);
  assert.equal(authorized?.viewer, "owner");

  const wrongUser = await authorizeChannelReadToken(new Request("https://example.test", {
    headers: {
      "X-Channel-Read-Token": token,
      "X-Internal-Token": env.INTERNAL_SECRET,
      "X-User-Id": "owner-b",
    },
  }), "channel-a", env, placement);
  assert.equal(wrongUser, null);
  assert.equal(await authorizeChannelReadToken(new Request("https://example.test", {
    headers: {
      "X-Channel-Read-Token": token,
      "X-Internal-Token": env.INTERNAL_SECRET,
      "X-User-Id": "owner-a",
    },
  }), "channel-b", env, {
    ...placement,
    partitionKey: "channel-b",
  }), null);
});

test("visitor read capabilities require the matching signed anonymous identity", async () => {
  const visitor = await createAnonymousIdentity(env, "visitor-a");
  const other = await createAnonymousIdentity(env, "visitor-b");
  const token = await createChannelReadToken({
    channelId: "channel-a",
    viewer: "visitor",
    subject: visitor.uid,
    sensitive: false,
    channel,
    placement,
    env,
  });
  const request = (anonymousToken: string) => new Request("https://example.test", {
    headers: {
      "X-Channel-Read-Token": token,
      "X-Anonymous-Token": anonymousToken,
    },
  });
  assert.equal(
    (await authorizeChannelReadToken(
      request(visitor.token),
      "channel-a",
      env,
      placement,
    ))?.subject,
    visitor.uid,
  );
  assert.equal(
    await authorizeChannelReadToken(
      request(other.token),
      "channel-a",
      env,
      placement,
    ),
    null,
  );
});

test("access-only capabilities authorize subsequent reads without carrying channel presentation", async () => {
  const visitor = await createAnonymousIdentity(env, "visitor-access-token");
  const token = await createChannelAccessToken({
    channelId: "channel-a",
    viewer: "visitor",
    subject: visitor.uid,
    sensitive: false,
    placement,
    env,
  });
  const authorized = await authorizeChannelReadToken(new Request("https://example.test", {
    headers: {
      "X-Channel-Read-Token": token,
      "X-Anonymous-Token": visitor.token,
    },
  }), "channel-a", env, placement);
  assert.equal(authorized?.version, 4);
  assert.equal(authorized?.viewer, "visitor");
  assert.equal("channel" in (authorized || {}), false);
});

test("placement-aware capabilities reject a different shard or version", async () => {
  const visitor = await createAnonymousIdentity(env, "visitor-placement");
  const token = await createChannelAccessToken({
    channelId: "channel-a",
    viewer: "visitor",
    subject: visitor.uid,
    sensitive: false,
    placement,
    env,
  });
  const request = new Request("https://example.test", {
    headers: {
      "X-Channel-Read-Token": token,
      "X-Anonymous-Token": visitor.token,
    },
  });

  assert.equal(
    await authorizeChannelReadToken(request, "channel-a", env, {
      ...placement,
      shardId: "chat-b",
    }),
    null,
  );
  assert.equal(
    await authorizeChannelReadToken(request, "channel-a", env, {
      ...placement,
      placementVersion: 2,
    }),
    null,
  );
});

test("legacy capabilities are accepted only on the original primary placement", () => {
  const legacy = {
    type: "channel-read" as const,
    version: 2 as const,
    channel_id: "channel-a",
    viewer: "visitor" as const,
    subject: "visitor-a",
    iat: 1,
    exp: 2,
  };

  assert.equal(channelReadMatchesPlacement(legacy, placement), true);
  assert.equal(channelReadMatchesPlacement(legacy, {
    ...placement,
    shardId: "chat-b",
  }), false);
  assert.equal(channelReadMatchesPlacement(legacy, {
    ...placement,
    placementVersion: 2,
  }), false);
});

test("token issuance rejects a placement for another channel", async () => {
  await assert.rejects(
    createChannelAccessToken({
      channelId: "channel-a",
      viewer: "visitor",
      subject: "visitor-a",
      sensitive: false,
      placement: {
        ...placement,
        partitionKey: "channel-b",
      },
      env,
    }),
    /placement is invalid or does not match channel/,
  );
});

test("token issuance rejects an invalid placement version", async () => {
  await assert.rejects(
    createChannelAccessToken({
      channelId: "channel-a",
      viewer: "visitor",
      subject: "visitor-a",
      sensitive: false,
      placement: {
        ...placement,
        placementVersion: 0,
      },
      env,
    }),
    /placement is invalid or does not match channel/,
  );
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
  const timelineProxySource = readFileSync(
    new URL("../../src/app/api/unified-timeline/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(initSource, /!reportsChannel && !isPlatformAdminViewer/);
  assert.match(dataSource, /const CHANNEL_READ_TOKEN_TYPES = new Set/);
  assert.doesNotMatch(dataSource, /CHANNEL_READ_TOKEN_TYPES[\s\S]{0,250}"dm"/);
  assert.match(timelineSource, /authorizeChannelReadToken\(request, channelId, env, resolvedDatabase\)/);
  assert.match(timelineSource, /createChannelAccessToken\(/);
  assert.match(dataSource, /createChannelAccessToken\(/);
  assert.match(initSource, /isChannelReadSnapshot\(authorizedChannelRead\)/);
  assert.match(cookieSource, /httpOnly: true/);
  assert.match(cookieSource, /sameSite: "lax"/);
  assert.match(initProxySource, /res\.headers\.get\("X-Channel-Read-Token"\)/);
  assert.doesNotMatch(initSource, /channelReadToken,\s*anonymousUid/);
  assert.match(dataProxySource, /readIdentityTokens\(/);
  assert.match(dataProxySource, /request\.headers\.get\("X-Anonymous-Token"\) \|\| cookieAnonymousToken/);
  assert.match(dataProxySource, /setChannelReadTokenCookie\(/);
  assert.match(timelineProxySource, /setChannelReadTokenCookie\(/);
});
