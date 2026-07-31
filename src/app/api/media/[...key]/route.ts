import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { readRoomTokenCookie } from "@/lib/room-token-cookie";

interface Props {
  params: Promise<{ key: string[] }>;
}

function getParentChannelId(channelId: string): string {
  return channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
}

export async function GET(request: Request, { params }: Props) {
  const session = await auth();
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

    // Protected media now stays on the same-origin proxy so room-access tokens
    // remain HttpOnly and never have to appear in JS or media URLs.
    if (!roomToken && !session?.user?.id) {
      return NextResponse.redirect(target, 307);
    }

    const forwardHeaders: Record<string, string> = {};
    if (roomToken) {
      forwardHeaders["X-Room-Token"] = roomToken;
    }
    if (session?.user?.id) {
      forwardHeaders["X-Internal-Token"] = process.env.INTERNAL_SECRET || "";
      forwardHeaders["X-User-Id"] = session.user.id;
    }
    const response = await fetch(target, {
      headers: Object.keys(forwardHeaders).length > 0 ? forwardHeaders : undefined,
      cache: "no-store",
    });
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch {
    return NextResponse.json({ error: "media proxy failed" }, { status: 502 });
  }
}
