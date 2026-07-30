import { auth } from "@/lib/auth";
import { readIdentityTokens, setIdentityCookies } from "@/lib/anonymous-identity-cookie";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return forwardSupportRequest(request, "GET");
}

export async function POST(request: Request) {
  return forwardSupportRequest(request, "POST");
}

async function forwardSupportRequest(request: Request, method: "GET" | "POST") {
  const session = await auth();
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
  const headers: Record<string, string> = {};

  if (session?.user?.id) {
    headers["X-Internal-Token"] = process.env.INTERNAL_SECRET || "";
    headers["X-User-Id"] = session.user.id;
  }

  const { anonymousToken, deviceToken } = readIdentityTokens(request.headers.get("cookie"));
  if (anonymousToken) headers["X-Anonymous-Token"] = anonymousToken;
  if (deviceToken) headers["X-Device-Token"] = deviceToken;

  const acceptLanguage = request.headers.get("accept-language");
  if (acceptLanguage) headers["X-Locale"] = acceptLanguage;

  if (method === "GET") {
    const url = new URL(request.url);
    const res = await fetch(`${workerUrl}/api/support${url.search}`, {
      method,
      headers,
      cache: "no-store",
    });
    const data = await res.json();
    const response = NextResponse.json(data, { status: res.status });
    setIdentityCookies(response, request, {
      anonymousToken: res.headers.get("X-Anonymous-Token"),
      deviceToken: res.headers.get("X-Device-Token"),
    });
    return response;
  }

  const body = await request.json();
  headers["Content-Type"] = "application/json";
  const res = await fetch(`${workerUrl}/api/support`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  const response = NextResponse.json(data, { status: res.status });
  setIdentityCookies(response, request, {
    anonymousToken: res.headers.get("X-Anonymous-Token"),
    deviceToken: res.headers.get("X-Device-Token"),
  });
  return response;
}
