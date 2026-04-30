-- Site-wide refresh cooldown coordinator.
--
-- One row per coordination key. The repo route claims the slot atomically by
-- updating the row's updated_at WHERE updated_at < now() - interval '5 minutes'
-- and treating a 1-row RETURNING as "we won the race". If 0 rows return,
-- another request claimed it within the cooldown window — skip.
--
-- Generic shape (TEXT key) so future cooldowns or singleton flags can share
-- the table without another migration.
CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the refresh cooldown row well in the past so the very first request
-- after deploy can claim it.
INSERT INTO system_state (key, updated_at)
VALUES ('last_repo_refresh', '2000-01-01T00:00:00Z')
ON CONFLICT (key) DO NOTHING;

-- Server-only access (claim writes go through the service-role client).
ALTER TABLE system_state ENABLE ROW LEVEL SECURITY;
