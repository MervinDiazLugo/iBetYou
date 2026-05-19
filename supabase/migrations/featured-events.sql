-- Add featured column to events for highlighting on marketplace
ALTER TABLE events ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
-- Backfill any NULL values (safety net)
UPDATE events SET featured = false WHERE featured IS NULL;
