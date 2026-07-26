ALTER TABLE channels ADD COLUMN background_type TEXT NOT NULL DEFAULT 'default'
  CHECK (background_type IN ('default', 'color', 'image'));
ALTER TABLE channels ADD COLUMN background_color TEXT;
ALTER TABLE channels ADD COLUMN background_image TEXT;
ALTER TABLE channels ADD COLUMN background_overlay INTEGER NOT NULL DEFAULT 14
  CHECK (background_overlay BETWEEN 0 AND 60);
ALTER TABLE channels ADD COLUMN background_blur INTEGER NOT NULL DEFAULT 0
  CHECK (background_blur IN (0, 1));
