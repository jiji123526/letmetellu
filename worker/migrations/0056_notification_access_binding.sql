-- Bind protected-channel notification preferences to the passcode version
-- that was valid when the authenticated user opted in.

ALTER TABLE notification_preferences ADD COLUMN access_binding TEXT;
