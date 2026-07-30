import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return forwardSupportRequest(request, "GET");
}

export async function POST(request: Request) {
  return forwardSupportRequest(request, "POST");
}

async function forwardSupportRequest(request: Request, method: "GET" | "POST") {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
  const headers: Record<string, string> = {
    "X-Internal-Token": process.env.INTERNAL_SECRET || "",
    "X-User-Id": session.user.id,
  };

  if (method === "GET") {
    const url = new URL(request.url);
    const res = await fetch(`${workerUrl}/api/support${url.search}`, {
      method,
      headers,
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  }

  const body = await request.json();
  headers["Content-Type"] = "application/json";
  const res = await fetch(`${workerUrl}/api/support`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
