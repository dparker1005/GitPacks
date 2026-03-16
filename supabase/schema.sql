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
  total_points INTEGER NOT NULL DEFAULT 0,
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

-- Collection completions (tracks when a user completes a repo's collection)
CREATE TABLE IF NOT EXISTS collection_completions (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  owner_repo TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  card_count_at_completion INTEGER NOT NULL DEFAULT 0,
  is_complete BOOLEAN NOT NULL DEFAULT TRUE,
  insured BOOLEAN NOT NULL DEFAULT FALSE,
  insured_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, owner_repo)
);

-- Leaderboard scores (cached, event-driven updates)
CREATE TABLE IF NOT EXISTS leaderboard_scores (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  owner_repo TEXT NOT NULL,  -- '__global__' for cross-repo total
  base_points INTEGER NOT NULL DEFAULT 0,
  completion_bonus INTEGER NOT NULL DEFAULT 0,
  total_points INTEGER NOT NULL DEFAULT 0,
  unique_cards INTEGER NOT NULL DEFAULT 0,
  total_cards_in_repo INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, owner_repo)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_repo_total ON leaderboard_scores(owner_repo, total_points DESC);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_collections_user_repo ON user_collections(user_id, owner_repo);
CREATE INDEX IF NOT EXISTS idx_user_packs_user_repo ON user_packs(user_id, owner_repo);
CREATE INDEX IF NOT EXISTS idx_user_self_cards_user ON user_self_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user_repo ON user_achievements(user_id, owner_repo);
CREATE INDEX IF NOT EXISTS idx_collection_completions_user ON collection_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_global ON leaderboard_scores(total_points DESC) WHERE owner_repo = '__global__';

-- RLS Policies
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_self_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_scores ENABLE ROW LEVEL SECURITY;

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

-- Collection completions: users can view own (writes via RPC only)
CREATE POLICY "Users can view own completions" ON collection_completions FOR SELECT USING (auth.uid() = user_id);

-- Leaderboard scores: publicly readable (writes via RPC only)
CREATE POLICY "Leaderboard is publicly readable" ON leaderboard_scores FOR SELECT USING (true);

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

-- Compute a user's score for a specific repo from current rarity data
CREATE OR REPLACE FUNCTION compute_user_repo_score(
  p_user_id UUID,
  p_owner_repo TEXT
) RETURNS TABLE(base_points INT, unique_cards INT, total_cards_in_repo INT) AS $$
DECLARE
  repo_data JSONB;
  card JSONB;
  pts INT := 0;
  uniq INT := 0;
  total INT := 0;
  rarity_points JSONB := '{"common":1,"rare":2,"epic":5,"legendary":15,"mythic":50}';
BEGIN
  SELECT data INTO repo_data FROM repo_cache WHERE owner_repo = p_owner_repo;
  IF repo_data IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  total := jsonb_array_length(repo_data);

  FOR card IN SELECT * FROM jsonb_array_elements(repo_data)
  LOOP
    IF EXISTS (
      SELECT 1 FROM user_collections uc
      WHERE uc.user_id = p_user_id
        AND uc.owner_repo = p_owner_repo
        AND uc.contributor_login = card->>'login'
    ) THEN
      uniq := uniq + 1;
      pts := pts + COALESCE((rarity_points->>( card->>'rarity' ))::INT, 0);
    END IF;
  END LOOP;

  RETURN QUERY SELECT pts, uniq, total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recompute all scores for a user (all repos + global), update completion status
CREATE OR REPLACE FUNCTION refresh_user_scores(p_user_id UUID) RETURNS VOID AS $$
DECLARE
  repo RECORD;
  score RECORD;
  comp RECORD;
  bonus INT;
  global_total INT := 0;
BEGIN
  FOR repo IN
    SELECT DISTINCT owner_repo FROM user_collections WHERE user_id = p_user_id
  LOOP
    SELECT * INTO score FROM compute_user_repo_score(p_user_id, repo.owner_repo);

    bonus := 0;
    SELECT * INTO comp FROM collection_completions
      WHERE user_id = p_user_id AND owner_repo = repo.owner_repo;

    IF score.unique_cards = score.total_cards_in_repo AND score.total_cards_in_repo > 0 THEN
      -- Collection is complete: bonus = 50% of base
      bonus := (score.base_points * 0.5)::INT;
      INSERT INTO collection_completions (user_id, owner_repo, card_count_at_completion, is_complete)
        VALUES (p_user_id, repo.owner_repo, score.total_cards_in_repo, TRUE)
        ON CONFLICT (user_id, owner_repo) DO UPDATE SET
          is_complete = TRUE,
          card_count_at_completion = score.total_cards_in_repo,
          completed_at = CASE
            WHEN collection_completions.is_complete THEN collection_completions.completed_at
            ELSE NOW()
          END;
    ELSIF comp IS NOT NULL THEN
      -- Was previously complete, now incomplete
      IF comp.insured THEN
        bonus := (score.base_points * 0.5)::INT;
      ELSE
        UPDATE collection_completions SET is_complete = FALSE
          WHERE user_id = p_user_id AND owner_repo = repo.owner_repo;
      END IF;
    END IF;

    INSERT INTO leaderboard_scores (user_id, owner_repo, base_points, completion_bonus, total_points, unique_cards, total_cards_in_repo, updated_at)
      VALUES (p_user_id, repo.owner_repo, score.base_points, bonus, score.base_points + bonus, score.unique_cards, score.total_cards_in_repo, NOW())
      ON CONFLICT (user_id, owner_repo) DO UPDATE SET
        base_points = score.base_points,
        completion_bonus = bonus,
        total_points = score.base_points + bonus,
        unique_cards = score.unique_cards,
        total_cards_in_repo = score.total_cards_in_repo,
        updated_at = NOW();

    global_total := global_total + score.base_points + bonus;
  END LOOP;

  -- Upsert global leaderboard row
  INSERT INTO leaderboard_scores (user_id, owner_repo, base_points, completion_bonus, total_points, unique_cards, total_cards_in_repo, updated_at)
    VALUES (p_user_id, '__global__', global_total, 0, global_total, 0, 0, NOW())
    ON CONFLICT (user_id, owner_repo) DO UPDATE SET
      total_points = global_total,
      updated_at = NOW();

  -- Cache on profile for quick display
  UPDATE profiles SET total_points = global_total WHERE id = p_user_id;
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
