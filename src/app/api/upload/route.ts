import { auth } from "@/lib/auth";
import { readIdentityTokens } from "@/lib/anonymous-identity-cookie";
import { readRoomTokenCookie } from "@/lib/room-token-cookie";
import { NextResponse } from "next/server";

function getParentChannelId(channelId: string) {
  return channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
}

export async function POST(request: Request) {
  const session = await auth();
  const anonymousMode = request.headers.get("X-Auth-Mode") === "anonymous";

  const requestUrl = new URL(request.url);
  const channelId = requestUrl.searchParams.get("channel");
  const purpose = requestUrl.searchParams.get("purpose") || "channel-asset";
  if (!channelId) {
    return NextResponse.json({ error: "missing channel" }, { status: 400 });
  }
  if (!["message", "dm", "channel-asset"].includes(purpose)) {
    return NextResponse.json({ error: "invalid purpose" }, { status: 400 });
  }
  const contentType = request.headers.get("Content-Type") || "";
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(contentType)) {
    return NextResponse.json({ error: "invalid file type" }, { status: 400 });
  }
  if (contentLength > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }

  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientIp = forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    ...(contentLength > 0 ? { "Content-Length": String(contentLength) } : {}),
    ...(clientIp ? { "X-Client-IP": clientIp } : {}),
  };

  const { anonymousToken, deviceToken } = readIdentityTokens(request.headers.get("cookie"));
  if (anonymousToken) headers["X-Anonymous-Token"] = anonymousToken;
  if (deviceToken) headers["X-Device-Token"] = deviceToken;

  const parentChannelId = getParentChannelId(channelId);
  const roomToken = request.headers.get("X-Room-Token")
    || readRoomTokenCookie(request.headers.get("cookie"), parentChannelId);
  if (roomToken) headers["X-Room-Token"] = roomToken;

  if (session?.user?.id && !anonymousMode) {
    headers["X-Internal-Token"] = process.env.INTERNAL_SECRET || "";
    headers["X-User-Id"] = session.user.id;
  } else if (session?.user?.id && anonymousMode) {
    headers["X-Internal-Token"] = process.env.INTERNAL_SECRET || "";
    headers["X-Authenticated-User-Id"] = session.user.id;
  }

  if (!request.body) {
    return NextResponse.json({ error: "missing body" }, { status: 400 });
  }
  const uploadRequest: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers,
    body: request.body,
    duplex: "half",
    cache: "no-store",
  };
  const response = await fetch(
    `${workerUrl}/api/upload?channel=${encodeURIComponent(channelId)}&purpose=${encodeURIComponent(purpose)}`,
    uploadRequest,
  );
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
