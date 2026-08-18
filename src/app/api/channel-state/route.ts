import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const channelId = new URL(request.url).searchParams.get("channel") || "";
  if (!channelId) {
    return NextResponse.json({ error: "missing channel" }, { status: 400 });
  }

  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
  const response = await fetch(
    `${workerUrl}/api/channel-state?channel=${encodeURIComponent(channelId)}`,
    {
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": process.env.INTERNAL_SECRET || "",
        "X-User-Id": user.id,
      },
      cache: "no-store",
    },
  );
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
