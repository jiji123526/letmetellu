import { auth } from "@/lib/auth";
import { readIdentityTokens } from "@/lib/anonymous-identity-cookie";
import { signProtectedMediaInPayload } from "@/lib/media-access-token";
import { readRoomTokenCookie } from "@/lib/room-token-cookie";
import { NextResponse } from "next/server";
import {
  readChannelReadTokenCookie,
  setChannelReadTokenCookie,
} from "@/lib/channel-read-token-cookie";

function roundedDuration(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

function getParentChannelId(channelId: string) {
  return channelId.endsWith("_live")
    ? channelId.replace(/_live$/, "")
    : channelId;
}

export async function GET(request: Request) {
  const requestStartedAt = performance.now();
  const authStartedAt = performance.now();
  const session = await auth();
  const authMs = roundedDuration(authStartedAt);
  const incomingUrl = new URL(request.url);
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
  const targetUrl = new URL("/api/unified-timeline", workerUrl);
  incomingUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session?.user?.id) {
    headers["X-Internal-Token"] = process.env.INTERNAL_SECRET || "";
    headers["X-User-Id"] = session.user.id;
  }

  const channelId = incomingUrl.searchParams.get("channel") || "";
  const parentChannelId = channelId ? getParentChannelId(channelId) : "";
  const roomToken = request.headers.get("X-Room-Token")
    || (parentChannelId
      ? readRoomTokenCookie(request.headers.get("cookie"), parentChannelId)
      : null);
  if (roomToken) headers["X-Room-Token"] = roomToken;

  const { anonymousToken } = readIdentityTokens(request.headers.get("cookie"));
  const forwardedAnonymousToken = request.headers.get("X-Anonymous-Token") || anonymousToken;
  if (forwardedAnonymousToken) headers["X-Anonymous-Token"] = forwardedAnonymousToken;
  const channelReadToken = channelId
    ? readChannelReadTokenCookie(request.headers.get("cookie"), channelId)
    : null;
  if (channelReadToken) headers["X-Channel-Read-Token"] = channelReadToken;

  const workerStartedAt = performance.now();
  const response = await fetch(targetUrl, { headers, cache: "no-store" });
  const payload = await response.json();
  const workerMs = roundedDuration(workerStartedAt);
  const signingStartedAt = performance.now();
  const signedPayload = await signProtectedMediaInPayload(payload, {
    roomToken,
    userId: session?.user?.id,
  });
  const signingMs = roundedDuration(signingStartedAt);
  const nextResponse = NextResponse.json(signedPayload, { status: response.status });
  nextResponse.headers.set("Server-Timing", [
    `auth;dur=${authMs}`,
    `worker;dur=${workerMs}`,
    `media-signing;dur=${signingMs}`,
    `total;dur=${roundedDuration(requestStartedAt)}`,
  ].join(", "));
  const workerTiming = response.headers.get("X-Yap-Worker-Timing");
  if (workerTiming) nextResponse.headers.set("X-Yap-Worker-Timing", workerTiming);
  const nextChannelReadToken = response.headers.get("X-Channel-Read-Token");
  if (nextChannelReadToken && channelId) {
    setChannelReadTokenCookie(nextResponse, request, channelId, nextChannelReadToken);
  }
  return nextResponse;
}
