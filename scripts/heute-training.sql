-- Training am Di 17.11.2026 zurückholen (Janis: alles normal, er kann laufen)
DELETE FROM overrides WHERE date = '2026-11-17' AND field IN ('pause', 'skip', 'moved', 'runNote', 'workout');
DELETE FROM overrides WHERE date = '2026-11-18' AND field = 'addRun' AND value = 'Di Steigerungen';
DELETE FROM coach_plan WHERE date = '2026-11-17' AND kind = 'run';
INSERT INTO overrides (date, field, value, reason, created_at) VALUES ('2026-11-17', 'pause', '0', 'Training findet statt. Du hast gesagt, alles ist normal.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO overrides (date, field, value, reason, created_at) VALUES ('2026-11-17', 'workout', 'Di Steigerungen', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO overrides (date, field, value, reason, created_at) VALUES ('2026-11-17', 'runNote', 'Heute ganz normal laufen: „Di Steigerungen“ auf der Uhr starten (ca. 45–55 min).', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
