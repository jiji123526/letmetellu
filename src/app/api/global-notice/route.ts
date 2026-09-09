import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

function getWorkerUrl() {
  return process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
}

export async function GET() {
  const workerUrl = getWorkerUrl();
  const response = await fetch(`${workerUrl}/api/global-notice`, {
    method: "GET",
    cache: "no-store",
  });
  const data = await response.json();
  return NextResponse.json(data, {
    status: response.status,
    headers: {
      "Cache-Control": "public, s-maxage=300, must-revalidate",
    },
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const workerUrl = getWorkerUrl();
  const response = await fetch(`${workerUrl}/api/global-notice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": process.env.INTERNAL_SECRET || "",
      "X-User-Id": session.user.id,
    },
    body: await request.text(),
    cache: "no-store",
  });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const workerUrl = getWorkerUrl();
  const response = await fetch(`${workerUrl}/api/global-notice`, {
    method: "DELETE",
    headers: {
      "X-Internal-Token": process.env.INTERNAL_SECRET || "",
      "X-User-Id": session.user.id,
    },
    cache: "no-store",
  });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
