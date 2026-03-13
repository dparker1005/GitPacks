-- GitPacks Database Schema
-- Run this in your Supabase SQL Editor

-- Repo cache (contributor data per repo)
CREATE TABLE IF NOT EXISTS repo_cache (
  owner_repo TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '[]',
  card_count INTEGER NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- repo_cache is public read (no auth needed), write via service role or anon with no RLS

-- Migration: if repo_cache already exists, add card_count and backfill
-- ALTER TABLE repo_cache ADD COLUMN IF NOT EXISTS card_count INTEGER NOT NULL DEFAULT 0;
-- UPDATE repo_cache SET card_count = jsonb_array_length(data) WHERE card_count = 0;

-- Profiles table (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  github_username TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  ready_packs INTEGER NOT NULL DEFAULT 10,
  last_regen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User collections (cards collected per repo)
CREATE TABLE IF NOT EXISTS user_collections (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  owner_repo TEXT NOT NULL,
  login TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, owner_repo, login)
);

-- User packs (pity tracking per user per repo)
CREATE TABLE IF NOT EXISTS user_packs (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  owner_repo TEXT NOT NULL,
  packs_opened INTEGER NOT NULL DEFAULT 0,
  packs_since_legendary INTEGER NOT NULL DEFAULT 0,
  packs_since_mythic INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, owner_repo)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_collections_user_repo ON user_collections(user_id, owner_repo);
CREATE INDEX IF NOT EXISTS idx_user_packs_user_repo ON user_packs(user_id, owner_repo);

-- RLS Policies
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_packs ENABLE ROW LEVEL SECURITY;

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

CREATE INDEX IF NOT EXISTS idx_user_self_cards_user ON user_self_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user_repo ON user_achievements(user_id, owner_repo);

ALTER TABLE user_self_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own self cards" ON user_self_cards FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Allow insert self cards" ON user_self_cards FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can view own achievements" ON user_achievements FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Allow insert achievements" ON user_achievements FOR INSERT WITH CHECK (true);
