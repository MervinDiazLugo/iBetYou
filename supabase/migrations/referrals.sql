-- supabase/migrations/referrals.sql

-- Add referral columns to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referral_code VARCHAR(16) UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS referral_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_referrals INTEGER NOT NULL DEFAULT 50;

-- Generate referral codes for existing users (backfill)
UPDATE profiles
SET referral_code = UPPER(SUBSTRING(MD5(id::text) FROM 1 FOR 8))
WHERE referral_code IS NULL;

-- Now make it NOT NULL after backfill
ALTER TABLE profiles ALTER COLUMN referral_code SET NOT NULL;

-- Add locked referral bonus column to wallets
ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS referral_bonus_locked DECIMAL(10,2) NOT NULL DEFAULT 0;

-- New referral_bonuses table
CREATE TABLE IF NOT EXISTS referral_bonuses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  beneficiary_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referrer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  bonus_amount DECIMAL(10,2) NOT NULL DEFAULT 50,
  wagering_required DECIMAL(10,2) NOT NULL,
  wagering_progress DECIMAL(10,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'locked',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unlocked_at TIMESTAMPTZ,
  CONSTRAINT referral_bonuses_unique UNIQUE (beneficiary_id, referee_id),
  CONSTRAINT referral_bonuses_status CHECK (status IN ('locked', 'unlocked', 'claimed')),
  CONSTRAINT referral_bonuses_parties CHECK (beneficiary_id = referrer_id OR beneficiary_id = referee_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_bonuses_beneficiary ON referral_bonuses(beneficiary_id);
CREATE INDEX IF NOT EXISTS idx_referral_bonuses_referee ON referral_bonuses(referee_id);
CREATE INDEX IF NOT EXISTS idx_referral_bonuses_status ON referral_bonuses(status);
CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON profiles(referral_code);

-- RLS for referral_bonuses
ALTER TABLE referral_bonuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own referral bonuses" ON referral_bonuses
  FOR SELECT USING (auth.uid() = beneficiary_id);
CREATE POLICY "Service role can manage referral_bonuses" ON referral_bonuses
  FOR ALL USING (auth.role() = 'service_role');
