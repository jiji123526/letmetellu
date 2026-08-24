import { auth } from "@/lib/auth";
import { readIdentityTokens } from "@/lib/anonymous-identity-cookie";
import { readRoomTokenCookie } from "@/lib/room-token-cookie";
import { NextResponse } from "next/server";

function getParentChannelId(channelId: string) {
  return channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
}

export async function POST(request: Request) {
  return forwardMessageRequest(request, "POST");
}

export async function PATCH(request: Request) {
  return forwardMessageRequest(request, "PATCH");
}

export async function PUT(request: Request) {
  return forwardMessageRequest(request, "PUT");
}

export async function DELETE(request: Request) {
  return forwardMessageRequest(request, "DELETE");
}

async function forwardMessageRequest(request: Request, method: "POST" | "PATCH" | "PUT" | "DELETE") {
  const session = await auth();
  const anonymousMode = request.headers.get("X-Auth-Mode") === "anonymous";
  const proxyTarget = request.headers.get("X-Proxy-Target") === "dm" ? "dm" : "messages";

  const rawBody = await request.json();
  const body = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody) && session?.user?.id && !anonymousMode
    ? { ...rawBody, uid: session.user.id }
    : rawBody;
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const { anonymousToken, deviceToken } = readIdentityTokens(request.headers.get("cookie"));
  if (anonymousToken) headers["X-Anonymous-Token"] = anonymousToken;
  if (deviceToken) headers["X-Device-Token"] = deviceToken;

  const channelId = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody) && typeof rawBody.channel_id === "string"
    ? getParentChannelId(rawBody.channel_id)
    : "";
  const roomToken = request.headers.get("X-Room-Token")
    || (channelId ? readRoomTokenCookie(request.headers.get("cookie"), channelId) : null);
  if (roomToken) headers["X-Room-Token"] = roomToken;

  if (session?.user?.id) {
    headers["X-Internal-Token"] = process.env.INTERNAL_SECRET || "";

    if (!anonymousMode) {
      headers["X-User-Id"] = session.user.id;
    }

    headers["X-Notification-Actor-User-Id"] = session.user.id;
  }

  const res = await fetch(`${workerUrl}/api/${proxyTarget}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
