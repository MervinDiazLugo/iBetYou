-- Drop ALL policies from all tables
DROP POLICY IF EXISTS "Anyone can read profiles" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON profiles;

DROP POLICY IF EXISTS "Users can read own wallet" ON wallets;
DROP POLICY IF EXISTS "Users can update own wallet" ON wallets;
DROP POLICY IF EXISTS "Users can view own wallet" ON wallets;
DROP POLICY IF EXISTS "Service role can manage wallets" ON wallets;

DROP POLICY IF EXISTS "Users can read own transactions" ON transactions;
DROP POLICY IF EXISTS "Users can view own transactions" ON transactions;
DROP POLICY IF EXISTS "Service role can manage transactions" ON transactions;

DROP POLICY IF EXISTS "Anyone can read events" ON events;
DROP POLICY IF EXISTS "Events are viewable by everyone" ON events;
DROP POLICY IF EXISTS "Allow all events" ON events;

DROP POLICY IF EXISTS "Anyone can read open bets" ON bets;
DROP POLICY IF EXISTS "Users can read own bets" ON bets;
DROP POLICY IF EXISTS "Users can create bets" ON bets;
DROP POLICY IF EXISTS "Users can update own bets" ON bets;
DROP POLICY IF EXISTS "Open bets are viewable by everyone" ON bets;

DROP POLICY IF EXISTS "Users can read own rewards" ON daily_rewards;
DROP POLICY IF EXISTS "Users can view own rewards" ON daily_rewards;

-- Now create new policies
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
