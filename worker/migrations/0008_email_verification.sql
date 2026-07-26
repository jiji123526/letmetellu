ALTER TABLE users ADD COLUMN email_verified_at TEXT;

-- Existing OAuth and credential users predate verification and keep access.
UPDATE users
SET email_verified_at = COALESCE(created_at, datetime('now'));

CREATE TABLE email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  requested_ip_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX email_verification_tokens_user_idx
  ON email_verification_tokens(user_id, created_at DESC);

CREATE INDEX email_verification_tokens_email_created_idx
  ON email_verification_tokens(email, created_at DESC);

CREATE INDEX email_verification_tokens_ip_created_idx
  ON email_verification_tokens(requested_ip_hash, created_at DESC);

CREATE TABLE email_auth_requests (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  requested_ip_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX email_auth_requests_email_action_idx
  ON email_auth_requests(email_hash, action, created_at DESC);

CREATE INDEX email_auth_requests_ip_action_idx
  ON email_auth_requests(requested_ip_hash, action, created_at DESC);
