-- Phase 2: Funnel tracking — log user progression through Fantasy → Real Money funnel
--
-- Events logged:
--   signup                — first successful auth callback (non-admin)
--   first_bet             — first bet created
--   bet_streak_5          — 5th bet in last 30 days (logged once per user)
--   low_balance_reached   — fantasy balance fell below threshold (24h cooldown)
--   viewed_real_money_cta — low-balance banner rendered (from frontend)
--   clicked_real_money_cta— CTA link clicked (from frontend)
--   first_real_deposit    — first real-money deposit approved by admin
--
-- Run manually in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS user_funnel_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type  text        NOT NULL,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ufne_user_event ON user_funnel_events(user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_ufne_event_type ON user_funnel_events(event_type);
CREATE INDEX IF NOT EXISTS idx_ufne_created_at  ON user_funnel_events(created_at);
