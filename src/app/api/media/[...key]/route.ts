import { NextResponse } from "next/server";

interface Props {
  params: Promise<{ key: string[] }>;
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
    target.search = requestUrl.search;

    const response = await fetch(target, {
      method: "GET",
      cache: "no-store",
    });

    const headers = new Headers();
    const contentType = response.headers.get("content-type");
    const cacheControl = response.headers.get("cache-control");
    if (contentType) headers.set("Content-Type", contentType);
    if (cacheControl) headers.set("Cache-Control", cacheControl);

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch {
    return NextResponse.json({ error: "media proxy failed" }, { status: 502 });
  }
}
