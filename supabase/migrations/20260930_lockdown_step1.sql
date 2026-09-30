-- Security lockdown, step 1 of 2. Safe to apply before the matching app deploy.
--
-- 1. GitHub OAuth tokens move out of the publicly readable profiles table into
--    user_github_tokens, which only the service role can touch.
-- 2. Game-economy RPCs accept calls from the service role (server routes now
--    use it for all writes) in addition to the matching logged-in user.
-- 3. Those RPCs are no longer executable by anon. Step 2 removes authenticated
--    too, once the app calls them exclusively with the service role.

CREATE TABLE IF NOT EXISTS user_github_tokens (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE user_github_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_github_tokens FROM PUBLIC, anon, authenticated;

INSERT INTO user_github_tokens (user_id, token)
SELECT id, github_token FROM profiles WHERE github_token IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE profiles DROP COLUMN IF EXISTS github_token;

DO $$
DECLARE
  f RECORD;
  def TEXT;
BEGIN
  FOR f IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('add_cards', 'cherry_pick_all', 'cherry_pick_card', 'claim_daily',
        'claim_share_reward', 'claim_sprint_reward', 'decrement_pack', 'process_referral',
        'revert_cards', 'trade_stars_for_pack')
  LOOP
    def := regexp_replace(
      pg_get_functiondef(f.oid),
      'IF auth\.uid\(\) IS DISTINCT FROM (p_user_id|p_new_user_id) THEN',
      'IF auth.uid() IS DISTINCT FROM \1 AND auth.role() IS DISTINCT FROM ''service_role'' THEN',
      'g'
    );
    EXECUTE def;
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION
  add_cards(UUID, TEXT, JSONB),
  cherry_pick_all(UUID, TEXT, JSONB),
  cherry_pick_card(UUID, TEXT, TEXT, INT),
  claim_daily(UUID, TEXT),
  claim_share_reward(UUID),
  claim_sprint_reward(UUID, UUID),
  decrement_pack(UUID, INT),
  process_referral(UUID, TEXT),
  revert_cards(UUID, TEXT, JSONB),
  trade_stars_for_pack(UUID, TEXT, INT),
  refresh_user_scores(UUID),
  compute_user_repo_score(UUID, TEXT),
  refresh_sprint_entry(UUID, UUID),
  sprint_lineup_for_user(UUID, UUID),
  create_sprint(TEXT, TIMESTAMPTZ, TIMESTAMPTZ),
  finalize_sprint(UUID)
FROM PUBLIC, anon;
