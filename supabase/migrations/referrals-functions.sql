-- supabase/migrations/referrals-functions.sql

CREATE OR REPLACE FUNCTION increment_referral_bonus_locked(p_user_id UUID, p_amount DECIMAL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE wallets SET referral_bonus_locked = referral_bonus_locked + p_amount
  WHERE user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION unlock_referral_bonus(p_user_id UUID, p_amount DECIMAL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_locked DECIMAL;
BEGIN
  SELECT referral_bonus_locked INTO v_locked
  FROM wallets WHERE user_id = p_user_id FOR UPDATE;

  IF v_locked >= p_amount THEN
    UPDATE wallets
    SET referral_bonus_locked = referral_bonus_locked - p_amount,
        balance_fantasy = balance_fantasy + p_amount
    WHERE user_id = p_user_id;
  END IF;
END;
$$;
