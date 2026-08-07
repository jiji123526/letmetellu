import { auth } from "@/lib/auth";
import { readIdentityTokens, setIdentityCookies } from "@/lib/anonymous-identity-cookie";
import { clearRoomTokenResponseCookie, readRoomTokenCookie } from "@/lib/room-token-cookie";
import { NextResponse } from "next/server";

function encodeBase64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Buffer.from(bytes).toString("base64url");
}

async function createWsToken(
  type: "admin-ws" | "viewer-ws" | "room-viewer-ws",
  channelId: string,
  userId: string,
): Promise<string> {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret) throw new Error("INTERNAL_SECRET is not configured");

  const payload = encodeBase64Url(JSON.stringify({
    type,
    channel_id: channelId,
    user_id: userId,
    exp: Math.floor(Date.now() / 1000) + 5 * 60,
  }));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `${payload}.${encodeBase64Url(signature)}`;
}

function getParentChannelId(channelId: string) {
  return channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
}

// Returns the WebSocket auth token for verified channel owners
// This token is used to authenticate as admin on the DO WebSocket
export async function GET(request: Request) {
  const session = await auth();
  const url = new URL(request.url);
  const channelId = url.searchParams.get("channel");
  if (!channelId) {
    return NextResponse.json({ error: "missing channel" }, { status: 400 });
  }

  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
  const parentChannelId = getParentChannelId(channelId);
  const roomToken = readRoomTokenCookie(request.headers.get("cookie"), parentChannelId);
  if (!session?.user?.id && !roomToken) {
    return new NextResponse(null, { status: 204 });
  }

  const { anonymousToken, deviceToken } = readIdentityTokens(request.headers.get("cookie"));
  const headers: Record<string, string> = {};
  if (session?.user?.id) {
    headers["X-Internal-Token"] = process.env.INTERNAL_SECRET || "";
    headers["X-User-Id"] = session.user.id;
  }
  if (roomToken) headers["X-Room-Token"] = roomToken;
  if (anonymousToken) headers["X-Anonymous-Token"] = anonymousToken;
  if (deviceToken) headers["X-Device-Token"] = deviceToken;

  const authRes = await fetch(`${workerUrl}/api/socket-auth?channel=${channelId}`, {
    headers,
    cache: "no-store",
  });
  if (authRes.status === 204) {
    return new NextResponse(null, { status: 204 });
  }
  const authData = await authRes.json().catch(() => ({})) as {
    mode?: "admin" | "viewer" | "room";
    userId?: string;
    anonymousUid?: string;
    anonymousToken?: string;
    deviceToken?: string;
  };
  if (!authRes.ok || !authData.mode || !authData.userId) {
    const response = NextResponse.json({ error: "not authorized" }, { status: 403 });
    clearRoomTokenResponseCookie(response, request, parentChannelId);
    return response;
  }

  const tokenType = authData.mode === "admin"
    ? "admin-ws"
    : authData.mode === "viewer"
      ? "viewer-ws"
      : "room-viewer-ws";
  const token = await createWsToken(tokenType, channelId, authData.userId);
  const response = NextResponse.json({ token, mode: authData.mode });
  setIdentityCookies(response, request, {
    anonymousToken: typeof authData.anonymousToken === "string" ? authData.anonymousToken : null,
    deviceToken: typeof authData.deviceToken === "string" ? authData.deviceToken : null,
  });
  return response;
}
