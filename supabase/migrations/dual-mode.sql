-- supabase/migrations/dual-mode.sql

-- 1. Add mode column to bets (default 'fantasy' backfills all existing bets)
ALTER TABLE bets ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'fantasy';
UPDATE bets SET mode = 'fantasy' WHERE mode IS NULL;

-- 2. Add mode column to notifications
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS mode TEXT;
UPDATE notifications SET mode = 'fantasy' WHERE mode IS NULL;

-- 3. Expand iby_wallets with blocked balance and referral bonus
ALTER TABLE iby_wallets
  ADD COLUMN IF NOT EXISTS balance_blocked DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referral_bonus_locked DECIMAL(10,2) NOT NULL DEFAULT 0;

-- 4. Withdrawal methods (user-managed payment destinations)
CREATE TABLE IF NOT EXISTS withdrawal_methods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('binance', 'bank', 'cbu_cvu')),
  label TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_withdrawal_methods_user ON withdrawal_methods(user_id);
ALTER TABLE withdrawal_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own withdrawal methods" ON withdrawal_methods
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Service role manages withdrawal methods" ON withdrawal_methods
  FOR ALL USING (auth.role() = 'service_role');

-- 5. Withdrawal requests
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  method_id UUID REFERENCES withdrawal_methods(id) ON DELETE SET NULL,
  method_snapshot JSONB,
  amount DECIMAL(10,2) NOT NULL,
  fee_amount DECIMAL(10,2) NOT NULL,
  net_amount DECIMAL(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'paid', 'rejected')),
  rejection_type TEXT CHECK (rejection_type IN ('refund', 'forfeit')),
  rejection_reason TEXT,
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user ON withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON withdrawal_requests(status);
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own withdrawal requests" ON withdrawal_requests
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role manages withdrawal requests" ON withdrawal_requests
  FOR ALL USING (auth.role() = 'service_role');

-- 6. RPCs for atomic wallet operations

-- Locks amount in iby_wallets for a pending withdrawal
CREATE OR REPLACE FUNCTION lock_withdrawal_funds(p_user_id UUID, p_amount DECIMAL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount must be positive';
  END IF;
  UPDATE iby_wallets
  SET balance = balance - p_amount,
      balance_blocked = balance_blocked + p_amount
  WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'iby_wallet not found for user %', p_user_id;
  END IF;
END;
$$;

-- Admin: completes a withdrawal (removes from balance_blocked, funds already left balance)
CREATE OR REPLACE FUNCTION complete_withdrawal(p_user_id UUID, p_amount DECIMAL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE iby_wallets
  SET balance_blocked = GREATEST(0, balance_blocked - p_amount)
  WHERE user_id = p_user_id;
END;
$$;

-- Admin: refunds a rejected withdrawal (moves back from blocked to available)
CREATE OR REPLACE FUNCTION refund_withdrawal(p_user_id UUID, p_amount DECIMAL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE iby_wallets
  SET balance = balance + p_amount,
      balance_blocked = GREATEST(0, balance_blocked - p_amount)
  WHERE user_id = p_user_id;
END;
$$;

-- Admin: forfeits a rejected withdrawal (removes from blocked, funds not returned)
CREATE OR REPLACE FUNCTION forfeit_withdrawal(p_user_id UUID, p_amount DECIMAL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE iby_wallets
  SET balance_blocked = GREATEST(0, balance_blocked - p_amount)
  WHERE user_id = p_user_id;
END;
$$;

-- Credits referral bonus to iby_wallets (real mode bonus)
CREATE OR REPLACE FUNCTION increment_referral_bonus_locked_ibc(p_user_id UUID, p_amount DECIMAL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE iby_wallets SET referral_bonus_locked = referral_bonus_locked + p_amount
  WHERE user_id = p_user_id;
END;
$$;

-- Unlocks IBC referral bonus into available balance
CREATE OR REPLACE FUNCTION unlock_referral_bonus_ibc(p_user_id UUID, p_amount DECIMAL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE iby_wallets
  SET referral_bonus_locked = GREATEST(0, referral_bonus_locked - p_amount),
      balance = balance + p_amount
  WHERE user_id = p_user_id;
END;
$$;
