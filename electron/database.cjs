const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const MIGRATION_NAME = /^([0-9]{3,})_[a-z0-9_-]+\.sql$/i;

function listMigrations(migrationsDir) {
  return fs.readdirSync(migrationsDir)
    .filter((name) => MIGRATION_NAME.test(name))
    .map((name) => ({
      name,
      version: Number(name.match(MIGRATION_NAME)[1]),
      sql: fs.readFileSync(path.join(migrationsDir, name), 'utf8')
    }))
    .sort((a, b) => a.version - b.version);
}

function runMigrations(db, migrationsDir) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);

  const migrations = listMigrations(migrationsDir);
  const seenVersions = new Set();
  for (const migration of migrations) {
    if (seenVersions.has(migration.version)) throw new Error(`Duplicate migration version: ${migration.version}`);
    seenVersions.add(migration.version);
  }

  const hasMigration = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
  const recordMigration = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)');
  for (const migration of migrations) {
    if (hasMigration.get(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      recordMigration.run(migration.version, migration.name);
    })();
  }
}

function openDatabase(databasePath, migrationsDir) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath, { timeout: 5000 });
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    runMigrations(db, migrationsDir);
    const result = db.pragma('quick_check');
    if (!result.length || result[0].quick_check !== 'ok') throw new Error('SQLite integrity check failed');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

module.exports = { openDatabase, runMigrations, listMigrations };
