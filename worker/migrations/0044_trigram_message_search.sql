-- Replace the unused default-tokenizer FTS index with an index that preserves
-- arbitrary substring search for queries containing at least three code points.
DROP TRIGGER IF EXISTS messages_ai;
DROP TRIGGER IF EXISTS messages_ad;
DROP TRIGGER IF EXISTS messages_au;
DROP TABLE IF EXISTS messages_fts;

CREATE VIRTUAL TABLE messages_fts USING fts5(
  text,
  content='messages',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text)
  VALUES('delete', old.rowid, old.text);
END;

CREATE TRIGGER messages_au AFTER UPDATE OF text ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text)
  VALUES('delete', old.rowid, old.text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;

INSERT INTO messages_fts(messages_fts) VALUES('rebuild');
