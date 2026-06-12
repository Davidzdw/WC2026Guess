INSERT INTO settings (key, value)
VALUES ('autoSyncMinutes', '60')
ON CONFLICT(key) DO UPDATE SET value = '60';

DELETE FROM settings WHERE key = 'knockoutLookaheadHours';
