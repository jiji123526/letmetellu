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
  if (session?.user?.id) {
    const ownerRes = await fetch(`${workerUrl}/api/init?channel=${channelId}`, {
      headers: {
        "X-Internal-Token": process.env.INTERNAL_SECRET || "",
        "X-User-Id": session.user.id,
      },
      cache: "no-store",
    });
    const ownerData = await ownerRes.json() as { channel?: { owner_uid: string }; viewerAccess?: "owner" | "reports_owner" | "standard" };
    if (ownerRes.ok && ownerData.channel) {
      if (ownerData.viewerAccess === "owner" && ownerData.channel.owner_uid === session.user.id) {
        const token = await createWsToken("admin-ws", channelId, session.user.id);
        return NextResponse.json({ token, mode: "admin" });
      }
      if (ownerData.viewerAccess === "reports_owner") {
        const token = await createWsToken("viewer-ws", channelId, session.user.id);
        return NextResponse.json({ token, mode: "viewer" });
      }
    }
  }

  const parentChannelId = getParentChannelId(channelId);
  const roomToken = readRoomTokenCookie(request.headers.get("cookie"), parentChannelId);
  if (!roomToken) {
    return new NextResponse(null, { status: 204 });
  }

  const { anonymousToken, deviceToken } = readIdentityTokens(request.headers.get("cookie"));
  const headers: Record<string, string> = { "X-Room-Token": roomToken };
  if (anonymousToken) headers["X-Anonymous-Token"] = anonymousToken;
  if (deviceToken) headers["X-Device-Token"] = deviceToken;

  const roomRes = await fetch(`${workerUrl}/api/init?channel=${channelId}`, {
    headers,
    cache: "no-store",
  });
  const roomData = await roomRes.json().catch(() => ({})) as {
    channel?: { id: string };
    anonymousUid?: string;
    anonymousToken?: string;
    deviceToken?: string;
  };
  if (!roomRes.ok || !roomData.channel) {
    const response = NextResponse.json({ error: "not authorized" }, { status: 403 });
    clearRoomTokenResponseCookie(response, request, parentChannelId);
    return response;
  }

  const token = await createWsToken(
    "room-viewer-ws",
    channelId,
    typeof roomData.anonymousUid === "string" && roomData.anonymousUid ? roomData.anonymousUid : "viewer",
  );
  const response = NextResponse.json({ token, mode: "room" });
  setIdentityCookies(response, request, {
    anonymousToken: typeof roomData.anonymousToken === "string" ? roomData.anonymousToken : null,
    deviceToken: typeof roomData.deviceToken === "string" ? roomData.deviceToken : null,
  });
  return response;
}
