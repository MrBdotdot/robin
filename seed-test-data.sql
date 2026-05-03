-- =============================================================
-- C4 test seed
--
-- Creates:
--   * 8 players with names prefixed "TEST " (so they're easy to find / wipe)
--   * 1 empty series ("TEST Series")
--   * 2 standalone completed singles events (no series_id), each with
--     filled-in matches, winners, and completed_at timestamps
--
-- After running, exercise C4 from the UI:
--   1. Open /series, tap into "TEST Series".
--   2. Tap "Manage events" -> pick both TEST events -> Save.
--   3. Verify the amber warning shows ("2 completed events will join the series").
--   4. After save, switch to the Ratings tab and confirm
--      rr_series_ratings rows now exist with sensible values.
--
-- Idempotence: each run inserts a fresh batch. The cleanup block at
-- the top can be uncommented to wipe the previous round before reseeding.
-- =============================================================

-- ---------------- Cleanup (uncomment to reset) ----------------
-- DELETE FROM rr_matches            WHERE event_id  IN (SELECT id FROM rr_events  WHERE name      LIKE 'TEST %');
-- DELETE FROM rr_event_players      WHERE event_id  IN (SELECT id FROM rr_events  WHERE name      LIKE 'TEST %');
-- DELETE FROM rr_series_ratings     WHERE series_id IN (SELECT id FROM rr_series  WHERE name      LIKE 'TEST %');
-- DELETE FROM rr_rating_history     WHERE event_id  IN (SELECT id FROM rr_events  WHERE name      LIKE 'TEST %');
-- DELETE FROM rr_events             WHERE name      LIKE 'TEST %';
-- DELETE FROM rr_series             WHERE name      LIKE 'TEST %';
-- DELETE FROM rr_players            WHERE full_name LIKE 'TEST %';

DO $$
DECLARE
  series_id UUID;
  event1_id UUID;
  event2_id UUID;
  alice_id UUID; bob_id UUID; carol_id UUID; dave_id UUID;
  eve_id UUID;   frank_id UUID; grace_id UUID; hank_id UUID;
BEGIN
  -- ---------------- 1. Players ----------------
  INSERT INTO rr_players (full_name, glicko_singles_rating, glicko_singles_rd, glicko_singles_vol,
                          glicko_doubles_rating, glicko_doubles_rd, glicko_doubles_vol)
  VALUES ('TEST Alice', 1700,  60, 0.06, 1700,  60, 0.06)
  RETURNING id INTO alice_id;

  INSERT INTO rr_players (full_name, glicko_singles_rating, glicko_singles_rd, glicko_singles_vol,
                          glicko_doubles_rating, glicko_doubles_rd, glicko_doubles_vol)
  VALUES ('TEST Bob',   1650,  70, 0.06, 1650,  70, 0.06)
  RETURNING id INTO bob_id;

  INSERT INTO rr_players (full_name, glicko_singles_rating, glicko_singles_rd, glicko_singles_vol,
                          glicko_doubles_rating, glicko_doubles_rd, glicko_doubles_vol)
  VALUES ('TEST Carol', 1600,  80, 0.06, 1600,  80, 0.06)
  RETURNING id INTO carol_id;

  INSERT INTO rr_players (full_name, glicko_singles_rating, glicko_singles_rd, glicko_singles_vol,
                          glicko_doubles_rating, glicko_doubles_rd, glicko_doubles_vol)
  VALUES ('TEST Dave',  1550, 100, 0.06, 1550, 100, 0.06)
  RETURNING id INTO dave_id;

  INSERT INTO rr_players (full_name, glicko_singles_rating, glicko_singles_rd, glicko_singles_vol,
                          glicko_doubles_rating, glicko_doubles_rd, glicko_doubles_vol)
  VALUES ('TEST Eve',   1500, 150, 0.06, 1500, 150, 0.06)
  RETURNING id INTO eve_id;

  INSERT INTO rr_players (full_name, glicko_singles_rating, glicko_singles_rd, glicko_singles_vol,
                          glicko_doubles_rating, glicko_doubles_rd, glicko_doubles_vol)
  VALUES ('TEST Frank', 1450, 180, 0.06, 1450, 180, 0.06)
  RETURNING id INTO frank_id;

  INSERT INTO rr_players (full_name, glicko_singles_rating, glicko_singles_rd, glicko_singles_vol,
                          glicko_doubles_rating, glicko_doubles_rd, glicko_doubles_vol)
  VALUES ('TEST Grace', 1400, 200, 0.06, 1400, 200, 0.06)
  RETURNING id INTO grace_id;

  INSERT INTO rr_players (full_name, glicko_singles_rating, glicko_singles_rd, glicko_singles_vol,
                          glicko_doubles_rating, glicko_doubles_rd, glicko_doubles_vol)
  VALUES ('TEST Hank',  1350, 250, 0.06, 1350, 250, 0.06)
  RETURNING id INTO hank_id;

  -- ---------------- 2. Series (target for the assign test) ----------------
  INSERT INTO rr_series (name, description, starts_on)
  VALUES ('TEST Series', 'Seed data for C4 testing', CURRENT_DATE)
  RETURNING id INTO series_id;

  -- ---------------- 3. Events (standalone -> completed) ----------------
  INSERT INTO rr_events (name, sport, mode, format, scoring_template, config,
                         status, scheduled_date, completed_at, started_at)
  VALUES (
    'TEST Event 1', 'Pickleball', 'singles', 'pure_rr',
    '{"type":"win_loss"}'::jsonb,
    '{"num_courts":2,"tiebreakers":["wins","h2h","point_diff"]}'::jsonb,
    'completed',
    (CURRENT_DATE - INTERVAL '14 days')::date,
    NOW()         - INTERVAL '14 days',
    NOW()         - INTERVAL '14 days' - INTERVAL '2 hours'
  )
  RETURNING id INTO event1_id;

  INSERT INTO rr_events (name, sport, mode, format, scoring_template, config,
                         status, scheduled_date, completed_at, started_at)
  VALUES (
    'TEST Event 2', 'Pickleball', 'singles', 'pure_rr',
    '{"type":"win_loss"}'::jsonb,
    '{"num_courts":2,"tiebreakers":["wins","h2h","point_diff"]}'::jsonb,
    'completed',
    (CURRENT_DATE - INTERVAL '7 days')::date,
    NOW()         - INTERVAL '7 days',
    NOW()         - INTERVAL '7 days' - INTERVAL '2 hours'
  )
  RETURNING id INTO event2_id;

  -- ---------------- 4. Event players (with snapshots) ----------------
  -- Event 1: all 8
  -- Event 2: 6 of the 8 (Alice/Bob/Carol/Dave/Eve/Frank). The overlap
  -- with Event 1 is what exercises the "already has a series row,
  -- don't overwrite rating" branch when assigning Event 2 second.

  -- Event 1
  INSERT INTO rr_event_players (event_id, player_id, seed, initial_rating_snapshot)
  SELECT
    event1_id,
    p.id,
    ROW_NUMBER() OVER (ORDER BY p.glicko_singles_rating DESC),
    jsonb_build_object(
      'global', jsonb_build_object(
        'singles', jsonb_build_object('rating', p.glicko_singles_rating,
                                      'rd',     p.glicko_singles_rd,
                                      'vol',    p.glicko_singles_vol),
        'doubles', jsonb_build_object('rating', p.glicko_doubles_rating,
                                      'rd',     p.glicko_doubles_rd,
                                      'vol',    p.glicko_doubles_vol)
      )
    )
  FROM rr_players p
  WHERE p.id IN (alice_id, bob_id, carol_id, dave_id, eve_id, frank_id, grace_id, hank_id);

  -- Event 2 (subset of 6)
  INSERT INTO rr_event_players (event_id, player_id, seed, initial_rating_snapshot)
  SELECT
    event2_id,
    p.id,
    ROW_NUMBER() OVER (ORDER BY p.glicko_singles_rating DESC),
    jsonb_build_object(
      'global', jsonb_build_object(
        'singles', jsonb_build_object('rating', p.glicko_singles_rating,
                                      'rd',     p.glicko_singles_rd,
                                      'vol',    p.glicko_singles_vol),
        'doubles', jsonb_build_object('rating', p.glicko_doubles_rating,
                                      'rd',     p.glicko_doubles_rd,
                                      'vol',    p.glicko_doubles_vol)
      )
    )
  FROM rr_players p
  WHERE p.id IN (alice_id, bob_id, carol_id, dave_id, eve_id, frank_id);

  -- ---------------- 5. Matches ----------------
  -- Event 1: 6 completed matches, spread across 3 rounds.
  -- Higher-rated player wins more often (not always) so the replay
  -- produces non-trivial rating movement.
  INSERT INTO rr_matches (event_id, stage, round, court, side_a_player_ids, side_b_player_ids,
                          status, winner_side, scores, scheduled_at, completed_at)
  VALUES
    (event1_id, 'group_rr', 1, 1, ARRAY[alice_id], ARRAY[hank_id],  'completed', 'a', '{"a":11,"b":4}'::jsonb,  NOW() - INTERVAL '14 days' - INTERVAL '90 minutes', NOW() - INTERVAL '14 days' - INTERVAL '80 minutes'),
    (event1_id, 'group_rr', 1, 2, ARRAY[bob_id],   ARRAY[grace_id], 'completed', 'a', '{"a":11,"b":6}'::jsonb,  NOW() - INTERVAL '14 days' - INTERVAL '85 minutes', NOW() - INTERVAL '14 days' - INTERVAL '75 minutes'),
    (event1_id, 'group_rr', 2, 1, ARRAY[carol_id], ARRAY[frank_id], 'completed', 'a', '{"a":11,"b":7}'::jsonb,  NOW() - INTERVAL '14 days' - INTERVAL '70 minutes', NOW() - INTERVAL '14 days' - INTERVAL '60 minutes'),
    (event1_id, 'group_rr', 2, 2, ARRAY[dave_id],  ARRAY[eve_id],   'completed', 'b', '{"a":9,"b":11}'::jsonb,  NOW() - INTERVAL '14 days' - INTERVAL '65 minutes', NOW() - INTERVAL '14 days' - INTERVAL '55 minutes'),
    (event1_id, 'group_rr', 3, 1, ARRAY[alice_id], ARRAY[bob_id],   'completed', 'b', '{"a":9,"b":11}'::jsonb,  NOW() - INTERVAL '14 days' - INTERVAL '50 minutes', NOW() - INTERVAL '14 days' - INTERVAL '40 minutes'),
    (event1_id, 'group_rr', 3, 2, ARRAY[carol_id], ARRAY[dave_id],  'completed', 'a', '{"a":11,"b":8}'::jsonb,  NOW() - INTERVAL '14 days' - INTERVAL '45 minutes', NOW() - INTERVAL '14 days' - INTERVAL '35 minutes');

  -- Event 2: 5 completed matches.
  INSERT INTO rr_matches (event_id, stage, round, court, side_a_player_ids, side_b_player_ids,
                          status, winner_side, scores, scheduled_at, completed_at)
  VALUES
    (event2_id, 'group_rr', 1, 1, ARRAY[alice_id], ARRAY[frank_id], 'completed', 'a', '{"a":11,"b":5}'::jsonb,  NOW() - INTERVAL '7 days' - INTERVAL '90 minutes', NOW() - INTERVAL '7 days' - INTERVAL '80 minutes'),
    (event2_id, 'group_rr', 1, 2, ARRAY[bob_id],   ARRAY[eve_id],   'completed', 'a', '{"a":11,"b":9}'::jsonb,  NOW() - INTERVAL '7 days' - INTERVAL '85 minutes', NOW() - INTERVAL '7 days' - INTERVAL '75 minutes'),
    (event2_id, 'group_rr', 2, 1, ARRAY[carol_id], ARRAY[dave_id],  'completed', 'a', '{"a":11,"b":8}'::jsonb,  NOW() - INTERVAL '7 days' - INTERVAL '70 minutes', NOW() - INTERVAL '7 days' - INTERVAL '60 minutes'),
    (event2_id, 'group_rr', 2, 2, ARRAY[alice_id], ARRAY[bob_id],   'completed', 'a', '{"a":11,"b":7}'::jsonb,  NOW() - INTERVAL '7 days' - INTERVAL '65 minutes', NOW() - INTERVAL '7 days' - INTERVAL '55 minutes'),
    (event2_id, 'group_rr', 3, 1, ARRAY[carol_id], ARRAY[eve_id],   'completed', 'b', '{"a":8,"b":11}'::jsonb,  NOW() - INTERVAL '7 days' - INTERVAL '50 minutes', NOW() - INTERVAL '7 days' - INTERVAL '40 minutes');

  RAISE NOTICE 'Seeded series=%, event1=%, event2=%', series_id, event1_id, event2_id;
END $$;
