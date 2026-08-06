import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";

  const response = await fetch(`${workerUrl}/api/preview${url.search}`, {
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({ error: "preview unavailable" }));
  return NextResponse.json(data, { status: response.status });
}
