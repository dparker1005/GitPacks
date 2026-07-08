-- The 20260430 migration enabled RLS on system_state assuming claims would go
-- through a service-role client, but the refresh coordinator uses the shared
-- anon client (same as repo_cache) — so every claim UPDATE matched 0 rows and
-- the site-wide background refresh never fired. Allow read/write like
-- repo_cache; the claim's atomicity comes from the WHERE clause, not the role.
CREATE POLICY "Allow public read/write on system_state"
  ON system_state FOR ALL
  USING (true)
  WITH CHECK (true);
