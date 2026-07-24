import { Env } from "../types";

// Simple hash for passwords (use bcrypt in production via a library)
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function handleAuth(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  const body = await request.json() as { action: string; email: string; password: string; name?: string };
  const { action, email, password, name } = body;

  if (!email || !password) {
    return Response.json({ error: "missing fields" }, { status: 400 });
  }

  if (action === "signup") {
    // Check if user already exists
    const existing = await env.DB.prepare("SELECT id, password_hash FROM users WHERE email = ?").bind(email).first() as { id: string; password_hash: string | null } | null;
    if (existing && existing.password_hash) {
      return Response.json({ error: "user_exists" }, { status: 409 });
    }

    // Validate password
    if (password.length < 8 || !/\d/.test(password)) {
      return Response.json({ error: "weak_password" }, { status: 400 });
    }

    const hashedPw = await hashPassword(password);

    if (existing && !existing.password_hash) {
      // User exists (from OAuth sync) but no password — set it
      await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
        .bind(hashedPw, existing.id).run();
      return Response.json({ ok: true, id: existing.id, email });
    }

    // Create new user
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)"
    ).bind(id, email, name || email.split("@")[0], hashedPw).run();

    return Response.json({ ok: true, id, email });
  }

  if (action === "login") {
    // Find user
    const user = await env.DB.prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?")
      .bind(email).first() as { id: string; email: string; name: string; password_hash: string } | null;

    if (!user) {
      return Response.json({ error: "invalid_credentials" }, { status: 401 });
    }

    // Verify password
    const hashedPw = await hashPassword(password);
    if (user.password_hash !== hashedPw) {
      return Response.json({ error: "invalid_credentials" }, { status: 401 });
    }

    return Response.json({ ok: true, id: user.id, email: user.email, name: user.name });
  }

  return Response.json({ error: "unknown action" }, { status: 400 });
}
