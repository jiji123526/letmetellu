import { Env } from "../types";

const PBKDF2_ITERATIONS = 600_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

async function createPasswordHash(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derivePassword(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`;
}

async function legacySha256(password: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function verifyPassword(password: string, storedHash: string) {
  if (storedHash.startsWith("pbkdf2-sha256$")) {
    const [, iterationsText, saltText, hashText] = storedHash.split("$");
    const iterations = Number(iterationsText);
    if (!Number.isInteger(iterations) || iterations < 100_000 || !saltText || !hashText) return false;
    try {
      const actual = await derivePassword(password, fromBase64(saltText), iterations);
      return timingSafeEqual(actual, fromBase64(hashText));
    } catch {
      return false;
    }
  }
  return timingSafeEqual(
    new TextEncoder().encode(await legacySha256(password)),
    new TextEncoder().encode(storedHash),
  );
}

export async function handleAuth(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });

  const body = await request.json() as { action?: string; email?: string; password?: string };
  const email = normalizeEmail(body.email || "");
  const password = body.password || "";
  if (!email || !password || email.length > 254 || !EMAIL_PATTERN.test(email) || password.length > 256) {
    return Response.json({ error: "invalid_credentials" }, { status: 400 });
  }

  // Credential signup stays disabled until a short-lived email verification
  // token proves ownership. Google signup remains available.
  if (body.action === "signup") {
    return Response.json({ error: "email_signup_disabled" }, { status: 403 });
  }

  if (body.action === "login") {
    const user = await env.DB.prepare(
      "SELECT id, email, name, password_hash FROM users WHERE lower(email) = ?"
    ).bind(email).first() as { id: string; email: string; name: string; password_hash: string | null } | null;

    if (!user?.password_hash || !(await verifyPassword(password, user.password_hash))) {
      return Response.json({ error: "invalid_credentials" }, { status: 401 });
    }

    // Upgrade legacy unsalted SHA-256 hashes after a successful login.
    if (!user.password_hash.startsWith("pbkdf2-sha256$")) {
      await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
        .bind(await createPasswordHash(password), user.id).run();
    }

    return Response.json({ ok: true, id: user.id, email: user.email, name: user.name });
  }

  return Response.json({ error: "unknown action" }, { status: 400 });
}
