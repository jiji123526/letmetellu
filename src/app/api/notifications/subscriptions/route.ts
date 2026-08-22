import { auth } from "@/lib/auth";
import {
  isSameOriginNotificationMutation,
  notificationWorkerHeaders,
  readBoundedNotificationBody,
} from "@/lib/notification-proxy";
import { NextResponse } from "next/server";

const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSameOriginNotificationMutation(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const body = await readBoundedNotificationBody(request);
  if (body === null) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  const response = await fetch(`${workerUrl}/api/notifications/subscriptions`, {
    method: "POST",
    headers: notificationWorkerHeaders(request, session.user.id),
    body,
    cache: "no-store",
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
