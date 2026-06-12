INSERT INTO settings (key, value)
VALUES ('maxUsers', '50')
ON CONFLICT(key) DO NOTHING;
