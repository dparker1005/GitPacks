-- Sprint participant counts, sprint finalization and cards-by-contributor all
-- filter user_collections by owner_repo alone; the PK leads with user_id, so
-- these were sequential scans of the whole table.
CREATE INDEX IF NOT EXISTS idx_user_collections_repo_user ON user_collections (owner_repo, user_id);
