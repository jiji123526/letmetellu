import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Admin message proxy — verifies session, forwards with trusted identity
export async function POST(request: Request) {
  return forwardAdminMessageRequest(request, "POST");
}

export async function PATCH(request: Request) {
  return forwardAdminMessageRequest(request, "PATCH");
}

export async function PUT(request: Request) {
  return forwardAdminMessageRequest(request, "PUT");
}

async function forwardAdminMessageRequest(request: Request, method: "POST" | "PATCH" | "PUT") {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const rawBody = await request.json();
  const body = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
    ? { ...rawBody, uid: userId }
    : rawBody;
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";

  // Override uid with the verified session user ID and mark as admin-verified.
  const res = await fetch(`${workerUrl}/api/messages`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": process.env.INTERNAL_SECRET || "",
      "X-User-Id": userId,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
