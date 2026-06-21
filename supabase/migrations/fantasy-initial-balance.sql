-- Phase 1: fixed fantasy starting balance of 10,000 tokens, no daily reload
--
-- Setting fantasy_total_accumulated = 10000 on new wallets means the
-- login-bonus cap logic (maxAccumulated = 1000) will see remainingGlobal ≤ 0
-- and block every subsequent daily bonus automatically, without code changes.
--
-- Existing users are left as-is.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, nickname, avatar_url, role, kyc_status, kyc_level, referral_code)
  VALUES (
    NEW.id,
    'user_' || SUBSTR(NEW.id::text, 1, 8),
    NULL,
    'app_user',
    'none',
    'basic',
    UPPER(SUBSTR(REPLACE(NEW.id::text, '-', ''), 1, 8))
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO wallets (user_id, balance_fantasy, balance_real, fantasy_total_accumulated)
  VALUES (NEW.id, 10000, 0, 10000)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Low-balance threshold (fichas). Configurable from backoffice via app_settings.
INSERT INTO app_settings (key, value, updated_at)
VALUES ('fantasy_low_balance_threshold', '500'::jsonb, NOW())
ON CONFLICT (key) DO NOTHING;
