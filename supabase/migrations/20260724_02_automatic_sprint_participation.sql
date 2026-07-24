-- Sprint participation is automatic. Owning at least one card for the featured
-- repo creates an entry, and the entry always uses the user's best valid lineup.

CREATE OR REPLACE FUNCTION refresh_sprint_entry(
  p_sprint_id UUID,
  p_user_id UUID
) RETURNS VOID AS $$
DECLARE
  v_owner_repo TEXT;
  v_repo_data JSONB;
  v_card_common TEXT;
  v_card_rare TEXT;
  v_card_epic TEXT;
  v_card_legendary TEXT;
  v_card_mythic TEXT;
  v_card_power INT;
  v_total_power INT := 0;
BEGIN
  SELECT s.repo_owner || '/' || s.repo_name, rc.data
  INTO v_owner_repo, v_repo_data
  FROM sprints s
  JOIN repo_cache rc
    ON rc.owner_repo = s.repo_owner || '/' || s.repo_name
  WHERE s.id = p_sprint_id;

  IF NOT FOUND OR v_repo_data IS NULL THEN
    RETURN;
  END IF;

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

  -- Fill the lineup from the top down. Each lower slot excludes cards already
  -- used by a higher slot and enforces its maximum rarity.
  SELECT elem->>'login', COALESCE((elem->>'power')::INT, 0)
  INTO v_card_mythic, v_card_power
  FROM user_collections uc
  JOIN LATERAL jsonb_array_elements(v_repo_data) elem
    ON elem->>'login' = uc.contributor_login
  WHERE uc.user_id = p_user_id
    AND uc.owner_repo = v_owner_repo
    AND uc.count > 0
  ORDER BY COALESCE((elem->>'power')::INT, 0) DESC, elem->>'login'
  LIMIT 1;
  v_total_power := v_total_power + COALESCE(v_card_power, 0);

  SELECT elem->>'login', COALESCE((elem->>'power')::INT, 0)
  INTO v_card_legendary, v_card_power
  FROM user_collections uc
  JOIN LATERAL jsonb_array_elements(v_repo_data) elem
    ON elem->>'login' = uc.contributor_login
  WHERE uc.user_id = p_user_id
    AND uc.owner_repo = v_owner_repo
    AND uc.count > 0
    AND elem->>'rarity' IN ('common', 'rare', 'epic', 'legendary')
    AND (v_card_mythic IS NULL OR elem->>'login' <> v_card_mythic)
  ORDER BY COALESCE((elem->>'power')::INT, 0) DESC, elem->>'login'
  LIMIT 1;
  v_total_power := v_total_power + COALESCE(v_card_power, 0);

  SELECT elem->>'login', COALESCE((elem->>'power')::INT, 0)
  INTO v_card_epic, v_card_power
  FROM user_collections uc
  JOIN LATERAL jsonb_array_elements(v_repo_data) elem
    ON elem->>'login' = uc.contributor_login
  WHERE uc.user_id = p_user_id
    AND uc.owner_repo = v_owner_repo
    AND uc.count > 0
    AND elem->>'rarity' IN ('common', 'rare', 'epic')
    AND (v_card_mythic IS NULL OR elem->>'login' <> v_card_mythic)
    AND (v_card_legendary IS NULL OR elem->>'login' <> v_card_legendary)
  ORDER BY COALESCE((elem->>'power')::INT, 0) DESC, elem->>'login'
  LIMIT 1;
  v_total_power := v_total_power + COALESCE(v_card_power, 0);

  SELECT elem->>'login', COALESCE((elem->>'power')::INT, 0)
  INTO v_card_rare, v_card_power
  FROM user_collections uc
  JOIN LATERAL jsonb_array_elements(v_repo_data) elem
    ON elem->>'login' = uc.contributor_login
  WHERE uc.user_id = p_user_id
    AND uc.owner_repo = v_owner_repo
    AND uc.count > 0
    AND elem->>'rarity' IN ('common', 'rare')
    AND (v_card_mythic IS NULL OR elem->>'login' <> v_card_mythic)
    AND (v_card_legendary IS NULL OR elem->>'login' <> v_card_legendary)
    AND (v_card_epic IS NULL OR elem->>'login' <> v_card_epic)
  ORDER BY COALESCE((elem->>'power')::INT, 0) DESC, elem->>'login'
  LIMIT 1;
  v_total_power := v_total_power + COALESCE(v_card_power, 0);

  SELECT elem->>'login', COALESCE((elem->>'power')::INT, 0)
  INTO v_card_common, v_card_power
  FROM user_collections uc
  JOIN LATERAL jsonb_array_elements(v_repo_data) elem
    ON elem->>'login' = uc.contributor_login
  WHERE uc.user_id = p_user_id
    AND uc.owner_repo = v_owner_repo
    AND uc.count > 0
    AND elem->>'rarity' = 'common'
    AND (v_card_mythic IS NULL OR elem->>'login' <> v_card_mythic)
    AND (v_card_legendary IS NULL OR elem->>'login' <> v_card_legendary)
    AND (v_card_epic IS NULL OR elem->>'login' <> v_card_epic)
    AND (v_card_rare IS NULL OR elem->>'login' <> v_card_rare)
  ORDER BY COALESCE((elem->>'power')::INT, 0) DESC, elem->>'login'
  LIMIT 1;
  v_total_power := v_total_power + COALESCE(v_card_power, 0);

  -- No valid owned card means the user no longer participates.
  IF v_card_mythic IS NULL THEN
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
    v_card_common,
    v_card_rare,
    v_card_epic,
    v_card_legendary,
    v_card_mythic,
    v_total_power,
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

CREATE OR REPLACE FUNCTION sync_active_sprint_entries()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
  v_owner_repo TEXT;
  v_sprint_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_user_id := OLD.user_id;
    v_owner_repo := OLD.owner_repo;
  ELSE
    v_user_id := NEW.user_id;
    v_owner_repo := NEW.owner_repo;
  END IF;

  FOR v_sprint_id IN
    SELECT s.id
    FROM sprints s
    WHERE s.repo_owner || '/' || s.repo_name = v_owner_repo
      AND s.starts_at <= NOW()
      AND s.ends_at > NOW()
  LOOP
    PERFORM refresh_sprint_entry(v_sprint_id, v_user_id);
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION sync_active_sprint_entries() FROM PUBLIC;

DROP TRIGGER IF EXISTS sync_active_sprint_entries_trigger ON user_collections;
CREATE TRIGGER sync_active_sprint_entries_trigger
AFTER INSERT OR UPDATE OR DELETE ON user_collections
FOR EACH ROW
EXECUTE FUNCTION sync_active_sprint_entries();

-- New sprints immediately include everyone who already owns a card for the repo.
CREATE OR REPLACE FUNCTION create_sprint(
  p_type TEXT,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ
) RETURNS UUID AS $$
DECLARE
  v_cooldown_days INT;
  v_repo RECORD;
  v_user RECORD;
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

  FOR v_user IN
    SELECT DISTINCT uc.user_id
    FROM user_collections uc
    WHERE uc.owner_repo = v_repo.owner_repo
      AND uc.count > 0
  LOOP
    PERFORM refresh_sprint_entry(v_sprint_id, v_user.user_id);
  END LOOP;

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

-- Finalization rebuilds every lineup once more so rankings cannot miss a
-- collection update even if an earlier trigger invocation failed.
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
    SELECT DISTINCT candidate.user_id
    FROM (
      SELECT uc.user_id
      FROM user_collections uc
      WHERE uc.owner_repo = v_sprint.repo_owner || '/' || v_sprint.repo_name
        AND uc.count > 0
      UNION
      SELECT se.user_id
      FROM sprint_entries se
      WHERE se.sprint_id = p_sprint_id
    ) candidate
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

-- Backfill automatic entries for any sprint active when this migration runs.
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT DISTINCT s.id AS sprint_id, uc.user_id
    FROM sprints s
    JOIN user_collections uc
      ON uc.owner_repo = s.repo_owner || '/' || s.repo_name
    WHERE s.starts_at <= NOW()
      AND s.ends_at > NOW()
      AND uc.count > 0
  LOOP
    PERFORM refresh_sprint_entry(rec.sprint_id, rec.user_id);
  END LOOP;
END;
$$;

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
