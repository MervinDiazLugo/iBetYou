-- Moderation and safety columns missing from initial profiles schema.
-- Referenced throughout API routes but never created via migration.
-- All columns are safe to add with defaults — no data loss.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_banned              boolean      NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS betting_blocked_until  timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS false_claim_count      integer      NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS real_betting_enabled   boolean      NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_is_banned ON profiles(is_banned) WHERE is_banned = true;
