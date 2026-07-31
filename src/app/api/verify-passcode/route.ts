import { NextResponse } from "next/server";
import { setRoomTokenResponseCookie } from "@/lib/room-token-cookie";

function getParentChannelId(channelId: string) {
  return channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { channel_id?: string; passcode?: string } | null;
  const channelId = typeof body?.channel_id === "string" ? body.channel_id : "";
  const passcode = typeof body?.passcode === "string" ? body.passcode : "";

  if (!channelId || !passcode) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientIp = forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
  const response = await fetch(`${workerUrl}/api/verify-passcode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(clientIp ? { "X-Client-IP": clientIp } : {}),
    },
    body: JSON.stringify({ channel_id: getParentChannelId(channelId), passcode }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as { token?: string; error?: string };
  if (!response.ok || typeof data.token !== "string" || !data.token) {
    return NextResponse.json({ error: data.error || "verification_failed" }, { status: response.status });
  }

  const nextResponse = NextResponse.json({ ok: true });
  setRoomTokenResponseCookie(nextResponse, request, getParentChannelId(channelId), data.token);
  return nextResponse;
}
