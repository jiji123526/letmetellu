-- Migration: 0002_banned_words.sql
-- Separate table for banned words (per-channel, with expiry)

CREATE TABLE banned_words (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  word TEXT NOT NULL,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  expires TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX banned_words_channel_idx ON banned_words(channel_id);
