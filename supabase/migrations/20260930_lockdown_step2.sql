-- Security lockdown, step 2 of 2. Apply only after the app deploy that routes
-- all writes through the service-role client (app/lib/supabase-admin.ts).
--
-- The anon key is public, so anon/authenticated get read access only:
--   * no direct INSERT/UPDATE/DELETE on any public table
--   * every non-SELECT RLS policy is dropped (they were mostly `true`)
--   * game-economy RPCs are service-role only (they trust their cost/yield
--     arguments, which the server computes from repo_cache)
-- Read-only RPCs (get_public_profile, get_user_contributor_*, sprint_live_status,
-- get_contributor_rarities) stay executable.

DO $$
DECLARE
  t RECORD;
  pol RECORD;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM PUBLIC, anon, authenticated', t.tablename);
  END LOOP;

  FOR pol IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND cmd <> 'SELECT' LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- repo_cache's only policy was the read/write ALL policy dropped above.
CREATE POLICY "repo_cache is publicly readable" ON repo_cache FOR SELECT USING (true);

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
FROM authenticated;
