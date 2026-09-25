CREATE INDEX dm_notification_owners_channel_user_dm_idx
  ON dm_notification_owners(channel_id, user_id, dm_id);

CREATE INDEX message_notification_owners_channel_user_message_idx
  ON message_notification_owners(channel_id, user_id, message_id);
