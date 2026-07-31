import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

function getWorkerUrl() {
  return process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
}

function getInternalHeaders(session: { user: { id: string; email?: string | null } }) {
  return {
    "Content-Type": "application/json",
    "X-Internal-Token": process.env.INTERNAL_SECRET || "",
    "X-User-Id": session.user.id,
    "X-User-Email": session.user.email || "",
  };
}

export async function GET() {
  const session = await auth();
  const user = session?.user;

  if (!user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const workerUrl = getWorkerUrl();
  const headers = getInternalHeaders({ user: { id: user.id, email: user.email } });

  const readRes = await fetch(`${workerUrl}/api/user`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const readData = await readRes.json();
  if (readRes.ok) {
    return NextResponse.json(readData, { status: readRes.status });
  }

  if (readRes.status !== 404 || readData?.error !== "user_not_found") {
    return NextResponse.json(readData, { status: readRes.status });
  }

  const syncRes = await fetch(`${workerUrl}/api/user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": process.env.INTERNAL_SECRET || "",
    },
    body: JSON.stringify({
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      flow: "sync",
    }),
    cache: "no-store",
  });

  const syncData = await syncRes.json();
  return NextResponse.json(syncData, { status: syncRes.status });
}

export async function PATCH(request: Request) {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const workerUrl = getWorkerUrl();
  const res = await fetch(`${workerUrl}/api/user`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": process.env.INTERNAL_SECRET || "",
      "X-User-Id": user.id,
    },
    body: await request.text(),
    cache: "no-store",
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const workerUrl = getWorkerUrl();
  const res = await fetch(`${workerUrl}/api/user`, {
    method: "DELETE",
    headers: getInternalHeaders({ user: { id: user.id, email: user.email } }),
    cache: "no-store",
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
