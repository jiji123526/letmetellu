import { auth } from "@/lib/auth";
import { readIdentityTokens } from "@/lib/anonymous-identity-cookie";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const session = await auth();
  const body = await request.json();
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const { anonymousToken, deviceToken } = readIdentityTokens(request.headers.get("cookie"));
  if (anonymousToken) headers["X-Anonymous-Token"] = anonymousToken;
  if (deviceToken) headers["X-Device-Token"] = deviceToken;

  const roomToken = request.headers.get("X-Room-Token");
  if (roomToken) headers["X-Room-Token"] = roomToken;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    headers["X-Client-IP"] = forwardedFor.split(",")[0]?.trim() || forwardedFor;
  }

  if (session?.user?.id) {
    headers["X-Internal-Token"] = process.env.INTERNAL_SECRET || "";
    headers["X-User-Id"] = session.user.id;
  }

  const res = await fetch(`${workerUrl}/api/channel-reports`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
