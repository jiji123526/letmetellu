import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";

async function forward(request: Request, method: "GET" | "POST" | "DELETE") {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sourceUrl = new URL(request.url);
  const target = new URL(`${workerUrl}/api/recent-channels`);
  target.search = sourceUrl.search;
  const response = await fetch(target, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": process.env.INTERNAL_SECRET || "",
      "X-User-Id": session.user.id,
      "X-User-Email": session.user.email || "",
    },
    body: method === "POST" ? await request.text() : undefined,
    cache: "no-store",
  });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

export const GET = (request: Request) => forward(request, "GET");
export const POST = (request: Request) => forward(request, "POST");
export const DELETE = (request: Request) => forward(request, "DELETE");
