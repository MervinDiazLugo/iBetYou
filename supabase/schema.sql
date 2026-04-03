-- =====================================================
-- P2P BETS - DATABASE SCHEMA
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- PROFILES (extends auth.users)
-- =====================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname VARCHAR(50) UNIQUE NOT NULL,
  avatar_url TEXT,
  role VARCHAR(30) DEFAULT 'app_user' CHECK (role IN ('app_user', 'backoffice_admin')),
  kyc_status VARCHAR(20) DEFAULT 'none' CHECK (kyc_status IN ('none', 'pending', 'approved', 'rejected')),
  kyc_level VARCHAR(20) DEFAULT 'basic' CHECK (kyc_level IN ('basic', 'full')),
  total_spent_usd DECIMAL(10,2) DEFAULT 0,
  is_banned BOOLEAN DEFAULT false,
  false_claim_count INTEGER DEFAULT 0,
  betting_blocked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- WALLETS
-- =====================================================
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  balance_fantasy DECIMAL(10,2) DEFAULT 0,
  balance_real DECIMAL(10,2) DEFAULT 0,
  fantasy_total_accumulated DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- TRANSACTIONS (Ledger)
-- =====================================================
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_type VARCHAR(20) NOT NULL CHECK (token_type IN ('fantasy', 'real')),
  amount DECIMAL(10,2) NOT NULL,
  operation VARCHAR(50) NOT NULL,
  reference_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- EVENTS (from external APIs)
-- =====================================================
CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  external_id VARCHAR(100),
  sport VARCHAR(50) NOT NULL CHECK (sport IN ('football', 'basketball', 'baseball')),
  home_team VARCHAR(100) NOT NULL,
  away_team VARCHAR(100) NOT NULL,
  home_logo TEXT,
  away_logo TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'finished', 'cancelled')),
  home_score INTEGER,
  away_score INTEGER,
  league VARCHAR(100),
  country VARCHAR(100),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_sport ON events(sport);
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_start_time ON events(start_time);

-- =====================================================
-- BETS
-- =====================================================
CREATE TABLE IF NOT EXISTS bets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  acceptor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  type VARCHAR(20) DEFAULT 'symmetric' CHECK (type IN ('symmetric', 'asymmetric', 'market')),
  bet_type VARCHAR(50) DEFAULT 'direct',
  selection JSONB NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  multiplier DECIMAL(5,2) DEFAULT 1,
  fee_amount DECIMAL(10,2) DEFAULT 0,
  creator_selection VARCHAR(100) NOT NULL,
  acceptor_selection VARCHAR(100),
  status VARCHAR(30) DEFAULT 'open' CHECK (status IN ('open', 'taken', 'pending_resolution', 'resolved', 'cancelled', 'disputed')),
  winner_id UUID REFERENCES profiles(id),
  creator_claimed BOOLEAN DEFAULT false,
  acceptor_claimed BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bets_status ON bets(status);
CREATE INDEX idx_bets_event_id ON bets(event_id);
CREATE INDEX idx_bets_creator_id ON bets(creator_id);
CREATE INDEX idx_bets_acceptor_id ON bets(acceptor_id);

-- =====================================================
-- DAILY REWARDS (Login Bonus)
-- =====================================================
CREATE TABLE IF NOT EXISTS daily_rewards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reward_amount DECIMAL(10,2) NOT NULL,
  rewarded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_daily_rewards_user ON daily_rewards(user_id);
CREATE INDEX idx_daily_rewards_date ON daily_rewards(rewarded_at);

-- =====================================================
-- ARBITRATION DECISIONS (Admin/Auto Resolution History)
-- =====================================================
CREATE TABLE IF NOT EXISTS arbitration_decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bet_id UUID NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  previous_status VARCHAR(30),
  new_status VARCHAR(30),
  decided_winner_id UUID,
  reason TEXT,
  details JSONB,
  decided_by VARCHAR(100),
  source VARCHAR(20) DEFAULT 'manual' CHECK (source IN ('manual', 'auto', 'system')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_arbitration_decisions_bet_id ON arbitration_decisions(bet_id);
CREATE INDEX idx_arbitration_decisions_created_at ON arbitration_decisions(created_at DESC);

-- =====================================================
-- TRIGGERS & FUNCTIONS
-- =====================================================

-- Auto-create wallet on user registration
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Desactivar RLS temporalmente para este trigger
  SET session_replication_role = replica;
  
  INSERT INTO profiles (id, nickname, avatar_url, role, kyc_status, kyc_level)
  VALUES (
    NEW.id,
    'user_' || SUBSTR(NEW.id::text, 1, 8),
    NULL,
    'app_user',
    'none',
    'basic'
  );
  
  INSERT INTO wallets (user_id, balance_fantasy, balance_real, fantasy_total_accumulated)
  VALUES (NEW.id, 50, 0, 50);
  
  -- Reactivar RLS
  SET session_replication_role = default;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE arbitration_decisions ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read all, insert own, update own
CREATE POLICY "Profiles are viewable by everyone" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Service role can manage profiles" ON profiles FOR ALL USING (auth.role() = 'service_role');

-- Wallets: users can read own, service role can manage
CREATE POLICY "Users can view own wallet" ON wallets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own wallet" ON wallets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role can manage wallets" ON wallets FOR ALL USING (auth.role() = 'service_role');

-- Transactions: users can read own, insert own, service role can manage
CREATE POLICY "Users can view own transactions" ON transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own transactions" ON transactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role can insert transactions" ON transactions FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role can manage transactions" ON transactions FOR ALL USING (auth.role() = 'service_role');

-- Events: everyone can read
CREATE POLICY "Events are viewable by everyone" ON events FOR SELECT USING (true);
CREATE POLICY "Service role can manage events" ON events FOR ALL USING (auth.role() = 'service_role');

-- Bets: everyone can read open bets, users can manage their own
CREATE POLICY "Open bets are viewable by everyone" ON bets FOR SELECT USING (status = 'open' OR auth.uid() = creator_id OR auth.uid() = acceptor_id);
CREATE POLICY "Users can create bets" ON bets FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Users can update own bets" ON bets FOR UPDATE USING (auth.uid() = creator_id OR auth.uid() = acceptor_id);
CREATE POLICY "Service role can manage bets" ON bets FOR ALL USING (auth.role() = 'service_role');

-- Daily rewards: users can view own, service role can manage
CREATE POLICY "Users can view own rewards" ON daily_rewards FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role can manage daily_rewards" ON daily_rewards FOR ALL USING (auth.role() = 'service_role');

-- Arbitration decisions: only service role can manage (backoffice APIs)
CREATE POLICY "Service role can manage arbitration_decisions" ON arbitration_decisions FOR ALL USING (auth.role() = 'service_role');

-- =====================================================
-- ADDITIONAL INDEXES FOR PERFORMANCE
-- =====================================================
CREATE INDEX idx_daily_rewards_user_date ON daily_rewards(user_id, rewarded_at);
CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_wallets_user ON wallets(user_id);
