-- Atomic referral count increment to avoid race condition when multiple
-- users register with the same referral code concurrently.
CREATE OR REPLACE FUNCTION increment_referral_count(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE profiles
  SET referral_count = referral_count + 1
  WHERE id = p_user_id;
END;
$$;
