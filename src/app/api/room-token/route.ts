import { NextResponse } from "next/server";
import { clearRoomTokenResponseCookie } from "@/lib/room-token-cookie";

function getParentChannelId(channelId: string) {
  return channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const channelId = url.searchParams.get("channel") || "";
  if (!channelId) {
    return NextResponse.json({ error: "missing channel" }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  clearRoomTokenResponseCookie(response, request, getParentChannelId(channelId));
  return response;
}
