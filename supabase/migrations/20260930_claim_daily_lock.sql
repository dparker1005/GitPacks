-- Serialize daily claims per user. Without the row lock, concurrent claims for
-- different event types all read the same COUNT and can exceed the 3/day cap.
CREATE OR REPLACE FUNCTION public.claim_daily(p_user_id uuid, p_event_type text)
 RETURNS TABLE(success boolean, new_bonus_packs integer, claims_today integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  today DATE := (NOW() AT TIME ZONE 'UTC')::DATE;
  cur_claims INT;
  cur_bonus INT;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM 1 FROM profiles WHERE id = p_user_id FOR UPDATE;

  SELECT COUNT(*) INTO cur_claims
  FROM daily_claims WHERE user_id = p_user_id AND claim_date = today;

  IF cur_claims >= 3 THEN
    RETURN QUERY SELECT false, 0, cur_claims;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO daily_claims (user_id, event_type, claim_date)
    VALUES (p_user_id, p_event_type, today);
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false, 0, cur_claims;
    RETURN;
  END;

  UPDATE profiles SET bonus_packs = bonus_packs + 1 WHERE id = p_user_id
  RETURNING bonus_packs INTO cur_bonus;

  RETURN QUERY SELECT true, cur_bonus, (cur_claims + 1);
END;
$function$;
