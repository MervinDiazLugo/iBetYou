-- Migration: Add UNIQUE constraint to events.external_id
-- Run this AFTER pressing "Eliminar duplicados" in the backoffice events page.

-- Step 1: Remove duplicate events keeping the lowest id for each external_id.
-- Bets referencing duplicate event ids are reassigned to the kept event first.
DO $$
DECLARE
  rec RECORD;
  keep_id INTEGER;
  dup_ids INTEGER[];
BEGIN
  FOR rec IN
    SELECT external_id, array_agg(id ORDER BY id) AS ids
    FROM events
    WHERE external_id IS NOT NULL
    GROUP BY external_id
    HAVING COUNT(*) > 1
  LOOP
    keep_id  := rec.ids[1];
    dup_ids  := rec.ids[2:];

    -- Reassign bets to the kept event
    UPDATE bets SET event_id = keep_id WHERE event_id = ANY(dup_ids);

    -- Delete duplicates
    DELETE FROM events WHERE id = ANY(dup_ids);
  END LOOP;
END $$;

-- Step 2: Add UNIQUE constraint so the database itself enforces no duplicates.
ALTER TABLE events
  ADD CONSTRAINT events_external_id_unique UNIQUE (external_id);
