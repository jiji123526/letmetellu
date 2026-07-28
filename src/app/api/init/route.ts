import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Init proxy for authenticated users — forwards session identity to Worker
// Worker can use this to bypass passcode gate for channel owners
export async function GET(request: Request) {
  const session = await auth();
  const url = new URL(request.url);
  const channel = url.searchParams.get("channel");

  if (!channel) {
    return NextResponse.json({ error: "missing channel" }, { status: 400 });
  }

  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  // If user is logged in, include auth headers for owner bypass
  if (session?.user?.id) {
    headers["X-Internal-Token"] = process.env.INTERNAL_SECRET || "";
    headers["X-User-Id"] = session.user.id;
  }

  // Forward room token if present
  const roomToken = request.headers.get("X-Room-Token");
  if (roomToken) {
    headers["X-Room-Token"] = roomToken;
  }

  const anonymousToken = request.headers.get("X-Anonymous-Token");
  const viewerFingerprint = request.headers.get("X-Viewer-Fingerprint");
  if (anonymousToken) headers["X-Anonymous-Token"] = anonymousToken;
  if (viewerFingerprint) headers["X-Viewer-Fingerprint"] = viewerFingerprint;

  const res = await fetch(`${workerUrl}/api/init?channel=${channel}`, { headers });
  const data = await res.json();

  return NextResponse.json(data, { status: res.status });
}
