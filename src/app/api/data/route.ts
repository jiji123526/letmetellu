import { auth } from "@/lib/auth";
import { readRoomTokenCookie } from "@/lib/room-token-cookie";
import { NextResponse } from "next/server";

function getParentChannelId(channelId: string) {
  return channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
}

// Authenticated data proxy. Channel owners are identified from the server-side
// session; non-admin viewers continue to use their channel-bound room token.
export async function GET(request: Request) {
  const session = await auth();
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

  const response = await fetch(targetUrl, { headers, cache: "no-store" });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
