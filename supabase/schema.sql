-- GitPacks Database Schema
-- Run this in your Supabase SQL Editor

-- Repo cache (contributor data per repo)
CREATE TABLE IF NOT EXISTS repo_cache (
  owner_repo TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '[]',
  card_count INTEGER NOT NULL DEFAULT 0,
  contributor_logins TEXT[] DEFAULT '{}',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repo_cache_logins ON repo_cache USING GIN (contributor_logins);

-- repo_cache is public read (no auth needed), write via service role or anon with no RLS

-- Profiles table (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  github_username TEXT NOT NULL DEFAULT '',
  avatar_url TEXT DEFAULT '',
  ready_packs INTEGER NOT NULL DEFAULT 10,
  last_regen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User collections (cards collected per repo)
CREATE TABLE IF NOT EXISTS user_collections (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  owner_repo TEXT NOT NULL,
  contributor_login TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  first_collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, owner_repo, contributor_login)
);

-- User packs (pity tracking per user per repo)
CREATE TABLE IF NOT EXISTS user_packs (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  owner_repo TEXT NOT NULL,
  total_opened INTEGER NOT NULL DEFAULT 0,
  packs_since_legendary INTEGER NOT NULL DEFAULT 0,
  packs_since_mythic INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, owner_repo)
);

-- Self-card grants (permanent, one per user per repo)
CREATE TABLE IF NOT EXISTS user_self_cards (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  owner_repo TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, owner_repo)
);

-- Achievement milestones
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  owner_repo TEXT NOT NULL,
  stat_type TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, owner_repo, stat_type, threshold)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_collections_user_repo ON user_collections(user_id, owner_repo);
CREATE INDEX IF NOT EXISTS idx_user_packs_user_repo ON user_packs(user_id, owner_repo);
CREATE INDEX IF NOT EXISTS idx_user_self_cards_user ON user_self_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user_repo ON user_achievements(user_id, owner_repo);

-- RLS Policies
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_self_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update their own profile
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Collections: users can manage their own collections
CREATE POLICY "Users can view own collections" ON user_collections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own collections" ON user_collections FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own collections" ON user_collections FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own collections" ON user_collections FOR DELETE USING (auth.uid() = user_id);

-- Packs: users can manage their own pack state
CREATE POLICY "Users can view own packs" ON user_packs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own packs" ON user_packs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own packs" ON user_packs FOR UPDATE USING (auth.uid() = user_id);

-- Self-cards: users can view own, insert with any auth
CREATE POLICY "Users can view own self cards" ON user_self_cards FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Allow insert self cards" ON user_self_cards FOR INSERT WITH CHECK (true);

-- Achievements: users can view own, insert with any auth
CREATE POLICY "Users can view own achievements" ON user_achievements FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Allow insert achievements" ON user_achievements FOR INSERT WITH CHECK (true);

-- RPC Functions

-- Atomic card addition: INSERT ON CONFLICT DO UPDATE SET count = count + new
CREATE OR REPLACE FUNCTION add_cards(
  p_user_id UUID,
  p_owner_repo TEXT,
  p_cards JSONB -- array of {"login": "name", "count": 1}
) RETURNS VOID AS $$
DECLARE
  card JSONB;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  FOR card IN SELECT * FROM jsonb_array_elements(p_cards)
  LOOP
    INSERT INTO user_collections (user_id, owner_repo, contributor_login, count)
    VALUES (p_user_id, p_owner_repo, card->>'login', (card->>'count')::INT)
    ON CONFLICT (user_id, owner_repo, contributor_login)
    DO UPDATE SET count = user_collections.count + (card->>'count')::INT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic pack decrement: returns false if no packs available (race-safe)
CREATE OR REPLACE FUNCTION decrement_pack(
  p_user_id UUID,
  p_max_packs INT DEFAULT 2
) RETURNS TABLE(success BOOLEAN, new_ready_packs INT, new_last_regen_at TIMESTAMPTZ) AS $$
DECLARE
  cur_packs INT;
  cur_regen TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT ready_packs, last_regen_at INTO cur_packs, cur_regen
  FROM profiles WHERE id = p_user_id FOR UPDATE;

  IF cur_packs IS NULL THEN
    RETURN QUERY SELECT false, 0, NOW();
    RETURN;
  END IF;

  IF cur_packs <= 0 THEN
    RETURN QUERY SELECT false, 0, cur_regen;
    RETURN;
  END IF;

  IF cur_packs >= p_max_packs AND (cur_packs - 1) < p_max_packs THEN
    cur_regen := NOW();
  END IF;

  UPDATE profiles
  SET ready_packs = cur_packs - 1, last_regen_at = cur_regen
  WHERE id = p_user_id;

  RETURN QUERY SELECT true, (cur_packs - 1)::INT, cur_regen;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
