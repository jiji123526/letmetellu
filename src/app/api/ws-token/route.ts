import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

function encodeBase64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Buffer.from(bytes).toString("base64url");
}

async function createAdminWsToken(channelId: string, userId: string): Promise<string> {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret) throw new Error("INTERNAL_SECRET is not configured");

  const payload = encodeBase64Url(JSON.stringify({
    type: "admin-ws",
    channel_id: channelId,
    user_id: userId,
    exp: Math.floor(Date.now() / 1000) + 5 * 60,
  }));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `${payload}.${encodeBase64Url(signature)}`;
}

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
  const res = await fetch(`${workerUrl}/api/init?channel=${channelId}`, {
    headers: {
      "X-Internal-Token": process.env.INTERNAL_SECRET || "",
      "X-User-Id": session.user.id,
    },
  });
  const data = await res.json() as { channel?: { owner_uid: string } };

  if (!data.channel || data.channel.owner_uid !== session.user.id) {
    return NextResponse.json({ error: "not owner" }, { status: 403 });
  }

  // Return a short-lived, channel-bound token. Never expose INTERNAL_SECRET.
  const token = await createAdminWsToken(channelId, session.user.id);
  return NextResponse.json({ token });
}
