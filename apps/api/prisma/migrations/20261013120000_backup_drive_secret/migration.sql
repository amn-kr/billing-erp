-- Real-time backup, part 3: a place's login (for Google Drive, the refresh token), locked with a key
-- made from BACKUP_MASTER_KEY for this shop. Never shown by the API, never logged; empty when not connected.
ALTER TABLE backup_destinations ADD COLUMN secret TEXT NOT NULL DEFAULT '';
