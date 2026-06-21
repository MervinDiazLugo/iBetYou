-- iBYC System Migration
-- Run in Supabase SQL editor in this order

-- 1. WhatsApp on profiles (optional field)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_whatsapp TEXT;

-- 2. Rate cache table
CREATE TABLE IF NOT EXISTS ibeyc_rate_cache (
  currency    CHAR(3) PRIMARY KEY,
  rate_to_usd NUMERIC(18, 6) NOT NULL,
  source      TEXT NOT NULL,
  tier        TEXT NOT NULL CHECK (tier IN ('official', 'parallel')),
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

-- 3. Deposits table
CREATE TABLE IF NOT EXISTS ibeyc_deposits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id),

  currency          CHAR(3) NOT NULL,
  amount_local      NUMERIC(18, 2) NOT NULL CHECK (amount_local > 0),

  rate_to_usd       NUMERIC(18, 6) NOT NULL,
  rate_tier         TEXT NOT NULL CHECK (rate_tier IN ('official', 'parallel')),
  rate_source       TEXT NOT NULL,
  rate_fetched_at   TIMESTAMPTZ NOT NULL,
  rate_is_cached    BOOLEAN NOT NULL DEFAULT FALSE,

  amount_ibyc       NUMERIC(18, 8) NOT NULL,

  payment_method    TEXT NOT NULL CHECK (payment_method IN ('binance', 'bank_transfer')),
  proof_reference   TEXT,         -- transaction reference number submitted by user
  contact_whatsapp  TEXT,         -- whatsapp number for admin to reach user if needed

  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'proof_submitted', 'confirmed', 'failed')),
  confirmed_at      TIMESTAMPTZ,
  confirmed_by      UUID REFERENCES profiles(id),
  failed_reason     TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ibeyc_deposits_user   ON ibeyc_deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_ibeyc_deposits_status ON ibeyc_deposits(status);
CREATE INDEX IF NOT EXISTS idx_ibeyc_deposits_created ON ibeyc_deposits(created_at DESC);

-- 4. Withdrawals table
CREATE TABLE IF NOT EXISTS ibeyc_withdrawals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES profiles(id),

  currency             CHAR(3) NOT NULL,
  amount_ibyc_requested NUMERIC(18, 8) NOT NULL CHECK (amount_ibyc_requested > 0),
  fee_ibyc             NUMERIC(18, 8) NOT NULL,   -- 6% of requested amount
  amount_ibyc_net      NUMERIC(18, 8) NOT NULL,   -- requested - fee
  rate_to_usd          NUMERIC(18, 6) NOT NULL,
  rate_source          TEXT NOT NULL,
  amount_local         NUMERIC(18, 2) NOT NULL,   -- amount_ibyc_net * rate_to_usd (in local currency)

  payment_method       TEXT NOT NULL CHECK (payment_method IN ('binance', 'bank_transfer')),
  payment_details      TEXT NOT NULL,             -- Binance ID or bank account provided by user
  contact_whatsapp     TEXT,

  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
  processed_at         TIMESTAMPTZ,
  processed_by         UUID REFERENCES profiles(id),
  rejection_reason     TEXT,
  admin_notes          TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ibeyc_withdrawals_user   ON ibeyc_withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_ibeyc_withdrawals_status ON ibeyc_withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_ibeyc_withdrawals_created ON ibeyc_withdrawals(created_at DESC);

-- 5. Supabase Storage bucket setup (run after creating the bucket manually in Dashboard)
-- Bucket name: deposit-proofs (not needed anymore — we use reference numbers)
-- No storage needed.

-- Done.
