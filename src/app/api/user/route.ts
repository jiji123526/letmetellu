import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const MISSING_USER_SYNC_BACKOFF_MS = 5_000;
const recentMissingUserSyncs = new Map<string, number>();

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

function missingUserSyncCacheKey(user: { id: string; email?: string | null }) {
  return `${user.id}\n${user.email || ""}`;
}

export async function GET(request: Request) {
  const workerUrl = getWorkerUrl();
  const url = new URL(request.url);
  const channelId = url.searchParams.get("channel");
  const ownerUid = url.searchParams.get("owner");

  if (channelId || ownerUid) {
    const query = ownerUid
      ? `owner=${encodeURIComponent(ownerUid)}`
      : `channel=${encodeURIComponent(channelId || "")}`;
    const readRes = await fetch(`${workerUrl}/api/user/profile-channels?${query}`, {
      method: "GET",
      cache: "no-store",
    });
    const readData = await readRes.json();
    return NextResponse.json(readData, { status: readRes.status });
  }

  const session = await auth();
  const user = session?.user;

  if (!user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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

  const syncCacheKey = missingUserSyncCacheKey(user);
  const nextSyncAttemptAt = recentMissingUserSyncs.get(syncCacheKey) || 0;
  if (nextSyncAttemptAt > Date.now()) {
    return NextResponse.json(readData, { status: readRes.status });
  }
  if (nextSyncAttemptAt) {
    recentMissingUserSyncs.delete(syncCacheKey);
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
  if (syncRes.status === 404 && syncData?.error === "user_not_found") {
    recentMissingUserSyncs.set(syncCacheKey, Date.now() + MISSING_USER_SYNC_BACKOFF_MS);
  } else {
    recentMissingUserSyncs.delete(syncCacheKey);
  }
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
