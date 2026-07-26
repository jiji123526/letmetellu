import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const rawIds = request.nextUrl.searchParams.get("ids") || "";
  const ids = [...new Set(
    rawIds.split(",").filter((id) => /^[a-z0-9-]{3,30}$/.test(id))
  )].slice(0, 20);
  if (ids.length === 0) return NextResponse.json({ existingIds: [] });

  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
  const response = await fetch(
    `${workerUrl}/api/user?exists=${encodeURIComponent(ids.join(","))}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    return NextResponse.json({ error: "validation unavailable" }, { status: 502 });
  }
  const data = await response.json() as { existingIds?: string[]; channels?: unknown[] };
  return NextResponse.json({ existingIds: data.existingIds || [], channels: data.channels || [] });
}
