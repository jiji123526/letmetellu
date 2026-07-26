UPDATE channels
SET show_on_profile = 0
WHERE id NOT LIKE '%_live';
