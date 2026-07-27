-- Sprints no longer require a commit step.
--
-- During a sprint nothing is written to sprint_entries at all. Power is derived
-- on demand from the user's collection so it always reflects the cards they own
-- right now. At finalization every user holding at least one card for the
-- featured repo is scored, whether or not they ever visited the repo.
--
-- Also widens repo eligibility: daily sprints need any repo containing a mythic
-- (Math.round(card_count * 0.03) >= 1, so 17 cards), weekly sprints stay
-- reserved for complete 100-card repos.

-- Shared lineup selection: fill the five slots from the top down. Each lower
-- slot excludes cards already used above it and enforces its maximum rarity.
CREATE OR REPLACE FUNCTION sprint_lineup_for_user(
  p_sprint_id UUID,
  p_user_id UUID,
  OUT card_common TEXT,
  OUT card_rare TEXT,
  OUT card_epic TEXT,
  OUT card_legendary TEXT,
  OUT card_mythic TEXT,
  OUT total_power INT
) AS $$
DECLARE
  v_owner_repo TEXT;
  v_repo_data JSONB;
  v_power INT;
BEGIN
  total_power := 0;

  SELECT s.repo_owner || '/' || s.repo_name, rc.data
  INTO v_owner_repo, v_repo_data
  FROM sprints s
  JOIN repo_cache rc
    ON rc.owner_repo = s.repo_owner || '/' || s.repo_name
  WHERE s.id = p_sprint_id;

  IF v_repo_data IS NULL THEN
    RETURN;
  END IF;

  SELECT elem->>'login', COALESCE((elem->>'power')::INT, 0)
  INTO card_mythic, v_power
  FROM user_collections uc
  JOIN LATERAL jsonb_array_elements(v_repo_data) elem
    ON elem->>'login' = uc.contributor_login
  WHERE uc.user_id = p_user_id
    AND uc.owner_repo = v_owner_repo
    AND uc.count > 0
  ORDER BY COALESCE((elem->>'power')::INT, 0) DESC, elem->>'login'
  LIMIT 1;
  total_power := total_power + COALESCE(v_power, 0);

  SELECT elem->>'login', COALESCE((elem->>'power')::INT, 0)
  INTO card_legendary, v_power
  FROM user_collections uc
  JOIN LATERAL jsonb_array_elements(v_repo_data) elem
    ON elem->>'login' = uc.contributor_login
  WHERE uc.user_id = p_user_id
    AND uc.owner_repo = v_owner_repo
    AND uc.count > 0
    AND elem->>'rarity' IN ('common', 'rare', 'epic', 'legendary')
    AND (card_mythic IS NULL OR elem->>'login' <> card_mythic)
  ORDER BY COALESCE((elem->>'power')::INT, 0) DESC, elem->>'login'
  LIMIT 1;
  total_power := total_power + COALESCE(v_power, 0);

  SELECT elem->>'login', COALESCE((elem->>'power')::INT, 0)
  INTO card_epic, v_power
  FROM user_collections uc
  JOIN LATERAL jsonb_array_elements(v_repo_data) elem
    ON elem->>'login' = uc.contributor_login
  WHERE uc.user_id = p_user_id
    AND uc.owner_repo = v_owner_repo
    AND uc.count > 0
    AND elem->>'rarity' IN ('common', 'rare', 'epic')
    AND (card_mythic IS NULL OR elem->>'login' <> card_mythic)
    AND (card_legendary IS NULL OR elem->>'login' <> card_legendary)
  ORDER BY COALESCE((elem->>'power')::INT, 0) DESC, elem->>'login'
  LIMIT 1;
  total_power := total_power + COALESCE(v_power, 0);

  SELECT elem->>'login', COALESCE((elem->>'power')::INT, 0)
  INTO card_rare, v_power
  FROM user_collections uc
  JOIN LATERAL jsonb_array_elements(v_repo_data) elem
    ON elem->>'login' = uc.contributor_login
  WHERE uc.user_id = p_user_id
    AND uc.owner_repo = v_owner_repo
    AND uc.count > 0
    AND elem->>'rarity' IN ('common', 'rare')
    AND (card_mythic IS NULL OR elem->>'login' <> card_mythic)
    AND (card_legendary IS NULL OR elem->>'login' <> card_legendary)
    AND (card_epic IS NULL OR elem->>'login' <> card_epic)
  ORDER BY COALESCE((elem->>'power')::INT, 0) DESC, elem->>'login'
  LIMIT 1;
  total_power := total_power + COALESCE(v_power, 0);

  SELECT elem->>'login', COALESCE((elem->>'power')::INT, 0)
  INTO card_common, v_power
  FROM user_collections uc
  JOIN LATERAL jsonb_array_elements(v_repo_data) elem
    ON elem->>'login' = uc.contributor_login
  WHERE uc.user_id = p_user_id
    AND uc.owner_repo = v_owner_repo
    AND uc.count > 0
    AND elem->>'rarity' = 'common'
    AND (card_mythic IS NULL OR elem->>'login' <> card_mythic)
    AND (card_legendary IS NULL OR elem->>'login' <> card_legendary)
    AND (card_epic IS NULL OR elem->>'login' <> card_epic)
    AND (card_rare IS NULL OR elem->>'login' <> card_rare)
  ORDER BY COALESCE((elem->>'power')::INT, 0) DESC, elem->>'login'
  LIMIT 1;
  total_power := total_power + COALESCE(v_power, 0);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION sprint_lineup_for_user(UUID, UUID) FROM PUBLIC;

-- Live dashboard/repo-view numbers for the calling user. No writes.
CREATE OR REPLACE FUNCTION sprint_live_status(p_sprint_id UUID)
RETURNS TABLE (
  total_power INT,
  participants INT,
  card_common TEXT,
  card_rare TEXT,
  card_epic TEXT,
  card_legendary TEXT,
  card_mythic TEXT
) AS $$
DECLARE
  v_owner_repo TEXT;
  v_user_id UUID := auth.uid();
  v_lineup RECORD;
BEGIN
  SELECT s.repo_owner || '/' || s.repo_name INTO v_owner_repo
  FROM sprints s WHERE s.id = p_sprint_id;

  IF v_owner_repo IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(DISTINCT uc.user_id)::INT INTO participants
  FROM user_collections uc
  WHERE uc.owner_repo = v_owner_repo
    AND uc.count > 0;

  IF v_user_id IS NULL THEN
    total_power := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_lineup FROM sprint_lineup_for_user(p_sprint_id, v_user_id);

  total_power := COALESCE(v_lineup.total_power, 0);
  card_common := v_lineup.card_common;
  card_rare := v_lineup.card_rare;
  card_epic := v_lineup.card_epic;
  card_legendary := v_lineup.card_legendary;
  card_mythic := v_lineup.card_mythic;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION sprint_live_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sprint_live_status(UUID) TO anon, authenticated, service_role;

-- Writes a finalized-scoring entry. Only called from finalize_sprint.
CREATE OR REPLACE FUNCTION refresh_sprint_entry(
  p_sprint_id UUID,
  p_user_id UUID
) RETURNS VOID AS $$
DECLARE
  v_lineup RECORD;
BEGIN
  -- Finalized entries are immutable.
  IF EXISTS (
    SELECT 1
    FROM sprint_entries
    WHERE sprint_id = p_sprint_id
      AND user_id = p_user_id
      AND rank IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  SELECT * INTO v_lineup FROM sprint_lineup_for_user(p_sprint_id, p_user_id);

  -- No owned card for the featured repo means no entry.
  IF v_lineup.card_mythic IS NULL THEN
    DELETE FROM sprint_entries
    WHERE sprint_id = p_sprint_id
      AND user_id = p_user_id
      AND rank IS NULL;
    RETURN;
  END IF;

  INSERT INTO sprint_entries (
    sprint_id,
    user_id,
    card_common,
    card_rare,
    card_epic,
    card_legendary,
    card_mythic,
    total_power,
    committed_at
  )
  VALUES (
    p_sprint_id,
    p_user_id,
    v_lineup.card_common,
    v_lineup.card_rare,
    v_lineup.card_epic,
    v_lineup.card_legendary,
    v_lineup.card_mythic,
    v_lineup.total_power,
    NOW()
  )
  ON CONFLICT (sprint_id, user_id) DO UPDATE SET
    card_common = EXCLUDED.card_common,
    card_rare = EXCLUDED.card_rare,
    card_epic = EXCLUDED.card_epic,
    card_legendary = EXCLUDED.card_legendary,
    card_mythic = EXCLUDED.card_mythic,
    total_power = EXCLUDED.total_power,
    committed_at = COALESCE(sprint_entries.committed_at, EXCLUDED.committed_at);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION refresh_sprint_entry(UUID, UUID) FROM PUBLIC;

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
  IF current_setting('role', true) NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'create_sprint: service role required';
  END IF;

  IF p_starts_at >= p_ends_at THEN
    RETURN NULL;
  END IF;

  IF p_type = 'daily' THEN
    v_cooldown_days := 30;
  ELSIF p_type = 'weekly' THEN
    v_cooldown_days := 90;
  ELSE
    RETURN NULL;
  END IF;

  -- Cooldowns apply across sprint types because the eligible pools overlap.
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

-- Finalization is where entries come from: everyone owning a card for the
-- featured repo is scored with their strongest lineup.
CREATE OR REPLACE FUNCTION finalize_sprint(p_sprint_id UUID) RETURNS VOID AS $$
DECLARE
  v_sprint RECORD;
  v_total INT;
  v_type TEXT;
  rec RECORD;
  v_rank INT;
  v_prev_power INT;
  v_current_rank INT;
  v_pct NUMERIC(5,2);
  v_packs INT;
  v_lock_key BIGINT;
  v_top10 INT;
  v_top25 INT;
  v_top50 INT;
BEGIN
  IF current_setting('role', true) NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'finalize_sprint: service role required';
  END IF;

  v_lock_key := abs(hashtext(p_sprint_id::TEXT));
  IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
    RETURN;
  END IF;

  SELECT s.id, s.type, s.ends_at, s.repo_owner, s.repo_name INTO v_sprint
  FROM sprints s WHERE s.id = p_sprint_id;

  IF NOT FOUND OR NOW() < v_sprint.ends_at THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM sprint_entries
    WHERE sprint_id = p_sprint_id
      AND rank IS NOT NULL
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  FOR rec IN
    SELECT DISTINCT uc.user_id
    FROM user_collections uc
    WHERE uc.owner_repo = v_sprint.repo_owner || '/' || v_sprint.repo_name
      AND uc.count > 0
  LOOP
    PERFORM refresh_sprint_entry(p_sprint_id, rec.user_id);
  END LOOP;

  v_type := v_sprint.type;

  SELECT COUNT(*) INTO v_total
  FROM sprint_entries
  WHERE sprint_id = p_sprint_id
    AND committed_at IS NOT NULL;

  IF v_total = 0 THEN
    RETURN;
  END IF;

  v_top10 := GREATEST(CEIL(v_total * 0.10)::INT, 1);
  v_top25 := GREATEST(CEIL(v_total * 0.25)::INT, v_top10 + 1);
  v_top50 := GREATEST(CEIL(v_total * 0.50)::INT, v_top25 + 1);

  v_current_rank := 0;
  v_prev_power := NULL;
  v_rank := 0;

  FOR rec IN
    SELECT se.id, se.total_power
    FROM sprint_entries se
    WHERE se.sprint_id = p_sprint_id
      AND se.committed_at IS NOT NULL
    ORDER BY se.total_power DESC
  LOOP
    v_current_rank := v_current_rank + 1;
    IF v_prev_power IS NULL OR rec.total_power < v_prev_power THEN
      v_rank := v_current_rank;
    END IF;
    v_prev_power := rec.total_power;
    v_pct := (v_rank::NUMERIC / v_total::NUMERIC) * 100;

    IF v_rank <= v_top10 THEN
      IF v_type = 'daily' THEN v_packs := 4; ELSE v_packs := 12; END IF;
    ELSIF v_rank <= v_top25 THEN
      IF v_type = 'daily' THEN v_packs := 3; ELSE v_packs := 9; END IF;
    ELSIF v_rank <= v_top50 THEN
      IF v_type = 'daily' THEN v_packs := 2; ELSE v_packs := 6; END IF;
    ELSE
      IF v_type = 'daily' THEN v_packs := 1; ELSE v_packs := 3; END IF;
    END IF;

    UPDATE sprint_entries
    SET rank = v_rank,
        percentile = v_pct,
        packs_won = v_packs
    WHERE id = rec.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- The commit step is gone.
DROP FUNCTION IF EXISTS commit_sprint_lineup(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  INT
);
