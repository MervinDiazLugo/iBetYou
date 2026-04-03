-- =====================================================
-- iBetYou / P2P Bets - ONE-SHOT BOOTSTRAP (idempotente)
-- =====================================================
-- Objetivo:
--   Ejecutar setup de esquema + trigger + RLS en un solo bloque,
--   evitando tener que correr múltiples scripts sueltos.
--
-- Uso:
--   1) Abrir SQL Editor en Supabase
--   2) Pegar todo este archivo
--   3) Ejecutar una sola vez (puede re-ejecutarse sin romper)
--
-- Nota:
--   - Este script NO elimina datos existentes.
--   - Para promover admin, usar el UPDATE opcional al final.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- TABLAS
-- =====================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname VARCHAR(50) UNIQUE NOT NULL,
  avatar_url TEXT,
  kyc_status VARCHAR(20) DEFAULT 'none' CHECK (kyc_status IN ('none', 'pending', 'approved', 'rejected')),
  kyc_level VARCHAR(20) DEFAULT 'basic' CHECK (kyc_level IN ('basic', 'full')),
  total_spent_usd DECIMAL(10,2) DEFAULT 0,
  role VARCHAR(30) DEFAULT 'app_user' CHECK (role IN ('app_user', 'backoffice_admin')),
  is_banned BOOLEAN DEFAULT false,
  betting_blocked_until TIMESTAMPTZ,
  false_claim_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance_fantasy DECIMAL(10,2) DEFAULT 0,
  balance_real DECIMAL(10,2) DEFAULT 0,
  fantasy_total_accumulated DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_type VARCHAR(20) NOT NULL CHECK (token_type IN ('fantasy', 'real')),
  amount DECIMAL(10,2) NOT NULL,
  operation VARCHAR(50) NOT NULL,
  reference_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.events (
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

CREATE TABLE IF NOT EXISTS public.bets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id INTEGER NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  acceptor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  type VARCHAR(20) DEFAULT 'symmetric' CHECK (type IN ('symmetric', 'asymmetric', 'market')),
  bet_type VARCHAR(50) DEFAULT 'direct',
  selection JSONB NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  multiplier DECIMAL(5,2) DEFAULT 1,
  fee_amount DECIMAL(10,2) DEFAULT 0,
  creator_selection VARCHAR(100) NOT NULL,
  acceptor_selection VARCHAR(100),
  status VARCHAR(30) DEFAULT 'open' CHECK (status IN ('open', 'taken', 'pending_resolution', 'resolved', 'cancelled', 'disputed')),
  winner_id UUID REFERENCES public.profiles(id),
  creator_claimed BOOLEAN DEFAULT false,
  acceptor_claimed BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.daily_rewards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reward_amount DECIMAL(10,2) NOT NULL,
  rewarded_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- ALTERS IDPOTENTES (por si la tabla existía sin columnas nuevas)
-- =====================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role VARCHAR(30) DEFAULT 'app_user';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS betting_blocked_until TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS false_claim_count INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS total_spent_usd DECIMAL(10,2) DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS kyc_level VARCHAR(20) DEFAULT 'basic';

-- =====================================================
-- ÍNDICES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_events_sport ON public.events(sport);
CREATE INDEX IF NOT EXISTS idx_events_status ON public.events(status);
CREATE INDEX IF NOT EXISTS idx_events_start_time ON public.events(start_time);

CREATE INDEX IF NOT EXISTS idx_bets_status ON public.bets(status);
CREATE INDEX IF NOT EXISTS idx_bets_event_id ON public.bets(event_id);
CREATE INDEX IF NOT EXISTS idx_bets_creator_id ON public.bets(creator_id);
CREATE INDEX IF NOT EXISTS idx_bets_acceptor_id ON public.bets(acceptor_id);

CREATE INDEX IF NOT EXISTS idx_daily_rewards_user ON public.daily_rewards(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_rewards_date ON public.daily_rewards(rewarded_at);
CREATE INDEX IF NOT EXISTS idx_daily_rewards_user_date ON public.daily_rewards(user_id, rewarded_at);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_user ON public.wallets(user_id);

-- =====================================================
-- TRIGGER DE ALTA DE USUARIO
-- =====================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, nickname, avatar_url, kyc_status, kyc_level, role, is_banned, false_claim_count)
  VALUES (
    NEW.id,
    'user_' || SUBSTR(NEW.id::text, 1, 8),
    NULL,
    'none',
    'basic',
    'app_user',
    false,
    0
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.wallets (user_id, balance_fantasy, balance_real, fantasy_total_accumulated)
  VALUES (NEW.id, 50, 0, 50)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- RLS
-- =====================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_rewards ENABLE ROW LEVEL SECURITY;

-- Limpiar políticas previas (idempotente)
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Service role can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Service role can manage profiles" ON public.profiles;

DROP POLICY IF EXISTS "Users can view own wallet" ON public.wallets;
DROP POLICY IF EXISTS "Users can insert own wallet" ON public.wallets;
DROP POLICY IF EXISTS "Service role can insert wallets" ON public.wallets;
DROP POLICY IF EXISTS "Service role can manage wallets" ON public.wallets;

DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Service role can insert transactions" ON public.transactions;
DROP POLICY IF EXISTS "Service role can manage transactions" ON public.transactions;

DROP POLICY IF EXISTS "Events are viewable by everyone" ON public.events;
DROP POLICY IF EXISTS "Service role can manage events" ON public.events;

DROP POLICY IF EXISTS "Open bets are viewable by everyone" ON public.bets;
DROP POLICY IF EXISTS "Users can create bets" ON public.bets;
DROP POLICY IF EXISTS "Users can update own bets" ON public.bets;
DROP POLICY IF EXISTS "Service role can manage bets" ON public.bets;

DROP POLICY IF EXISTS "Users can view own rewards" ON public.daily_rewards;
DROP POLICY IF EXISTS "Users can insert own daily_rewards" ON public.daily_rewards;
DROP POLICY IF EXISTS "Service role can manage daily_rewards" ON public.daily_rewards;

-- Re-crear políticas finales
CREATE POLICY "Profiles are viewable by everyone"
ON public.profiles FOR SELECT
USING (true);

CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT
WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
USING (auth.uid() = id);

CREATE POLICY "Service role can manage profiles"
ON public.profiles FOR ALL
USING (auth.role() = 'service_role');

CREATE POLICY "Users can view own wallet"
ON public.wallets FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own wallet"
ON public.wallets FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage wallets"
ON public.wallets FOR ALL
USING (auth.role() = 'service_role');

CREATE POLICY "Users can view own transactions"
ON public.transactions FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions"
ON public.transactions FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can insert transactions"
ON public.transactions FOR INSERT
WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can manage transactions"
ON public.transactions FOR ALL
USING (auth.role() = 'service_role');

CREATE POLICY "Events are viewable by everyone"
ON public.events FOR SELECT
USING (true);

CREATE POLICY "Service role can manage events"
ON public.events FOR ALL
USING (auth.role() = 'service_role');

CREATE POLICY "Open bets are viewable by everyone"
ON public.bets FOR SELECT
USING (
  status = 'open'
  OR auth.uid() = creator_id
  OR auth.uid() = acceptor_id
);

CREATE POLICY "Users can create bets"
ON public.bets FOR INSERT
WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Users can update own bets"
ON public.bets FOR UPDATE
USING (auth.uid() = creator_id OR auth.uid() = acceptor_id);

CREATE POLICY "Service role can manage bets"
ON public.bets FOR ALL
USING (auth.role() = 'service_role');

CREATE POLICY "Users can view own rewards"
ON public.daily_rewards FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own daily_rewards"
ON public.daily_rewards FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage daily_rewards"
ON public.daily_rewards FOR ALL
USING (auth.role() = 'service_role');

-- =====================================================
-- OPCIONAL: PROMOVER ADMIN DE BACKOFFICE
-- =====================================================
-- UPDATE public.profiles
-- SET role = 'backoffice_admin'
-- WHERE id = '<UUID_DEL_ADMIN>';
