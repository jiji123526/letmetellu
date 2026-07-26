import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const channelId = new URL(request.url).searchParams.get("channel");
  if (!channelId) {
    return NextResponse.json({ error: "missing channel" }, { status: 400 });
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
  const response = await fetch(`${workerUrl}/api/upload?channel=${encodeURIComponent(channelId)}`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "X-Internal-Token": process.env.INTERNAL_SECRET || "",
      "X-User-Id": session.user.id,
    },
    body: await request.arrayBuffer(),
    cache: "no-store",
  });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
