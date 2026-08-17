import { auth } from "@/lib/auth";
import { channelPreviewCacheTag } from "@/lib/channel-preview";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

const CHANNEL_ID_PATTERN = /^[a-z0-9-]{3,30}$/;

function affectsChannelPreview(body: Record<string, unknown>): boolean {
  if (body.action === "set-passcode") return true;
  if (body.action !== "update-profile") return false;
  const payload = body.payload;
  if (!payload || typeof payload !== "object") return false;
  return ["name", "profile_image", "bubble_color"].some((key) => key in payload);
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json() as Record<string, unknown>;
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";

  // Forward to Worker with signed identity
  const res = await fetch(`${workerUrl}/api/admin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": process.env.INTERNAL_SECRET || "",
      "X-User-Id": session.user.id,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  const channelId = typeof body.channel_id === "string" ? body.channel_id : "";
  if (res.ok && CHANNEL_ID_PATTERN.test(channelId) && affectsChannelPreview(body)) {
    revalidateTag(channelPreviewCacheTag(channelId), { expire: 0 });
    revalidatePath(`/ch/${channelId}`);
    revalidatePath(`/ch/${channelId}/opengraph-image`);
  }
  return NextResponse.json(data, { status: res.status });
}
