-- iBY Coin System Migration
-- Run this in the Supabase SQL editor

-- 1. iBY Wallets (separate from fantasy wallets)
CREATE TABLE IF NOT EXISTS iby_wallets (
  user_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  balance numeric NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Deposit accounts (managed by backoffice)
CREATE TABLE IF NOT EXISTS deposit_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('binance', 'bank', 'cbu_cvu')),
  label text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. User deposit requests
CREATE TABLE IF NOT EXISTS deposit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  deposit_account_id uuid NOT NULL REFERENCES deposit_accounts(id),
  transaction_id text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  iby_coins numeric,
  transaction_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_by uuid REFERENCES profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deposit_requests_transaction_id_unique UNIQUE (transaction_id)
);

-- 4. iBY settings (price config and other global settings)
CREATE TABLE IF NOT EXISTS iby_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_by uuid REFERENCES profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. iBY transactions (audit log)
CREATE TABLE IF NOT EXISTS iby_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  operation text NOT NULL,
  reference_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed default price
INSERT INTO iby_settings (key, value) VALUES ('iby_coin_price', '1')
ON CONFLICT (key) DO NOTHING;

-- Create iby_wallets for all existing users
INSERT INTO iby_wallets (user_id)
SELECT id FROM profiles
ON CONFLICT (user_id) DO NOTHING;

-- RLS: iby_wallets — users see only their own
ALTER TABLE iby_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own iby wallet" ON iby_wallets
  FOR SELECT USING (auth.uid() = user_id);

-- RLS: deposit_accounts — anyone authenticated can read active ones
ALTER TABLE deposit_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active deposit accounts" ON deposit_accounts
  FOR SELECT USING (is_active = true);

-- RLS: deposit_requests — users see only their own
ALTER TABLE deposit_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own deposit requests" ON deposit_requests
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own deposit requests" ON deposit_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS: iby_transactions — users see only their own
ALTER TABLE iby_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own iby transactions" ON iby_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- RLS: iby_settings — anyone can read
ALTER TABLE iby_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read iby settings" ON iby_settings
  FOR SELECT USING (true);
