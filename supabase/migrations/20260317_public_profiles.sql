-- Public profile pages: add public read access and profile lookup RPC

-- 1. Public read RLS on profiles (non-sensitive fields only)
CREATE POLICY "Profiles are publicly readable"
  ON profiles FOR SELECT USING (true);

-- 2. Public read RLS on user_achievements
CREATE POLICY "Achievements are publicly readable"
  ON user_achievements FOR SELECT USING (true);

-- 3. Index on username for fast lookups
CREATE INDEX IF NOT EXISTS idx_profiles_username_lower
  ON profiles (lower(github_username));

-- 4. RPC: get_public_profile
CREATE OR REPLACE FUNCTION get_public_profile(p_username TEXT)
RETURNS JSONB AS $$
DECLARE
  profile_row RECORD;
  result JSONB;
  global_rank INT;
  repo_scores JSONB;
  completions JSONB;
  achievements JSONB;
BEGIN
  -- Find profile
  SELECT id, github_username, avatar_url, total_points, created_at
    INTO profile_row
    FROM profiles
    WHERE lower(github_username) = lower(p_username);

  IF profile_row IS NULL THEN
    RETURN NULL;
  END IF;

  -- Global rank
  SELECT COUNT(*) + 1 INTO global_rank
    FROM leaderboard_scores
    WHERE owner_repo = '__global__'
      AND total_points > COALESCE(profile_row.total_points, 0);

  -- Per-repo scores
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'owner_repo', ls.owner_repo,
      'total_points', ls.total_points,
      'base_points', ls.base_points,
      'completion_bonus', ls.completion_bonus,
      'unique_cards', ls.unique_cards,
      'total_cards_in_repo', ls.total_cards_in_repo
    ) ORDER BY ls.total_points DESC
  ), '[]'::jsonb)
  INTO repo_scores
  FROM leaderboard_scores ls
  WHERE ls.user_id = profile_row.id
    AND ls.owner_repo != '__global__'
    AND ls.total_points > 0;

  -- Completed repos
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'owner_repo', cc.owner_repo,
      'completed_at', cc.completed_at,
      'card_count', cc.card_count_at_completion,
      'insured', cc.insured
    )
  ), '[]'::jsonb)
  INTO completions
  FROM collection_completions cc
  WHERE cc.user_id = profile_row.id
    AND cc.is_complete = true;

  -- Achievements
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'owner_repo', ua.owner_repo,
      'stat_type', ua.stat_type,
      'threshold', ua.threshold,
      'unlocked_at', ua.unlocked_at
    ) ORDER BY ua.unlocked_at DESC
  ), '[]'::jsonb)
  INTO achievements
  FROM user_achievements ua
  WHERE ua.user_id = profile_row.id;

  -- Build result
  result := jsonb_build_object(
    'username', profile_row.github_username,
    'avatar_url', profile_row.avatar_url,
    'total_points', profile_row.total_points,
    'created_at', profile_row.created_at,
    'global_rank', global_rank,
    'repos', repo_scores,
    'completions', completions,
    'achievements', achievements
  );

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
