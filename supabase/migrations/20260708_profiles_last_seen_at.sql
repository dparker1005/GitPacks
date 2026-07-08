-- Reliable "last active" signal. auth.users.last_sign_in_at only updates on
-- fresh sign-ins, so long-lived sessions look dormant forever; answering
-- "who still plays?" required reconstructing activity from four gameplay
-- tables. profiles.last_seen_at is touched by /api/pack-state (throttled to
-- once per hour), which every logged-in session loads.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Backfill from known gameplay activity (dailies, sprints, stars, scores),
-- falling back to last_sign_in_at for users with no recorded activity.
UPDATE profiles pr
SET last_seen_at = a.last_activity
FROM (
  SELECT user_id, max(ts) AS last_activity FROM (
    SELECT user_id, max(created_at) AS ts FROM daily_claims GROUP BY user_id
    UNION ALL SELECT user_id, max(created_at) FROM sprint_entries GROUP BY user_id
    UNION ALL SELECT user_id, max(updated_at) FROM user_stars GROUP BY user_id
    UNION ALL SELECT user_id, max(updated_at) FROM leaderboard_scores GROUP BY user_id
  ) x GROUP BY user_id
) a
WHERE pr.id = a.user_id;

UPDATE profiles pr
SET last_seen_at = u.last_sign_in_at
FROM auth.users u
WHERE pr.id = u.id AND pr.last_seen_at IS NULL;
