import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";

  // Sync user to D1 and get their channels
  const res = await fetch(`${workerUrl}/api/user`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
    }),
  });

  const data = await res.json();
  return NextResponse.json(data);
}
