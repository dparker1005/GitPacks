-- Expand daily sprints to every repo with at least one mythic card.
-- Reserve weekly sprints for complete 100-card repos.
-- Cooldowns apply across sprint types because the eligible pools now overlap.

CREATE OR REPLACE FUNCTION create_sprint(
  p_type TEXT,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ
) RETURNS UUID AS $$
DECLARE
  v_cooldown_days INT;
  v_repo RECORD;
  v_sprint_id UUID;
BEGIN
  -- Only callable from service role (cron endpoint)
  IF current_setting('role', true) NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'create_sprint: service role required';
  END IF;

  -- Validate timestamps
  IF p_starts_at >= p_ends_at THEN
    RETURN NULL;
  END IF;

  -- Mythic count is Math.round(card_count * 0.03), so 17 cards is
  -- the smallest repo size that contains a mythic.
  IF p_type = 'daily' THEN
    v_cooldown_days := 30;
  ELSIF p_type = 'weekly' THEN
    v_cooldown_days := 90;
  ELSE
    RETURN NULL;
  END IF;

  SELECT rc.owner_repo INTO v_repo
  FROM repo_cache rc
  WHERE (
      (p_type = 'daily' AND rc.card_count >= 17)
      OR (p_type = 'weekly' AND rc.card_count = 100)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM sprint_repo_cooldowns src
      WHERE src.repo_owner || '/' || src.repo_name = rc.owner_repo
        AND src.last_used_at > NOW() - (v_cooldown_days || ' days')::INTERVAL
    )
    -- Don't pick a repo that's currently active in another sprint.
    AND NOT EXISTS (
      SELECT 1
      FROM sprints s
      WHERE s.repo_owner || '/' || s.repo_name = rc.owner_repo
        AND s.ends_at > NOW()
    )
  ORDER BY random()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_sprint_id := gen_random_uuid();

  INSERT INTO sprints (id, repo_owner, repo_name, type, starts_at, ends_at)
  VALUES (
    v_sprint_id,
    split_part(v_repo.owner_repo, '/', 1),
    split_part(v_repo.owner_repo, '/', 2),
    p_type,
    p_starts_at,
    p_ends_at
  );

  INSERT INTO sprint_repo_cooldowns (repo_owner, repo_name, type, last_used_at)
  VALUES (
    split_part(v_repo.owner_repo, '/', 1),
    split_part(v_repo.owner_repo, '/', 2),
    p_type,
    NOW()
  )
  ON CONFLICT (repo_owner, repo_name, type)
  DO UPDATE SET last_used_at = NOW();

  RETURN v_sprint_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
