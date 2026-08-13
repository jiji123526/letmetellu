import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const realtimeSource = readFileSync(
  new URL("../../src/hooks/useRealtime.ts", import.meta.url),
  "utf8",
);
const chatViewSource = readFileSync(
  new URL("../../src/components/chat/ChatView.tsx", import.meta.url),
  "utf8",
);
const socketTokenSource = readFileSync(
  new URL("../../src/app/api/ws-token/route.ts", import.meta.url),
  "utf8",
);
const providersSource = readFileSync(
  new URL("../../src/components/Providers.tsx", import.meta.url),
  "utf8",
);

test("chat socket lifecycle is bound to the current authenticated identity", () => {
  assert.match(
    realtimeSource,
    /export function useRealtime\([\s\S]*authenticatedUserId: string \| null/,
  );
  assert.match(
    realtimeSource,
    /const requestSocketAuthorization = useCallback[\s\S]*\[authenticatedUserId, channelId\]/,
  );
  assert.match(realtimeSource, /authenticated=\$\{expectedAuthentication\}/);
  assert.match(
    chatViewSource,
    /useRealtime\(\s*channelId,\s*uid,\s*authUserId,\s*\)/,
  );
  assert.match(socketTokenSource, /expectedAuthentication === "1" && !session\?\.user\?\.id/);
  assert.match(socketTokenSource, /expectedAuthentication === "0" && !!session\?\.user\?\.id/);
});

test("chat remains inside the cross-tab-aware Auth.js session provider", () => {
  assert.match(providersSource, /<SessionProvider>/);
});
