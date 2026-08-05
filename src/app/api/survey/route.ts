import { auth } from "@/lib/auth";
import { readIdentityTokens, setIdentityCookies } from "@/lib/anonymous-identity-cookie";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return forwardSurveyRequest(request, "GET");
}

export async function POST(request: Request) {
  return forwardSurveyRequest(request, "POST");
}

async function forwardSurveyRequest(request: Request, method: "GET" | "POST") {
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

  const requestInit: RequestInit = {
    method,
    headers,
    cache: "no-store",
  };
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    requestInit.body = JSON.stringify(await request.json());
  }

  const workerResponse = await fetch(`${workerUrl}/api/survey`, requestInit);
  const data = await workerResponse.json();
  const response = NextResponse.json(data, { status: workerResponse.status });
  setIdentityCookies(response, request, {
    anonymousToken: workerResponse.headers.get("X-Anonymous-Token"),
    deviceToken: workerResponse.headers.get("X-Device-Token"),
  });
  return response;
}
