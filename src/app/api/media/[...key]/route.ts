import { NextResponse } from "next/server";
import { readRoomTokenCookie } from "@/lib/room-token-cookie";

interface Props {
  params: Promise<{ key: string[] }>;
}

function getParentChannelId(channelId: string): string {
  return channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
}

export async function GET(request: Request, { params }: Props) {
  const { key } = await params;
  if (!Array.isArray(key) || key.length === 0) {
    return NextResponse.json({ error: "missing media key" }, { status: 400 });
  }

  try {
    const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
    const target = new URL(`/api/media/${key.map(encodeURIComponent).join("/")}`, workerUrl);
    const requestUrl = new URL(request.url);
    requestUrl.searchParams.forEach((value, name) => {
      if (name !== "token") target.searchParams.append(name, value);
    });

    const parentChannelId = getParentChannelId(key[0]);
    const roomToken = readRoomTokenCookie(request.headers.get("cookie"), parentChannelId);
    const response = await fetch(target, {
      headers: roomToken ? { "X-Room-Token": roomToken } : undefined,
      cache: "no-store",
    });
    const body = await response.arrayBuffer();

    const headers = new Headers();
    const contentType = response.headers.get("content-type");
    const cacheControl = response.headers.get("cache-control");
    if (contentType) headers.set("Content-Type", contentType);
    if (cacheControl) headers.set("Cache-Control", cacheControl);

    return new Response(body, {
      status: response.status,
      headers,
    });
  } catch {
    return NextResponse.json({ error: "media proxy failed" }, { status: 502 });
  }
}
