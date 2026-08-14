-- Supports the two-row init probe and the five-channel owner popup ordering.
CREATE INDEX IF NOT EXISTS channels_owner_profile_created_id_idx
  ON channels(owner_uid, show_on_profile, created_at, id);
