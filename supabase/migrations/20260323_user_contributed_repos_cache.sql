-- Cache GitHub events-discovered contributed repos per user (avoid 3 API calls per dashboard load)
CREATE TABLE IF NOT EXISTS user_contributed_repos_cache (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  repo_names TEXT[] NOT NULL DEFAULT '{}',
  last_fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_contributed_repos_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own contributed repos cache" ON user_contributed_repos_cache FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users upsert own contributed repos cache" ON user_contributed_repos_cache FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own contributed repos cache" ON user_contributed_repos_cache FOR UPDATE USING (auth.uid() = user_id);
