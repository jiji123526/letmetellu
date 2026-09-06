import { auth } from "@/lib/auth";
import { signProtectedMediaInPayload } from "@/lib/media-access-token";
import { readRoomTokenCookie } from "@/lib/room-token-cookie";
import { readIdentityTokens } from "@/lib/anonymous-identity-cookie";
import { NextResponse } from "next/server";
import { readChannelReadTokenCookie } from "@/lib/channel-read-token-cookie";

function roundedDuration(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

function getParentChannelId(channelId: string) {
  return channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
}

// Authenticated data proxy. Channel owners are identified from the server-side
// session; non-admin viewers continue to use their channel-bound room token.
export async function GET(request: Request) {
  const requestStartedAt = performance.now();
  const authStartedAt = performance.now();
  const session = await auth();
  const authMs = roundedDuration(authStartedAt);
  const incomingUrl = new URL(request.url);
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
  const targetUrl = new URL("/api/data", workerUrl);

  incomingUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.user?.id) {
    headers["X-Internal-Token"] = process.env.INTERNAL_SECRET || "";
    headers["X-User-Id"] = session.user.id;
  }

  const requestedChannelId = incomingUrl.searchParams.get("channel") || "";
  const parentChannelId = requestedChannelId ? getParentChannelId(requestedChannelId) : "";
  const roomToken = request.headers.get("X-Room-Token")
    || (parentChannelId ? readRoomTokenCookie(request.headers.get("cookie"), parentChannelId) : null);
  if (roomToken) headers["X-Room-Token"] = roomToken;
  const { anonymousToken: cookieAnonymousToken } = readIdentityTokens(
    request.headers.get("cookie"),
  );
  const anonymousToken = request.headers.get("X-Anonymous-Token") || cookieAnonymousToken;
  if (anonymousToken) headers["X-Anonymous-Token"] = anonymousToken;
  if (request.headers.get("X-Unified-Timeline-Shadow") === "1") {
    headers["X-Unified-Timeline-Shadow"] = "1";
  }
  const channelReadToken = requestedChannelId
    ? readChannelReadTokenCookie(request.headers.get("cookie"), requestedChannelId)
    : null;
  if (channelReadToken) headers["X-Channel-Read-Token"] = channelReadToken;

  const workerStartedAt = performance.now();
  const response = await fetch(targetUrl, { headers, cache: "no-store" });
  const data = await response.json();
  const workerMs = roundedDuration(workerStartedAt);
  const signingStartedAt = performance.now();
  const signedData = await signProtectedMediaInPayload(data, {
    roomToken,
    userId: session?.user?.id,
  });
  const signingMs = roundedDuration(signingStartedAt);
  const nextResponse = NextResponse.json(signedData, { status: response.status });
  nextResponse.headers.set("Server-Timing", [
    `auth;dur=${authMs}`,
    `worker;dur=${workerMs}`,
    `media-signing;dur=${signingMs}`,
    `total;dur=${roundedDuration(requestStartedAt)}`,
  ].join(", "));
  const workerTiming = response.headers.get("X-Yap-Worker-Timing");
  if (workerTiming) nextResponse.headers.set("X-Yap-Worker-Timing", workerTiming);
  const d1Meta = response.headers.get("X-Yap-D1-Meta");
  if (d1Meta) nextResponse.headers.set("X-Yap-D1-Meta", d1Meta);
  const shadowStatus = response.headers.get("X-Unified-Timeline-Shadow");
  if (shadowStatus) nextResponse.headers.set("X-Unified-Timeline-Shadow", shadowStatus);
  return nextResponse;
}
