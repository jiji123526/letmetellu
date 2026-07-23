-- Migration: 0001_initial_schema.sql
-- D1 schema for letsplay-platform

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'My Channel',
  profile_image TEXT,
  bubble_color TEXT DEFAULT '#3b8df0',
  passcode TEXT,
  notice TEXT DEFAULT '[]',
  is_frozen INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE moderators (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  role TEXT DEFAULT 'mod',
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (channel_id, uid)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  uid TEXT NOT NULL,
  auth_uid TEXT NOT NULL,
  nick TEXT,
  text TEXT DEFAULT '',
  is_admin INTEGER DEFAULT 0,
  reply_to TEXT,
  report INTEGER DEFAULT 0,
  reported_msg_id TEXT,
  gallery_id TEXT,
  dm INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0,
  edited INTEGER DEFAULT 0,
  reported INTEGER DEFAULT 0,
  reactions TEXT DEFAULT '{}',
  image TEXT,
  image_w INTEGER,
  image_h INTEGER,
  fingerprint TEXT,
  channel_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  FOREIGN KEY (reply_to) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE TABLE blocked (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  uid TEXT NOT NULL,
  reason TEXT DEFAULT '',
  fingerprint TEXT,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE dm (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  uid TEXT NOT NULL,
  auth_uid TEXT,
  nick TEXT,
  text TEXT DEFAULT '',
  image TEXT,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE gallery (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  image TEXT NOT NULL,
  auth_uid TEXT,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE config (
  id TEXT PRIMARY KEY,
  text TEXT DEFAULT '',
  channel_id TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX messages_channel_idx ON messages(channel_id, created_at);
CREATE INDEX blocked_channel_idx ON blocked(channel_id);
CREATE INDEX gallery_channel_idx ON gallery(channel_id, created_at);

-- Full-Text Search
CREATE VIRTUAL TABLE messages_fts USING fts5(
  text,
  content='messages',
  content_rowid='rowid'
);

CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;

CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;
