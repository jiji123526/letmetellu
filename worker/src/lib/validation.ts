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

// Passcode cache — per channel (30s TTL)
const passcodeCache = new Map<string, { passcode: string | null; ownerUid: string; expires: number }>();

export function invalidatePasscodeCache(channelId: string) {
  passcodeCache.delete(channelId);
}

export async function getChannelPasscodeInfo(channelId: string, env: Env): Promise<{ passcode: string | null; owner_uid: string }> {
  const now = Date.now();
  const cached = passcodeCache.get(channelId);
  if (cached && now < cached.expires) {
    return { passcode: cached.passcode, owner_uid: cached.ownerUid };
  }

  const channel = await env.DB.prepare("SELECT passcode, owner_uid FROM channels WHERE id = ?")
    .bind(channelId).first() as { passcode: string | null; owner_uid: string } | null;

  if (!channel) return { passcode: null, owner_uid: "" };

  passcodeCache.set(channelId, { passcode: channel.passcode, ownerUid: channel.owner_uid, expires: now + 30000 });
  return { passcode: channel.passcode, owner_uid: channel.owner_uid };
}
