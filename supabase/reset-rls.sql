-- =====================================================
-- CLEAN RESET OF ALL RLS POLICIES
-- =====================================================

-- Disable RLS on all tables
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE wallets DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE events DISABLE ROW LEVEL SECURITY;
ALTER TABLE bets DISABLE ROW LEVEL SECURITY;
ALTER TABLE disputes DISABLE ROW LEVEL SECURITY;
ALTER TABLE daily_rewards DISABLE ROW LEVEL SECURITY;

-- Re-enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_rewards ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can read profiles" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can read own wallet" ON wallets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own wallet" ON wallets FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can read own transactions" ON transactions FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Anyone can read events" ON events FOR SELECT USING (true);

CREATE POLICY "Anyone can read open bets" ON bets FOR SELECT USING (status = 'open');
CREATE POLICY "Users can read own bets" ON bets FOR SELECT USING (auth.uid() = creator_id OR auth.uid() = acceptor_id);
CREATE POLICY "Users can create bets" ON bets FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Users can update own bets" ON bets FOR UPDATE USING (auth.uid() = creator_id OR auth.uid() = acceptor_id);

CREATE POLICY "Users can read own rewards" ON daily_rewards FOR SELECT USING (auth.uid() = user_id);
