UPDATE channels
SET bubble_color = '#3598fe'
WHERE lower(bubble_color) = '#3b8df0';

UPDATE user_recent_channels
SET bubble_color = '#3598fe'
WHERE lower(bubble_color) = '#3b8df0';
