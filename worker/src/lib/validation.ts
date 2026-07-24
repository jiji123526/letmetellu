import { Env } from "../types";

// Rate limiter: per-UID, max messages per window
const RATE_LIMIT = 5;
const RATE_WINDOW = 10000; // 10 seconds
const rateLimitMap = new Map<string, number[]>();
let lastCleanup = Date.now();

export function checkRateLimit(uid: string): boolean {
  const now = Date.now();

  // Cleanup stale entries every 60 seconds
  if (now - lastCleanup > 60000) {
    lastCleanup = now;
    for (const [key, timestamps] of rateLimitMap) {
      const recent = timestamps.filter((t) => now - t < RATE_WINDOW);
      if (recent.length === 0) rateLimitMap.delete(key);
      else rateLimitMap.set(key, recent);
    }
  }

  const timestamps = rateLimitMap.get(uid) || [];
  const recent = timestamps.filter((t) => now - t < RATE_WINDOW);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  rateLimitMap.set(uid, recent);
  return true;
}

// Message length cap
const MAX_MESSAGE_LENGTH = 5000;

export function checkMessageLength(text: string): boolean {
  return text.length <= MAX_MESSAGE_LENGTH;
}

// Banned words check — cached per channel (1 min TTL)
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
    cached = { words, expires: now + 60000 }; // 1 min TTL
    bannedWordsCache.set(channelId, cached);
  }

  if (cached.words.length === 0) return true;

  const lowerText = text.toLowerCase();
  for (const word of cached.words) {
    if (lowerText.includes(word)) return false;
  }
  return true;
}
