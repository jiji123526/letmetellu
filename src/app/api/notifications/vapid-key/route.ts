import { auth } from "@/lib/auth";
import { notificationWorkerHeaders } from "@/lib/notification-proxy";
import { NextResponse } from "next/server";

const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const response = await fetch(`${workerUrl}/api/notifications/vapid-key`, {
    headers: notificationWorkerHeaders(request, session.user.id),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({ error: "invalid_worker_response" }));
  return NextResponse.json(body, {
    status: response.status,
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
