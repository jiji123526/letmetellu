import { auth } from "@/lib/auth";
import {
  isSameOriginNotificationMutation,
  notificationWorkerHeaders,
} from "@/lib/notification-proxy";
import { NextResponse } from "next/server";

const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSameOriginNotificationMutation(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const { id } = await context.params;
  const response = await fetch(
    `${workerUrl}/api/notifications/subscriptions/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: notificationWorkerHeaders(request, session.user.id),
      cache: "no-store",
    },
  );
  return NextResponse.json(await response.json(), { status: response.status });
}
