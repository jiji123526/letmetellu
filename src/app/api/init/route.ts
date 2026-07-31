import { auth } from "@/lib/auth";
import { readIdentityTokens, setIdentityCookies } from "@/lib/anonymous-identity-cookie";
import { signProtectedMediaInPayload } from "@/lib/media-access-token";
import { readRoomTokenCookie, setRoomTokenResponseCookie } from "@/lib/room-token-cookie";
import { NextResponse } from "next/server";

function getParentChannelId(channelId: string) {
  return channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
}

// Init proxy for authenticated users — forwards session identity to Worker
// Worker can use this to bypass passcode gate for channel owners
export async function GET(request: Request) {
  const session = await auth();
  const url = new URL(request.url);
  const channel = url.searchParams.get("channel");

  if (!channel) {
    return NextResponse.json({ error: "missing channel" }, { status: 400 });
  }

  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  // If user is logged in, include auth headers for owner bypass
  if (session?.user?.id) {
    headers["X-Internal-Token"] = process.env.INTERNAL_SECRET || "";
    headers["X-User-Id"] = session.user.id;
  }

  const parentChannelId = getParentChannelId(channel);
  const roomToken = request.headers.get("X-Room-Token")
    || readRoomTokenCookie(request.headers.get("cookie"), parentChannelId);
  if (roomToken) {
    headers["X-Room-Token"] = roomToken;
  }

  const { anonymousToken, deviceToken } = readIdentityTokens(request.headers.get("cookie"));
  if (anonymousToken) headers["X-Anonymous-Token"] = anonymousToken;
  if (deviceToken) headers["X-Device-Token"] = deviceToken;

  const res = await fetch(`${workerUrl}/api/init?channel=${channel}`, { headers });
  const data = await res.json() as Record<string, unknown>;
  const nextAnonymousToken = typeof data.anonymousToken === "string" ? data.anonymousToken : null;
  const nextDeviceToken = typeof data.deviceToken === "string" ? data.deviceToken : null;
  const nextRoomToken = typeof data.roomToken === "string" ? data.roomToken : null;

  delete data.anonymousToken;
  delete data.deviceToken;
  delete data.roomToken;
  const signedData = await signProtectedMediaInPayload(data);

  const response = NextResponse.json(signedData, { status: res.status });
  setIdentityCookies(response, request, {
    anonymousToken: nextAnonymousToken,
    deviceToken: nextDeviceToken,
  });
  if (nextRoomToken) {
    setRoomTokenResponseCookie(response, request, parentChannelId, nextRoomToken);
  }

  return response;
}
