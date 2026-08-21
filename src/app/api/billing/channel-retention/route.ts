import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

function getWorkerUrl() {
  return process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
}

export async function POST(request: Request) {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const response = await fetch(`${getWorkerUrl()}/api/billing/channel-retention`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": process.env.INTERNAL_SECRET || "",
      "X-User-Id": user.id,
    },
    body: await request.text(),
    cache: "no-store",
  });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
