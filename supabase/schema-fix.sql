-- =====================================================
-- DROP EXISTING TABLES (Run only if needed)
-- =====================================================
DROP TABLE IF EXISTS daily_rewards CASCADE;
DROP TABLE IF EXISTS disputes CASCADE;
DROP TABLE IF EXISTS bets CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS wallets CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- =====================================================
-- Enable UUID extension
-- =====================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- PROFILES
-- =====================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname VARCHAR(50) UNIQUE NOT NULL,
  avatar_url TEXT,
  kyc_status VARCHAR(20) DEFAULT 'none' CHECK (kyc_status IN ('none', 'pending', 'approved', 'rejected')),
  kyc_level VARCHAR(20) DEFAULT 'basic' CHECK (kyc_level IN ('basic', 'full')),
  total_spent_usd DECIMAL(10,2) DEFAULT 0,
  is_banned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- WALLETS
-- =====================================================
CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  balance_fantasy DECIMAL(10,2) DEFAULT 0,
  balance_real DECIMAL(10,2) DEFAULT 0,
  fantasy_total_accumulated DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- TRANSACTIONS
-- =====================================================
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_type VARCHAR(20) NOT NULL CHECK (token_type IN ('fantasy', 'real')),
  amount DECIMAL(10,2) NOT NULL,
  operation VARCHAR(50) NOT NULL,
  reference_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- EVENTS
-- =====================================================
CREATE TABLE events (
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
CREATE TABLE bets (
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
-- DISPUTES
-- =====================================================
CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bet_id UUID NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
  claimant_id UUID NOT NULL REFERENCES profiles(id),
  respondent_id UUID NOT NULL REFERENCES profiles(id),
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution VARCHAR(30) CHECK (resolution IN ('creator_wins', 'acceptor_wins', 'void')),
  staff_id UUID REFERENCES profiles(id),
  penalty_applied DECIMAL(10,2),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- =====================================================
-- DAILY REWARDS
-- =====================================================
CREATE TABLE daily_rewards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reward_amount DECIMAL(10,2) NOT NULL,
  rewarded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_daily_rewards_user ON daily_rewards(user_id);
CREATE INDEX idx_daily_rewards_date ON daily_rewards(rewarded_at);

-- =====================================================
-- RLS
-- =====================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by everyone" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can view own wallet" ON wallets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role can manage wallets" ON wallets FOR ALL USING (true);

CREATE POLICY "Users can view own transactions" ON transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role can manage transactions" ON transactions FOR ALL USING (true);

CREATE POLICY "Events are viewable by everyone" ON events FOR SELECT USING (true);

CREATE POLICY "Open bets are viewable by everyone" ON bets FOR SELECT USING (true);
CREATE POLICY "Users can create bets" ON bets FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Users can update own bets" ON bets FOR UPDATE USING (auth.uid() = creator_id OR auth.uid() = acceptor_id);

CREATE POLICY "Disputes viewable by parties" ON disputes FOR SELECT USING (auth.uid() = claimant_id OR auth.uid() = respondent_id);

CREATE POLICY "Users can view own rewards" ON daily_rewards FOR SELECT USING (auth.uid() = user_id);
