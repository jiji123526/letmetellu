import { Env } from "../types";

// Cloudflare Workers Web Crypto currently caps PBKDF2 at 100,000 iterations.
const PBKDF2_ITERATIONS = 100_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERIFICATION_TTL_MS = 30 * 60 * 1000;
const REQUEST_WINDOW_MS = 60 * 60 * 1000;
const MAX_EMAIL_REQUESTS = 3;
const MAX_IP_REQUESTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_EMAIL_FAILURES = 10;
const MAX_LOGIN_IP_FAILURES = 50;
const DUMMY_PASSWORD_HASH = "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const EMAIL_FROM = "yap. <noreply@send.yapndot.com>";

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toBase64Url(bytes: Uint8Array) {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
    new TextEncoder().encode(await sha256(password)),
    new TextEncoder().encode(storedHash),
  );
}

function getVerificationOrigin(env: Env) {
  const origin = new URL(env.APP_ORIGIN);
  if (origin.protocol !== "https:" && origin.hostname !== "localhost") {
    throw new Error("invalid APP_ORIGIN");
  }
  return origin.origin;
}

async function sendVerificationEmail(
  env: Env,
  email: string,
  rawToken: string,
  tokenHash: string,
  locale: "ko" | "en",
) {
  const verificationUrl = new URL("/verify-email", getVerificationOrigin(env));
  verificationUrl.searchParams.set("token", rawToken);
  verificationUrl.searchParams.set("lang", locale);
  const korean = locale === "ko";
  const subject = korean ? "yap. 이메일을 인증해 주세요" : "Verify your yap. email";
  const title = korean ? "이메일을 인증해 주세요" : "Verify your email";
  const description = korean
    ? "yap. 계정 생성을 완료하려면 이 이메일을 인증해 주세요."
    : "Confirm this email to finish creating your yap. account.";
  const buttonLabel = korean ? "이메일 인증하기" : "Verify email";
  const expiration = korean
    ? "이 링크는 30분 동안 유효합니다. 요청하지 않았다면 이 메일을 무시해 주세요."
    : "This link expires in 30 minutes. If you did not request this, you can ignore this email.";
  const text = korean
    ? `yap. 이메일을 인증해 주세요:\n\n${verificationUrl.toString()}\n\n${expiration}`
    : `Verify your email for yap.:\n\n${verificationUrl.toString()}\n\n${expiration}`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `verify-${tokenHash}`,
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [email],
      subject,
      text,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:28px;color:#111">
          <h1 style="font-size:22px;margin:0 0 12px">${title}</h1>
          <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 24px">${description}</p>
          <a href="${verificationUrl.toString()}" style="display:inline-block;background:#007aff;color:#fff;text-decoration:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:600">${buttonLabel}</a>
          <p style="font-size:12px;line-height:1.5;color:#8e8e93;margin:24px 0 0">${expiration}</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("Resend verification email failed", response.status, detail.slice(0, 300));
    throw new Error("email delivery failed");
  }
}

async function sendPasswordResetEmail(
  env: Env,
  email: string,
  rawToken: string,
  tokenHash: string,
  locale: "ko" | "en",
) {
  const resetUrl = new URL("/reset-password", getVerificationOrigin(env));
  resetUrl.searchParams.set("token", rawToken);
  resetUrl.searchParams.set("lang", locale);
  const korean = locale === "ko";
  const subject = korean ? "yap. 비밀번호 재설정" : "Reset your yap. password";
  const title = korean ? "비밀번호를 재설정하세요" : "Reset your password";
  const description = korean
    ? "아래 버튼을 눌러 새 비밀번호를 설정해 주세요."
    : "Use the button below to choose a new password.";
  const buttonLabel = korean ? "비밀번호 재설정" : "Reset password";
  const expiration = korean
    ? "이 링크는 30분 동안 한 번만 사용할 수 있습니다. 요청하지 않았다면 이 메일을 무시해 주세요."
    : "This link can be used once and expires in 30 minutes. If you did not request it, ignore this email.";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `reset-${tokenHash}`,
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [email],
      subject,
      text: `${title}\n\n${resetUrl.toString()}\n\n${expiration}`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:28px;color:#111">
          <h1 style="font-size:22px;margin:0 0 12px">${title}</h1>
          <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 24px">${description}</p>
          <a href="${resetUrl.toString()}" style="display:inline-block;background:#007aff;color:#fff;text-decoration:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:600">${buttonLabel}</a>
          <p style="font-size:12px;line-height:1.5;color:#8e8e93;margin:24px 0 0">${expiration}</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("Resend password reset email failed", response.status, detail.slice(0, 300));
    throw new Error("email delivery failed");
  }
}

async function handlePasswordResetRequest(
  body: { email?: string; locale?: string },
  request: Request,
  env: Env,
) {
  const email = normalizeEmail(body.email || "");
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return Response.json({ error: "invalid_email" }, { status: 400 });
  }

  const now = Date.now();
  const clientIp = request.headers.get("X-Client-IP") || "unknown";
  const [emailHash, ipHash] = await Promise.all([sha256(email), sha256(clientIp)]);
  const windowStart = now - REQUEST_WINDOW_MS;
  const [emailRate, ipRate] = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) AS count FROM email_auth_requests WHERE email_hash = ? AND action = 'password-reset' AND created_at > ?"
    ).bind(emailHash, windowStart).first<{ count: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS count FROM email_auth_requests WHERE requested_ip_hash = ? AND action = 'password-reset' AND created_at > ?"
    ).bind(ipHash, windowStart).first<{ count: number }>(),
  ]);
  if ((emailRate?.count || 0) >= MAX_EMAIL_REQUESTS || (ipRate?.count || 0) >= MAX_IP_REQUESTS) {
    return Response.json({ error: "too_many_requests" }, { status: 429 });
  }
  await env.DB.prepare(
    "INSERT INTO email_auth_requests (id, email_hash, requested_ip_hash, action, created_at) VALUES (?, ?, ?, 'password-reset', ?)"
  ).bind(crypto.randomUUID(), emailHash, ipHash, now).run();

  const user = await env.DB.prepare(
    "SELECT id, email FROM users WHERE lower(email) = ? AND email_verified_at IS NOT NULL AND password_hash IS NOT NULL"
  ).bind(email).first<{ id: string; email: string }>();

  // Always return the same response so callers cannot discover registered emails.
  if (!user) {
    return Response.json({ ok: true });
  }

  const rawToken = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(rawToken);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL"
    ).bind(now, user.id),
    env.DB.prepare(
      "INSERT INTO password_reset_tokens (token_hash, user_id, requested_ip_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(tokenHash, user.id, ipHash, now + VERIFICATION_TTL_MS, now),
  ]);

  try {
    await sendPasswordResetEmail(env, user.email, rawToken, tokenHash, body.locale === "en" ? "en" : "ko");
  } catch {
    await env.DB.prepare("DELETE FROM password_reset_tokens WHERE token_hash = ?").bind(tokenHash).run();
    return Response.json({ error: "email_delivery_failed" }, { status: 502 });
  }
  return Response.json({ ok: true });
}

async function handlePasswordReset(
  body: { token?: string; password?: string },
  env: Env,
) {
  const rawToken = body.token || "";
  const password = body.password || "";
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(rawToken)) {
    return Response.json({ error: "invalid_or_expired_token" }, { status: 400 });
  }
  if (password.length < 8 || password.length > 128) {
    return Response.json({ error: "weak_password" }, { status: 400 });
  }

  const tokenHash = await sha256(rawToken);
  const now = Date.now();
  const record = await env.DB.prepare(`
    SELECT tokens.token_hash, tokens.user_id, users.email
    FROM password_reset_tokens AS tokens
    JOIN users ON users.id = tokens.user_id
    WHERE tokens.token_hash = ? AND tokens.used_at IS NULL AND tokens.expires_at > ?
  `).bind(tokenHash, now).first<{ token_hash: string; user_id: string; email: string }>();
  if (!record) return Response.json({ error: "invalid_or_expired_token" }, { status: 400 });

  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE users
      SET password_hash = ?
      WHERE id = ?
        AND EXISTS (
          SELECT 1 FROM password_reset_tokens
          WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
        )
    `).bind(await createPasswordHash(password), record.user_id, tokenHash, now),
    env.DB.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL")
      .bind(now, record.user_id),
  ]);
  if (!results[0].meta.changes) {
    return Response.json({ error: "invalid_or_expired_token" }, { status: 400 });
  }
  await env.DB.prepare(
    "DELETE FROM email_auth_requests WHERE email_hash = ? AND action = 'login-failed'"
  ).bind(await sha256(normalizeEmail(record.email))).run();
  return Response.json({ ok: true });
}

async function handleSignup(
  body: { email?: string; password?: string; name?: string; locale?: string },
  request: Request,
  env: Env,
) {
  const email = normalizeEmail(body.email || "");
  const password = body.password || "";
  const locale = body.locale === "en" ? "en" : "ko";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 50) : "";
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return Response.json({ error: "invalid_email" }, { status: 400 });
  }
  if (password.length < 8 || password.length > 128) {
    return Response.json({ error: "weak_password" }, { status: 400 });
  }
  const now = Date.now();
  const clientIp = request.headers.get("X-Client-IP") || "unknown";
  const ipHash = await sha256(clientIp);
  const emailHash = await sha256(email);
  const windowStart = now - REQUEST_WINDOW_MS;
  const [emailRate, ipRate] = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) AS count FROM email_auth_requests WHERE email_hash = ? AND action = 'signup' AND created_at > ?"
    ).bind(emailHash, windowStart).first<{ count: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS count FROM email_auth_requests WHERE requested_ip_hash = ? AND action = 'signup' AND created_at > ?"
    ).bind(ipHash, windowStart).first<{ count: number }>(),
  ]);
  if ((emailRate?.count || 0) >= MAX_EMAIL_REQUESTS || (ipRate?.count || 0) >= MAX_IP_REQUESTS) {
    return Response.json({ error: "too_many_requests" }, { status: 429 });
  }
  await env.DB.prepare(
    "INSERT INTO email_auth_requests (id, email_hash, requested_ip_hash, action, created_at) VALUES (?, ?, ?, 'signup', ?)"
  ).bind(crypto.randomUUID(), emailHash, ipHash, now).run();

  const passwordHash = await createPasswordHash(password);
  const existing = await env.DB.prepare(
    "SELECT id, email_verified_at FROM users WHERE lower(email) = ?"
  ).bind(email).first<{ id: string; email_verified_at: string | null }>();
  if (existing?.email_verified_at) {
    // Keep the response generic and never overwrite an existing verified account.
    return Response.json({ ok: true, pending: true });
  }

  const userId = existing?.id || crypto.randomUUID();
  if (existing) {
    await env.DB.prepare(
      "UPDATE users SET password_hash = ?, name = COALESCE(NULLIF(?, ''), name) WHERE id = ? AND email_verified_at IS NULL"
    ).bind(passwordHash, name, userId).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO users (id, email, name, password_hash, email_verified_at) VALUES (?, ?, ?, ?, NULL)"
    ).bind(userId, email, name || email.split("@")[0], passwordHash).run();
  }

  const rawToken = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(rawToken);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE email_verification_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL"
    ).bind(now, userId),
    env.DB.prepare(`
      INSERT INTO email_verification_tokens
        (token_hash, user_id, email, requested_ip_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(tokenHash, userId, email, ipHash, now + VERIFICATION_TTL_MS, now),
  ]);

  try {
    await sendVerificationEmail(env, email, rawToken, tokenHash, locale);
  } catch {
    await env.DB.prepare("DELETE FROM email_verification_tokens WHERE token_hash = ?")
      .bind(tokenHash).run();
    return Response.json({ error: "email_delivery_failed" }, { status: 502 });
  }

  return Response.json({ ok: true, pending: true });
}

async function handleVerifyEmail(body: { token?: string }, env: Env) {
  const rawToken = body.token || "";
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(rawToken)) {
    return Response.json({ error: "invalid_token" }, { status: 400 });
  }
  const tokenHash = await sha256(rawToken);
  const now = Date.now();
  const record = await env.DB.prepare(`
    SELECT tokens.token_hash, tokens.user_id, tokens.email, tokens.used_at,
           users.email_verified_at
    FROM email_verification_tokens AS tokens
    JOIN users ON users.id = tokens.user_id
    WHERE tokens.token_hash = ? AND tokens.expires_at > ?
  `).bind(tokenHash, now).first<{
    token_hash: string;
    user_id: string;
    email: string;
    used_at: number | null;
    email_verified_at: string | null;
  }>();
  if (!record) return Response.json({ error: "invalid_or_expired_token" }, { status: 400 });
  if (record.used_at && record.email_verified_at) {
    return Response.json({ ok: true, already_verified: true });
  }
  if (record.used_at) {
    return Response.json({ error: "invalid_or_expired_token" }, { status: 400 });
  }

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE email_verification_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL"
    ).bind(now, tokenHash),
    env.DB.prepare(
      "UPDATE users SET email_verified_at = datetime('now') WHERE id = ? AND lower(email) = ? AND email_verified_at IS NULL"
    ).bind(record.user_id, normalizeEmail(record.email)),
  ]);
  return Response.json({ ok: true });
}

export async function handleAuth(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });

  const body = await request.json() as {
    action?: string;
    email?: string;
    password?: string;
    name?: string;
    token?: string;
    locale?: string;
  };

  if (
    body.action === "signup"
    || body.action === "verify-email"
    || body.action === "request-password-reset"
    || body.action === "reset-password"
  ) {
    if (request.headers.get("X-Internal-Token") !== env.INTERNAL_SECRET) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (body.action === "signup") return handleSignup(body, request, env);
    if (body.action === "verify-email") return handleVerifyEmail(body, env);
    if (body.action === "request-password-reset") return handlePasswordResetRequest(body, request, env);
    return handlePasswordReset(body, env);
  }

  const email = normalizeEmail(body.email || "");
  const password = body.password || "";
  if (!email || !password || email.length > 254 || !EMAIL_PATTERN.test(email) || password.length > 256) {
    return Response.json({ error: "invalid_credentials" }, { status: 400 });
  }

  if (body.action === "login") {
    const now = Date.now();
    const trustedProxy = request.headers.get("X-Internal-Token") === env.INTERNAL_SECRET;
    const clientIp = trustedProxy
      ? request.headers.get("X-Client-IP") || "unknown"
      : request.headers.get("CF-Connecting-IP") || "unknown";
    const [emailHash, ipHash] = await Promise.all([sha256(email), sha256(clientIp)]);
    const loginWindowStart = now - LOGIN_WINDOW_MS;
    const [emailFailures, ipFailures] = await Promise.all([
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM email_auth_requests WHERE email_hash = ? AND action = 'login-failed' AND created_at > ?"
      ).bind(emailHash, loginWindowStart).first<{ count: number }>(),
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM email_auth_requests WHERE requested_ip_hash = ? AND action = 'login-failed' AND created_at > ?"
      ).bind(ipHash, loginWindowStart).first<{ count: number }>(),
    ]);
    if (
      (emailFailures?.count || 0) >= MAX_LOGIN_EMAIL_FAILURES
      || (ipFailures?.count || 0) >= MAX_LOGIN_IP_FAILURES
    ) {
      return Response.json({ error: "too_many_requests" }, { status: 429 });
    }

    const user = await env.DB.prepare(
      "SELECT id, email, name, password_hash, email_verified_at FROM users WHERE lower(email) = ?"
    ).bind(email).first<{
      id: string;
      email: string;
      name: string;
      password_hash: string | null;
      email_verified_at: string | null;
    }>();

    const passwordMatches = await verifyPassword(password, user?.password_hash || DUMMY_PASSWORD_HASH);
    if (!user?.password_hash || !passwordMatches) {
      await env.DB.prepare(
        "INSERT INTO email_auth_requests (id, email_hash, requested_ip_hash, action, created_at) VALUES (?, ?, ?, 'login-failed', ?)"
      ).bind(crypto.randomUUID(), emailHash, ipHash, now).run();
      return Response.json({ error: "invalid_credentials" }, { status: 401 });
    }
    if (!user.email_verified_at) {
      return Response.json({ error: "email_not_verified" }, { status: 403 });
    }

    // A legacy hash upgrade is best-effort and must never reject valid credentials.
    if (!user.password_hash.startsWith("pbkdf2-sha256$")) {
      try {
        await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
          .bind(await createPasswordHash(password), user.id).run();
      } catch (error) {
        console.error("Legacy password upgrade failed", user.id, error);
      }
    }
    await env.DB.prepare(
      "DELETE FROM email_auth_requests WHERE email_hash = ? AND action = 'login-failed'"
    ).bind(emailHash).run();

    return Response.json({ ok: true, id: user.id, email: user.email, name: user.name });
  }

  return Response.json({ error: "unknown action" }, { status: 400 });
}
