import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Returns the WebSocket auth token for verified channel owners
// This token is used to authenticate as admin on the DO WebSocket
export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const channelId = url.searchParams.get("channel");
  if (!channelId) {
    return NextResponse.json({ error: "missing channel" }, { status: 400 });
  }

  // Verify the user owns this channel
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
  const res = await fetch(`${workerUrl}/api/init?channel=${channelId}`);
  const data = await res.json() as { channel?: { owner_uid: string } };

  if (!data.channel || data.channel.owner_uid !== session.user.id) {
    return NextResponse.json({ error: "not owner" }, { status: 403 });
  }

  // Return the token (only channel owners get this)
  return NextResponse.json({ token: process.env.INTERNAL_SECRET });
}
