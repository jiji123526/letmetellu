import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_CHANNEL = "main";
const TARGET_CHANNEL = "zziks";
// Preserve legacy files accepted by the former service without changing the
// current application's stricter 10 MB limit for new uploads.
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

function parseEnv(raw) {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("\0", "").replaceAll("'", "''")}'`;
}

function legacyId(kind, id) {
  return `legacy-${SOURCE_CHANNEL}-${kind}-${id}`;
}

function legacyActor(value) {
  const digest = createHash("sha256").update(`yap-legacy-main:${value || "unknown"}`).digest("hex").slice(0, 32);
  return `legacy_${digest}`;
}

function extensionFor(contentType, url) {
  const normalized = contentType.split(";")[0].trim().toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/jpeg") return "jpg";
  const pathname = new URL(url).pathname.toLowerCase();
  const match = pathname.match(/\.(png|gif|webp|jpe?g)$/);
  return match ? match[1].replace("jpeg", "jpg") : "jpg";
}

async function fetchAll(baseUrl, headers, table, select) {
  const pageSize = 500;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${baseUrl}/rest/v1/${table}`);
    url.searchParams.set("channel_id", `eq.${SOURCE_CHANNEL}`);
    url.searchParams.set("select", select);
    url.searchParams.set("order", "created_at.asc");
    const response = await fetch(url, {
      headers: { ...headers, Range: `${offset}-${offset + pageSize - 1}` },
    });
    if (!response.ok) throw new Error(`${table} export failed: ${response.status} ${await response.text()}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

const sourceEnvPath = process.argv[2];
const outputDir = process.argv[3];
if (!sourceEnvPath || !outputDir) {
  throw new Error("usage: node scripts/prepare-legacy-main-migration.mjs <source .env.local> <output directory>");
}

const env = parseEnv(await readFile(sourceEnvPath, "utf8"));
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw new Error("missing Supabase migration credentials");
await mkdir(outputDir, { recursive: true });
await mkdir(path.join(outputDir, "media"), { recursive: true });

const headers = {
  apikey: env.SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
};
const [messages, gallery] = await Promise.all([
  fetchAll(env.SUPABASE_URL, headers, "messages", "id,uid,auth_uid,nick,text,is_admin,reply_to,report,reported_msg_id,gallery_id,dm,deleted,edited,reported,reactions,image,image_w,image_h,channel_id,created_at"),
  fetchAll(env.SUPABASE_URL, headers, "gallery", "id,image,channel_id,created_at"),
]);

if (messages.some((message) => message.report || message.dm)) {
  throw new Error("source contains report or DM message rows; migration scope must be reviewed");
}
const messageIds = new Set(messages.map((message) => message.id));
for (const message of messages) {
  if (message.reply_to && !messageIds.has(message.reply_to)) {
    throw new Error(`missing reply parent ${message.reply_to} for ${message.id}`);
  }
}
const galleryById = new Map(gallery.map((item) => [item.id, item]));
const messageByGalleryId = new Map(
  messages.filter((message) => message.gallery_id).map((message) => [message.gallery_id, message]),
);
for (const message of messages) {
  if (message.gallery_id && !galleryById.has(message.gallery_id)) {
    throw new Error(`missing gallery ${message.gallery_id} for ${message.id}`);
  }
}

const mediaSources = new Set();
for (const item of gallery) if (item.image) mediaSources.add(item.image);
for (const message of messages) if (message.image) mediaSources.add(message.image);

const mediaManifest = [];
const mediaUrlMap = new Map();
let mediaIndex = 0;
for (const sourceUrl of mediaSources) {
  mediaIndex += 1;
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`media download failed (${response.status}): ${sourceUrl}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) {
    throw new Error(`invalid media size ${bytes.length}: ${sourceUrl}`);
  }
  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!contentType.toLowerCase().startsWith("image/")) throw new Error(`invalid media type ${contentType}: ${sourceUrl}`);
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 20);
  const extension = extensionFor(contentType, sourceUrl);
  const key = `${TARGET_CHANNEL}/legacy-main/${String(mediaIndex).padStart(3, "0")}-${digest}.${extension}`;
  const filename = `${String(mediaIndex).padStart(3, "0")}-${digest}.${extension}`;
  await writeFile(path.join(outputDir, "media", filename), bytes);
  const targetUrl = `/api/media/${key}`;
  mediaUrlMap.set(sourceUrl, { key, targetUrl, filename, contentType: contentType.split(";")[0] });
  mediaManifest.push({ key, filename, contentType: contentType.split(";")[0], bytes: bytes.length });
}

const lines = [
  "PRAGMA foreign_keys = ON;",
];

for (const item of gallery) {
  const media = mediaUrlMap.get(item.image);
  if (!media) throw new Error(`gallery media not prepared: ${item.id}`);
  const sourceMessage = messageByGalleryId.get(item.id);
  const galleryId = sourceMessage ? legacyId("message", sourceMessage.id) : legacyId("gallery", item.id);
  lines.push(`INSERT INTO gallery (id, image, auth_uid, channel_id, created_at) VALUES (${sql(galleryId)}, ${sql(media.targetUrl)}, NULL, ${sql(TARGET_CHANNEL)}, ${sql(item.created_at)});`);
}

for (const message of messages) {
  const galleryItem = message.gallery_id ? galleryById.get(message.gallery_id) : null;
  const sourceImage = galleryItem?.image || message.image || null;
  const media = sourceImage ? mediaUrlMap.get(sourceImage) : null;
  const reactions = typeof message.reactions === "string" ? message.reactions : JSON.stringify(message.reactions || {});
  lines.push(`INSERT INTO messages (id, uid, auth_uid, nick, text, is_admin, reply_to, report, reported_msg_id, gallery_id, dm, deleted, edited, reported, reactions, image, image_w, image_h, fingerprint, channel_id, created_at) VALUES (${sql(legacyId("message", message.id))}, ${sql(legacyActor(message.uid))}, ${sql(legacyActor(message.auth_uid))}, ${sql(message.nick)}, ${sql(message.text || "")}, ${sql(Boolean(message.is_admin))}, NULL, 0, NULL, ${sql(message.gallery_id ? legacyId("message", message.id) : null)}, 0, ${sql(Boolean(message.deleted))}, ${sql(Boolean(message.edited))}, ${sql(Boolean(message.reported))}, ${sql(reactions)}, ${sql(media?.targetUrl || null)}, ${sql(message.image_w)}, ${sql(message.image_h)}, NULL, ${sql(TARGET_CHANNEL)}, ${sql(message.created_at)});`);
  if (/https?:\/\/|www\./i.test(message.text || "")) {
    lines.push(`INSERT INTO message_links (message_id, channel_id, created_at) VALUES (${sql(legacyId("message", message.id))}, ${sql(TARGET_CHANNEL)}, ${sql(message.created_at)});`);
  }
}

for (const message of messages) {
  if (message.reply_to) {
    lines.push(`UPDATE messages SET reply_to = ${sql(legacyId("message", message.reply_to))} WHERE id = ${sql(legacyId("message", message.id))};`);
  }
}

for (const message of messages) {
  const galleryItem = message.gallery_id ? galleryById.get(message.gallery_id) : null;
  const sourceImage = galleryItem?.image || message.image || null;
  if (!sourceImage) continue;
  const media = mediaUrlMap.get(sourceImage);
  if (!media) throw new Error(`message media not prepared: ${message.id}`);
  const createdAt = message.created_at || new Date().toISOString();
  lines.push(`INSERT INTO upload_tickets (id, key, channel_id, uid, auth_uid, purpose, ip_hash, status, attached_record_id, attached_record_type, created_at, expires_at) VALUES (${sql(randomUUID())}, ${sql(media.key)}, ${sql(TARGET_CHANNEL)}, ${sql(legacyActor(message.uid))}, ${sql(legacyActor(message.auth_uid))}, 'message', 'legacy-migration', 'attached', ${sql(legacyId("message", message.id))}, 'message', ${sql(createdAt)}, ${sql("2099-01-01T00:00:00.000Z")});`);
}

await writeFile(path.join(outputDir, "import.sql"), `${lines.join("\n")}\n`, "utf8");
await writeFile(path.join(outputDir, "media-manifest.json"), `${JSON.stringify(mediaManifest, null, 2)}\n`, "utf8");
await writeFile(path.join(outputDir, "summary.json"), `${JSON.stringify({
  sourceChannel: SOURCE_CHANNEL,
  targetChannel: TARGET_CHANNEL,
  messages: messages.length,
  replies: messages.filter((message) => message.reply_to).length,
  edited: messages.filter((message) => message.edited).length,
  gallery: gallery.length,
  mediaObjects: mediaManifest.length,
  mediaBytes: mediaManifest.reduce((sum, item) => sum + item.bytes, 0),
}, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  outputDir,
  messages: messages.length,
  replies: messages.filter((message) => message.reply_to).length,
  gallery: gallery.length,
  mediaObjects: mediaManifest.length,
  mediaBytes: mediaManifest.reduce((sum, item) => sum + item.bytes, 0),
}, null, 2));
