import { auth } from "@/lib/auth";
import { readIdentityTokens } from "@/lib/anonymous-identity-cookie";
import { signProtectedMediaInPayload } from "@/lib/media-access-token";
import { readRoomTokenCookie } from "@/lib/room-token-cookie";
import { NextResponse } from "next/server";

function getParentChannelId(channelId: string) {
  return channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
}

function workerHeaders(request: Request, userId?: string | null, channelId?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const { anonymousToken, deviceToken } = readIdentityTokens(request.headers.get("cookie"));
  if (anonymousToken) headers["X-Anonymous-Token"] = anonymousToken;
  if (deviceToken) headers["X-Device-Token"] = deviceToken;
  if (userId) {
    headers["X-Internal-Token"] = process.env.INTERNAL_SECRET || "";
    headers["X-User-Id"] = userId;
  }
  if (channelId) {
    const roomToken = request.headers.get("X-Room-Token")
      || readRoomTokenCookie(request.headers.get("cookie"), getParentChannelId(channelId));
    if (roomToken) headers["X-Room-Token"] = roomToken;
  }
  return headers;
}

export async function GET(request: Request) {
  const session = await auth();
  const url = new URL(request.url);
  const channel = url.searchParams.get("channel") || "";
  if (!channel) return NextResponse.json({ error: "missing channel" }, { status: 400 });

  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
  const response = await fetch(
    `${workerUrl}/api/dm?channel=${encodeURIComponent(channel)}`,
    { headers: workerHeaders(request, session?.user?.id, channel), cache: "no-store" },
  );
  const data = await response.json();
  const signedData = await signProtectedMediaInPayload(data, {
    roomToken: readRoomTokenCookie(request.headers.get("cookie"), getParentChannelId(channel)),
    userId: session?.user?.id,
  });
  return NextResponse.json(signedData, { status: response.status });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "owner access required" }, { status: 401 });
  }
  const body = await request.json();
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
  const response = await fetch(`${workerUrl}/api/dm`, {
    method: "PUT",
    headers: workerHeaders(request, session.user.id),
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
