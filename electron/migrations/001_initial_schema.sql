-- Foundation schema only. Business modules add their own versioned migrations.
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS app_meta (
  meta_key TEXT PRIMARY KEY,
  meta_value TEXT NOT NULL
);
INSERT OR IGNORE INTO app_meta (meta_key, meta_value) VALUES ('application_id', 'market-desktop');
INSERT OR IGNORE INTO app_meta (meta_key, meta_value) VALUES ('data_schema_family', 'market');
