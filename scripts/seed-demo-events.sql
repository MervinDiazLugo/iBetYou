-- Seed de eventos para Demo Mode
-- Ejecutar en Supabase SQL editor ANTES de activar demo mode por primera vez.
-- Estos eventos se mantienen con status='finished' y is_demo=false.
-- El demo route los recoge al activarse y los marca is_demo=true con start_time 2h ahead.
-- external_id prefix 'seed_' los distingue de eventos reales de TheSportsDB.

INSERT INTO events (external_id, sport, league, country, home_team, away_team, home_logo, away_logo, start_time, status, home_score, away_score, featured, is_demo, metadata)
VALUES

-- ─── FÚTBOL (16 partidos icónicos) ───────────────────────────────────────────

('seed_football_001', 'football', 'La Liga', 'Spain',
 'Real Madrid', 'FC Barcelona', NULL, NULL,
 '2024-10-26 20:00:00+00', 'finished', 2, 1, false, false,
 '{"venue":{"name":"Santiago Bernabéu","city":"Madrid"}}'),

('seed_football_002', 'football', 'Premier League', 'England',
 'Manchester City', 'Arsenal', NULL, NULL,
 '2024-10-05 16:30:00+00', 'finished', 2, 2, false, false,
 '{"venue":{"name":"Etihad Stadium","city":"Manchester"}}'),

('seed_football_003', 'football', 'Premier League', 'England',
 'Liverpool', 'Manchester United', NULL, NULL,
 '2024-09-01 16:30:00+00', 'finished', 3, 0, false, false,
 '{"venue":{"name":"Anfield","city":"Liverpool"}}'),

('seed_football_004', 'football', 'Bundesliga', 'Germany',
 'Bayern Munich', 'Borussia Dortmund', NULL, NULL,
 '2024-11-02 17:30:00+00', 'finished', 3, 2, false, false,
 '{"venue":{"name":"Allianz Arena","city":"Munich"}}'),

('seed_football_005', 'football', 'Serie A', 'Italy',
 'AC Milan', 'Inter Milan', NULL, NULL,
 '2024-09-22 19:45:00+00', 'finished', 1, 2, false, false,
 '{"venue":{"name":"Stadio Giuseppe Meazza","city":"Milan"}}'),

('seed_football_006', 'football', 'Ligue 1', 'France',
 'Paris Saint-Germain', 'Olympique de Marseille', NULL, NULL,
 '2024-11-03 20:45:00+00', 'finished', 3, 0, false, false,
 '{"venue":{"name":"Parc des Princes","city":"Paris"}}'),

('seed_football_007', 'football', 'UEFA Champions League', 'Europe',
 'Real Madrid', 'Manchester City', NULL, NULL,
 '2024-04-09 21:00:00+00', 'finished', 3, 3, false, false,
 '{"venue":{"name":"Santiago Bernabéu","city":"Madrid"}}'),

('seed_football_008', 'football', 'UEFA Champions League', 'Europe',
 'FC Barcelona', 'Bayern Munich', NULL, NULL,
 '2024-10-23 21:00:00+00', 'finished', 4, 1, false, false,
 '{"venue":{"name":"Estadi Olímpic Lluís Companys","city":"Barcelona"}}'),

('seed_football_009', 'football', 'Copa Libertadores', 'South America',
 'Boca Juniors', 'River Plate', NULL, NULL,
 '2024-05-30 01:00:00+00', 'finished', 1, 2, false, false,
 '{"venue":{"name":"La Bombonera","city":"Buenos Aires"}}'),

('seed_football_010', 'football', 'Copa Libertadores', 'South America',
 'Flamengo', 'Palmeiras', NULL, NULL,
 '2024-09-18 01:30:00+00', 'finished', 2, 1, false, false,
 '{"venue":{"name":"Estadio Maracanã","city":"Rio de Janeiro"}}'),

('seed_football_011', 'football', 'Liga MX', 'Mexico',
 'Club América', 'Chivas Guadalajara', NULL, NULL,
 '2024-09-14 03:00:00+00', 'finished', 2, 0, false, false,
 '{"venue":{"name":"Estadio Azteca","city":"Mexico City"}}'),

('seed_football_012', 'football', 'Brazilian Serie A', 'Brazil',
 'Atlético Mineiro', 'São Paulo', NULL, NULL,
 '2024-10-20 22:00:00+00', 'finished', 3, 1, false, false,
 '{"venue":{"name":"Arena MRV","city":"Belo Horizonte"}}'),

('seed_football_013', 'football', 'UEFA Europa League', 'Europe',
 'Sporting CP', 'Manchester United', NULL, NULL,
 '2024-11-07 20:00:00+00', 'finished', 2, 0, false, false,
 '{"venue":{"name":"Estádio José Alvalade","city":"Lisbon"}}'),

('seed_football_014', 'football', 'La Liga', 'Spain',
 'Atlético de Madrid', 'Real Madrid', NULL, NULL,
 '2024-09-29 20:00:00+00', 'finished', 1, 1, false, false,
 '{"venue":{"name":"Estadio Metropolitano","city":"Madrid"}}'),

('seed_football_015', 'football', 'Premier League', 'England',
 'Chelsea', 'Tottenham Hotspur', NULL, NULL,
 '2024-11-03 16:30:00+00', 'finished', 4, 3, false, false,
 '{"venue":{"name":"Stamford Bridge","city":"London"}}'),

('seed_football_016', 'football', 'Copa Sudamericana', 'South America',
 'Estudiantes de La Plata', 'Botafogo', NULL, NULL,
 '2024-10-23 01:00:00+00', 'finished', 0, 0, false, false,
 '{"venue":{"name":"Estadio Único Diego Armando Maradona","city":"La Plata"}}'),

-- ─── BASKETBALL (8 partidos icónicos) ────────────────────────────────────────

('seed_basketball_001', 'basketball', 'NBA', 'USA',
 'Los Angeles Lakers', 'Boston Celtics', NULL, NULL,
 '2024-01-21 03:30:00+00', 'finished', 105, 108, false, false,
 '{"venue":{"name":"Crypto.com Arena","city":"Los Angeles"}}'),

('seed_basketball_002', 'basketball', 'NBA', 'USA',
 'Golden State Warriors', 'Denver Nuggets', NULL, NULL,
 '2024-02-10 04:00:00+00', 'finished', 122, 115, false, false,
 '{"venue":{"name":"Chase Center","city":"San Francisco"}}'),

('seed_basketball_003', 'basketball', 'NBA', 'USA',
 'Milwaukee Bucks', 'Miami Heat', NULL, NULL,
 '2024-03-14 01:00:00+00', 'finished', 118, 110, false, false,
 '{"venue":{"name":"Fiserv Forum","city":"Milwaukee"}}'),

('seed_basketball_004', 'basketball', 'NBA', 'USA',
 'Oklahoma City Thunder', 'Minnesota Timberwolves', NULL, NULL,
 '2024-04-07 00:30:00+00', 'finished', 130, 106, false, false,
 '{"venue":{"name":"Paycom Center","city":"Oklahoma City"}}'),

('seed_basketball_005', 'basketball', 'NBA', 'USA',
 'Cleveland Cavaliers', 'New York Knicks', NULL, NULL,
 '2024-03-03 01:00:00+00', 'finished', 112, 99, false, false,
 '{"venue":{"name":"Rocket Mortgage FieldHouse","city":"Cleveland"}}'),

('seed_basketball_006', 'basketball', 'EuroLeague Basketball', 'Europe',
 'Real Madrid', 'Olympiacos Piraeus', NULL, NULL,
 '2024-11-14 21:00:00+00', 'finished', 88, 72, false, false,
 '{"venue":{"name":"WiZink Center","city":"Madrid"}}'),

('seed_basketball_007', 'basketball', 'EuroLeague Basketball', 'Europe',
 'FC Barcelona', 'Fenerbahce Beko Istanbul', NULL, NULL,
 '2024-10-25 20:45:00+00', 'finished', 79, 94, false, false,
 '{"venue":{"name":"Palau Blaugrana","city":"Barcelona"}}'),

('seed_basketball_008', 'basketball', 'EuroLeague Basketball', 'Europe',
 'ALBA Berlin', 'Anadolu Efes Istanbul', NULL, NULL,
 '2024-11-07 19:00:00+00', 'finished', 71, 83, false, false,
 '{"venue":{"name":"Mercedes-Benz Arena","city":"Berlin"}}'),

-- ─── BASEBALL (5 partidos icónicos) ──────────────────────────────────────────

('seed_baseball_001', 'baseball', 'MLB', 'USA',
 'New York Yankees', 'Boston Red Sox', NULL, NULL,
 '2024-09-21 23:10:00+00', 'finished', 7, 3, false, false,
 '{"venue":{"name":"Yankee Stadium","city":"New York"}}'),

('seed_baseball_002', 'baseball', 'MLB', 'USA',
 'Los Angeles Dodgers', 'San Francisco Giants', NULL, NULL,
 '2024-09-15 02:10:00+00', 'finished', 5, 2, false, false,
 '{"venue":{"name":"Dodger Stadium","city":"Los Angeles"}}'),

('seed_baseball_003', 'baseball', 'MLB', 'USA',
 'Atlanta Braves', 'New York Mets', NULL, NULL,
 '2024-09-18 23:20:00+00', 'finished', 3, 6, false, false,
 '{"venue":{"name":"Truist Park","city":"Atlanta"}}'),

('seed_baseball_004', 'baseball', 'MLB', 'USA',
 'Houston Astros', 'Texas Rangers', NULL, NULL,
 '2024-09-20 00:10:00+00', 'finished', 4, 5, false, false,
 '{"venue":{"name":"Minute Maid Park","city":"Houston"}}'),

('seed_baseball_005', 'baseball', 'NPB', 'Japan',
 'Yomiuri Giants', 'Hanshin Tigers', NULL, NULL,
 '2024-10-14 10:00:00+00', 'finished', 3, 4, false, false,
 '{"venue":{"name":"Tokyo Dome","city":"Tokyo"}}')

ON CONFLICT (external_id) DO NOTHING;
