import type { Env } from "../types.ts";

// Message length cap
const MAX_MESSAGE_LENGTH = 5000;

export function checkMessageLength(text: string): boolean {
  return text.length <= MAX_MESSAGE_LENGTH;
}

// Banned words check — cached per channel (10s TTL)
const bannedWordsCache = new Map<string, { words: string[]; expires: number }>();

export function invalidateBannedWordsCache(channelId: string) {
  bannedWordsCache.delete(channelId);
}

export async function checkBannedWords(text: string, channelId: string, env: Env): Promise<boolean> {
  const now = Date.now();
  let cached = bannedWordsCache.get(channelId);

  if (!cached || now > cached.expires) {
    const { results } = await env.DB.prepare(
      "SELECT word FROM banned_words WHERE channel_id = ? AND (expires IS NULL OR expires > datetime('now'))"
    ).bind(channelId).all();

    const words = (results || []).map((r) => (r.word as string).toLowerCase());
    cached = { words, expires: now + 10000 }; // 10s TTL
    bannedWordsCache.set(channelId, cached);
  }

  if (cached.words.length === 0) return true;

  const lowerText = text.toLowerCase();
  for (const word of cached.words) {
    if (lowerText.includes(word)) return false;
  }
  return true;
}

export function invalidatePasscodeCache(channelId: string) {
  // Retained for callers that also invalidate other channel policy state.
  // Authorization reads intentionally bypass isolate-local caches so passcode
  // changes and deletions take effect on every Worker isolate immediately.
  void channelId;
}

export async function getChannelPasscodeInfo(
  channelId: string,
  env: Env,
): Promise<{ exists: boolean; passcode: string | null; owner_uid: string }> {
  const channel = await env.DB.prepare("SELECT passcode, owner_uid FROM channels WHERE id = ?")
    .bind(channelId).first() as { passcode: string | null; owner_uid: string } | null;

  if (!channel) return { exists: false, passcode: null, owner_uid: "" };
  return { exists: true, passcode: channel.passcode, owner_uid: channel.owner_uid };
}
