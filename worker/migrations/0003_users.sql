-- Migration: 0003_users.sql
-- User accounts (registered channel owners)

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  image TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX users_email_idx ON users(email);
