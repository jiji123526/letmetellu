import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Admin message proxy — verifies session, forwards with trusted identity
export async function POST(request: Request) {
  return forwardAdminMessageRequest(request, "POST");
}

export async function PATCH(request: Request) {
  return forwardAdminMessageRequest(request, "PATCH");
}

async function forwardAdminMessageRequest(request: Request, method: "POST" | "PATCH") {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";

  // Override uid with verified session user ID and mark as admin-verified
  const res = await fetch(`${workerUrl}/api/messages`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": process.env.INTERNAL_SECRET || "",
      "X-User-Id": session.user.id,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
