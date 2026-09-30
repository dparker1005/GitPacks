-- Dashboard only needs per-repo card counts, but /api/user-repos paged through
-- every user_collections row (5k+ rows / 6 sequential requests for heavy users).
-- SECURITY INVOKER: RLS on user_collections still limits this to the caller.
CREATE OR REPLACE FUNCTION user_repo_card_counts()
RETURNS TABLE(owner_repo TEXT, cards INT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT uc.owner_repo, COUNT(*)::INT
  FROM user_collections uc
  WHERE uc.user_id = auth.uid()
  GROUP BY uc.owner_repo
$$;

REVOKE EXECUTE ON FUNCTION user_repo_card_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION user_repo_card_counts() TO authenticated;
