CREATE TABLE IF NOT EXISTS support_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  entry_topic TEXT,
  current_node_id TEXT NOT NULL,
  resolved_via_tree INTEGER NOT NULL DEFAULT 0,
  escalated_thread_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS support_sessions_user_status_idx
  ON support_sessions(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS support_session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES support_sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  node_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS support_session_events_session_idx
  ON support_session_events(session_id, created_at ASC);

CREATE TABLE IF NOT EXISTS support_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_session_id TEXT REFERENCES support_sessions(id) ON DELETE SET NULL,
  entry_topic TEXT,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  closed_at TEXT,
  closed_by TEXT
);

CREATE INDEX IF NOT EXISTS support_threads_user_status_idx
  ON support_threads(user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS support_threads_status_updated_idx
  ON support_threads(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL,
  sender_user_id TEXT,
  text TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS support_messages_thread_idx
  ON support_messages(thread_id, created_at ASC);
