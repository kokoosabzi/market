const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const MIGRATION_NAME = /^([0-9]{3,})_[a-z0-9_-]+\.sql$/i;

function listMigrations(migrationsDir) {
  const files = fs.readdirSync(migrationsDir);
  const invalidSqlFiles = files.filter((name) => name.toLowerCase().endsWith('.sql') && !MIGRATION_NAME.test(name));
  if (invalidSqlFiles.length) {
    throw new Error('Invalid migration filename(s): ' + invalidSqlFiles.join(', '));
  }
  return files
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

  const appliedMigrations = db.prepare(
    'SELECT version, name FROM schema_migrations ORDER BY version'
  ).all();
  const migrationsByVersion = new Map(migrations.map((migration) => [migration.version, migration]));

  // Every recorded migration must still exist under the same version and name.
  for (const applied of appliedMigrations) {
    const localMigration = migrationsByVersion.get(applied.version);
    if (!localMigration || localMigration.name !== applied.name) {
      const localName = localMigration ? localMigration.name : 'missing';
      throw new Error('Migration history mismatch at version ' + applied.version +
        ': database has "' + applied.name + '" but local migration is "' + localName + '"');
    }
  }

  // Applied rows must form a complete prefix of the local migration sequence.
  // Otherwise a missing history row could cause an already-applied SQL file to run again.
  for (let index = 0; index < appliedMigrations.length; index += 1) {
    const expected = migrations[index];
    const applied = appliedMigrations[index];
    if (!expected || expected.version !== applied.version || expected.name !== applied.name) {
      throw new Error('Incomplete migration history: expected migration ' +
        (expected ? expected.version + ' (' + expected.name + ')' : 'end of history') +
        ' at history position ' + (index + 1) + ', found ' +
        applied.version + ' (' + applied.name + ')');
    }
  }

  // An empty history is valid only for a genuinely fresh database. If the
  // application schema already exists, all migration records may have been lost.
  if (appliedMigrations.length === 0) {
    const existingApplicationTables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'"
    ).all();
    if (existingApplicationTables.length > 0) {
      throw new Error('Incomplete migration history: application tables exist but no migrations are recorded');
    }
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
