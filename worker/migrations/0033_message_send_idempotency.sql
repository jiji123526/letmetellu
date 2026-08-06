-- Prevent duplicate chat and DM writes when a client retries an ambiguous send.
ALTER TABLE messages ADD COLUMN client_message_id TEXT;
ALTER TABLE dm ADD COLUMN client_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS messages_client_message_id_idx
  ON messages(client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dm_client_message_id_idx
  ON dm(client_message_id)
  WHERE client_message_id IS NOT NULL;
