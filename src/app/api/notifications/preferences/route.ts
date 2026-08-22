import { auth } from "@/lib/auth";
import {
  addNotificationRoomToken,
  isSameOriginNotificationMutation,
  notificationWorkerHeaders,
  readBoundedNotificationBody,
} from "@/lib/notification-proxy";
import { NextResponse } from "next/server";

const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const channelId = new URL(request.url).searchParams.get("channel") || "";
  const headers = notificationWorkerHeaders(request, session.user.id);
  if (channelId) addNotificationRoomToken(headers, request, channelId);
  const response = await fetch(
    `${workerUrl}/api/notifications/preferences?channel=${encodeURIComponent(channelId)}`,
    { headers, cache: "no-store" },
  );
  return NextResponse.json(await response.json(), { status: response.status });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSameOriginNotificationMutation(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const body = await readBoundedNotificationBody(request);
  if (body === null) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  let channelId = "";
  try {
    const parsed = JSON.parse(body) as { channel_id?: unknown };
    channelId = typeof parsed.channel_id === "string" ? parsed.channel_id : "";
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const headers = notificationWorkerHeaders(request, session.user.id);
  if (channelId) addNotificationRoomToken(headers, request, channelId);
  const response = await fetch(`${workerUrl}/api/notifications/preferences`, {
    method: "PUT",
    headers,
    body,
    cache: "no-store",
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
