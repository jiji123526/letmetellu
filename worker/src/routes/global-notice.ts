import type { Env } from "../types.ts";
import { isPlatformAdmin } from "../lib/special-channels.ts";
import { getTrustedUserId } from "../lib/trusted-identity.ts";

const GLOBAL_NOTICE_CONFIG_ID = "global_notice_dialog";
const GLOBAL_NOTICE_CHANNEL_ID = "__global__";
const MAX_GLOBAL_NOTICE_TITLE_LENGTH = 120;
const MAX_GLOBAL_NOTICE_BODY_LENGTH = 2_000;

interface StoredGlobalNotice {
  title: string;
  body: string;
  version: string;
}

function normalizeStoredGlobalNotice(value: unknown, fallbackVersion: string): StoredGlobalNotice | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as {
    title?: unknown;
    body?: unknown;
    version?: unknown;
  };
  if (typeof parsed.title !== "string" || !parsed.title.trim()) return null;
  if (parsed.title.trim().length > MAX_GLOBAL_NOTICE_TITLE_LENGTH) return null;
  if (parsed.body !== undefined && typeof parsed.body !== "string") return null;
  if (typeof parsed.body === "string" && parsed.body.trim().length > MAX_GLOBAL_NOTICE_BODY_LENGTH) return null;
  const version = typeof parsed.version === "string" && parsed.version ? parsed.version : fallbackVersion;
  return {
    title: parsed.title.trim(),
    body: typeof parsed.body === "string" ? parsed.body.trim() : "",
    version,
  };
}

async function readGlobalNotice(env: Env): Promise<StoredGlobalNotice | null> {
  const row = await env.DB.prepare(
    "SELECT text, updated_at FROM config WHERE id = ? LIMIT 1",
  ).bind(GLOBAL_NOTICE_CONFIG_ID).first<{ text: string | null; updated_at: string | null }>();
  if (!row?.text) return null;
  try {
    return normalizeStoredGlobalNotice(JSON.parse(row.text), row.updated_at || "");
  } catch {
    return null;
  }
}

export async function handleGlobalNotice(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    return Response.json({ notice: await readGlobalNotice(env) });
  }

  const userId = getTrustedUserId(request, env);
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!await isPlatformAdmin(userId, env)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  if (request.method === "POST") {
    const body = await request.json() as { title?: unknown; body?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const noticeBody = typeof body.body === "string" ? body.body.trim() : "";
    if (!title || title.length > MAX_GLOBAL_NOTICE_TITLE_LENGTH || noticeBody.length > MAX_GLOBAL_NOTICE_BODY_LENGTH) {
      return Response.json({ error: "invalid_global_notice" }, { status: 400 });
    }

    const notice: StoredGlobalNotice = {
      title,
      body: noticeBody,
      version: new Date().toISOString(),
    };
    await env.DB.prepare(
      "INSERT INTO config (id, text, channel_id) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_at = datetime('now')",
    ).bind(
      GLOBAL_NOTICE_CONFIG_ID,
      JSON.stringify(notice),
      GLOBAL_NOTICE_CHANNEL_ID,
    ).run();
    return Response.json({ ok: true, notice });
  }

  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM config WHERE id = ?").bind(GLOBAL_NOTICE_CONFIG_ID).run();
    return Response.json({ ok: true, notice: null });
  }

  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
