-- The user's own card (full stats) in every cached repo they contribute to.
-- The dashboard uses the stats to count unclaimed achievement milestones per
-- repo without pulling each repo's full contributor list.
CREATE OR REPLACE FUNCTION get_user_contributor_cards(github_login TEXT)
RETURNS TABLE(owner_repo TEXT, card_count INT, card JSONB)
LANGUAGE sql
STABLE
AS $$
  SELECT rc.owner_repo::TEXT, rc.card_count::INT, elem
  FROM repo_cache rc, jsonb_array_elements(rc.data) elem
  WHERE rc.contributor_logins @> ARRAY[lower(github_login)]
  AND lower(elem->>'login') = lower(github_login)
$$;
