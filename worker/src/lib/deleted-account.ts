import { Env } from "../types";

export async function deletedAccountKey(email: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(email.trim().toLowerCase()),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function isDeletedAccount(email: string, env: Env) {
  const emailKey = await deletedAccountKey(email, env.INTERNAL_SECRET);
  const record = await env.DB.prepare(
    "SELECT 1 FROM deleted_accounts WHERE email_key = ?"
  ).bind(emailKey).first();
  return record !== null;
}

