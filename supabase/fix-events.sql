-- Disable RLS for events table
ALTER TABLE events DISABLE ROW LEVEL SECURITY;

-- Enable with simple policy
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Events are viewable by everyone" ON events;
CREATE POLICY "Allow all events" ON events FOR ALL USING (true) WITH CHECK (true);
