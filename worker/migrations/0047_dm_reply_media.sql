-- Allow a channel owner to attach one managed image to a private DM reply.
ALTER TABLE dm_replies ADD COLUMN image TEXT;
