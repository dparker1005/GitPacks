-- Score refresh was the single biggest consumer of database time: every pack
-- open, achievement claim and recycle recomputed EVERY repo the user collects,
-- and compute_user_repo_score did one lookup per card. For a 253-repo user
-- that was ~4s of DB time per pack and caused queueing for everyone else.
--
-- 1. compute_user_repo_score is now one set-based query (verified identical
--    output for all 391 user/repo pairs; ~45x faster).
-- 2. refresh_user_repo_scores(user, repos[]) recomputes only the given repos,
--    then re-sums the global total from the per-repo rows.
-- 3. refresh_user_scores(user) keeps its behavior by delegating with all of
--    the user's repos.

CREATE OR REPLACE FUNCTION compute_user_repo_score(p_user_id UUID, p_owner_repo TEXT)
RETURNS TABLE(base_points INT, unique_cards INT, total_cards_in_repo INT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(CASE elem->>'rarity' WHEN 'common' THEN 1 WHEN 'rare' THEN 2 WHEN 'epic' THEN 5
      WHEN 'legendary' THEN 15 WHEN 'mythic' THEN 50 ELSE 0 END) FILTER (WHERE uc.contributor_login IS NOT NULL), 0)::INT,
    COUNT(uc.contributor_login)::INT,
    COUNT(elem)::INT
  FROM repo_cache rc
  CROSS JOIN LATERAL jsonb_array_elements(rc.data) elem
  LEFT JOIN user_collections uc
    ON uc.user_id = p_user_id AND uc.owner_repo = p_owner_repo AND uc.contributor_login = elem->>'login'
  WHERE rc.owner_repo = p_owner_repo
$$;

CREATE OR REPLACE FUNCTION refresh_user_repo_scores(p_user_id UUID, p_owner_repos TEXT[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  repo RECORD;
  score RECORD;
  comp RECORD;
  bonus INT;
  global_total INT;
BEGIN
  FOR repo IN SELECT DISTINCT unnest(p_owner_repos) AS owner_repo LOOP
    SELECT * INTO score FROM compute_user_repo_score(p_user_id, repo.owner_repo);

    bonus := 0;
    SELECT * INTO comp FROM collection_completions
      WHERE user_id = p_user_id AND owner_repo = repo.owner_repo;

    IF score.unique_cards = score.total_cards_in_repo AND score.total_cards_in_repo > 0 THEN
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
    ELSIF comp.user_id IS NOT NULL THEN
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
  END LOOP;

  -- Same set the full refresh summed over: repos the user holds cards for.
  SELECT COALESCE(SUM(ls.total_points), 0)::INT INTO global_total
  FROM leaderboard_scores ls
  WHERE ls.user_id = p_user_id
    AND ls.owner_repo IN (SELECT DISTINCT uc.owner_repo FROM user_collections uc WHERE uc.user_id = p_user_id);

  INSERT INTO leaderboard_scores (user_id, owner_repo, base_points, completion_bonus, total_points, unique_cards, total_cards_in_repo, updated_at)
    VALUES (p_user_id, '__global__', global_total, 0, global_total, 0, 0, NOW())
    ON CONFLICT (user_id, owner_repo) DO UPDATE SET
      total_points = global_total,
      updated_at = NOW();

  UPDATE profiles SET total_points = global_total WHERE id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_user_scores(p_user_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT refresh_user_repo_scores(
    p_user_id,
    ARRAY(SELECT DISTINCT owner_repo FROM user_collections WHERE user_id = p_user_id)
  );
$$;

REVOKE EXECUTE ON FUNCTION refresh_user_repo_scores(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION compute_user_repo_score(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION refresh_user_scores(UUID) FROM PUBLIC, anon, authenticated;
