import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

function getWorkerUrl() {
  return process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
}

function getTossClientKey() {
  return process.env.TOSS_PAYMENTS_CLIENT_KEY
    || process.env.NEXT_PUBLIC_TOSS_PAYMENTS_CLIENT_KEY
    || "";
}

export async function POST(request: Request) {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const response = await fetch(`${getWorkerUrl()}/api/billing/toss/prepare`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": process.env.INTERNAL_SECRET || "",
      "X-User-Id": user.id,
    },
    body: await request.text(),
    cache: "no-store",
  });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    return NextResponse.json(data, { status: response.status });
  }

  const clientKey = getTossClientKey();
  if (!clientKey) {
    return NextResponse.json({ error: "billing_provider_not_configured" }, { status: 503 });
  }

  return NextResponse.json({
    ...data,
    checkout: {
      ...(typeof data.checkout === "object" && data.checkout ? data.checkout : {}),
      client_key: clientKey,
    },
  }, { status: response.status });
}
