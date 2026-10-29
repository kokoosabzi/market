const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, runMigrations, listMigrations } = require('../electron/database.cjs');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'market-db-test-'));
  return { directory, databasePath: path.join(directory, 'nested', 'market.sqlite'), migrationsDir: path.join(__dirname, '../electron/migrations') };
}

test('opens a local database and applies initial migration', (t) => {
  const f = fixture();
  const db = openDatabase(f.databasePath, f.migrationsDir);
  t.after(() => {
    if (db.open) db.close();
    fs.rmSync(f.directory, { recursive: true, force: true });
  });
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 3);
  assert.equal(db.prepare("SELECT meta_value FROM app_meta WHERE meta_key = 'application_id'").get().meta_value, 'market-desktop');
  assert.equal(db.pragma('quick_check')[0].quick_check, 'ok');
});

test('migrations are idempotent', (t) => {
  const f = fixture();
  const db = openDatabase(f.databasePath, f.migrationsDir);
  t.after(() => {
    if (db.open) db.close();
    fs.rmSync(f.directory, { recursive: true, force: true });
  });
  runMigrations(db, f.migrationsDir);
  runMigrations(db, f.migrationsDir);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM app_meta').get().count, 2);
});

test('a database transaction commits atomically and rolls back on error', (t) => {
  const f = fixture();
  const db = openDatabase(f.databasePath, f.migrationsDir);
  t.after(() => {
    if (db.open) db.close();
    fs.rmSync(f.directory, { recursive: true, force: true });
  });

  db.transaction(() => {
    db.prepare('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)').run('theme', 'light');
  })();
  assert.equal(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'theme'").get().setting_value, 'light');

  assert.throws(() => db.transaction(() => {
    db.prepare('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)').run('temporary', 'value');
    throw new Error('force rollback');
  })());
  assert.equal(db.prepare("SELECT setting_key FROM app_settings WHERE setting_key = 'temporary'").get(), undefined);
});

test('rejects migration history drift instead of silently skipping it', (t) => {
  const f = fixture();
  const db = openDatabase(f.databasePath, f.migrationsDir);
  t.after(() => {
    if (db.open) db.close();
    fs.rmSync(f.directory, { recursive: true, force: true });
  });

  db.prepare('UPDATE schema_migrations SET name = ? WHERE version = 1').run('001_different_schema');
  assert.throws(() => runMigrations(db, f.migrationsDir), /Migration history mismatch at version 1/);
});

test('a failed migration rolls back and is not recorded', (t) => {
  const f = fixture();
  const migrationsDir = path.join(f.directory, 'migrations');
  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.mkdirSync(path.dirname(f.databasePath), { recursive: true });
  fs.writeFileSync(path.join(migrationsDir, '001_broken.sql'), 'CREATE TABLE should_rollback (id INTEGER PRIMARY KEY); SELECT * FROM missing_table;');
  const Database = require('better-sqlite3');
  const db = new Database(f.databasePath);
  t.after(() => {
    if (db.open) db.close();
    fs.rmSync(f.directory, { recursive: true, force: true });
  });
  assert.throws(() => runMigrations(db, migrationsDir));
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'").get(), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 0);
});

test('rejects malformed SQL migration filenames instead of silently ignoring them', (t) => {
  const f = fixture();
  const migrationsDir = path.join(f.directory, 'migrations');
  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.writeFileSync(path.join(migrationsDir, '002 missing-name.sql'), 'SELECT 1;');
  t.after(() => fs.rmSync(f.directory, { recursive: true, force: true }));

  assert.throws(() => listMigrations(migrationsDir), /Invalid migration filename.*002 missing-name\.sql/);
});

test('rejects a missing earlier migration record when a later migration is recorded', (t) => {
  const f = fixture();
  const migrationsDir = path.join(f.directory, 'migrations');
  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.writeFileSync(path.join(migrationsDir, '001_first.sql'), 'CREATE TABLE first_table (id INTEGER PRIMARY KEY);');
  fs.writeFileSync(path.join(migrationsDir, '002_second.sql'), 'CREATE TABLE second_table (id INTEGER PRIMARY KEY);');
  fs.mkdirSync(path.dirname(f.databasePath), { recursive: true });
  const Database = require('better-sqlite3');
  const db = new Database(f.databasePath);
  t.after(() => {
    if (db.open) db.close();
    fs.rmSync(f.directory, { recursive: true, force: true });
  });

  runMigrations(db, migrationsDir);
  db.prepare('DELETE FROM schema_migrations WHERE version = 1').run();
  assert.throws(() => runMigrations(db, migrationsDir), /Incomplete migration history/);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'first_table'").get().name, 'first_table');
});

test('rejects an empty migration history when application tables already exist', (t) => {
  const f = fixture();
  const db = openDatabase(f.databasePath, f.migrationsDir);
  t.after(() => {
    if (db.open) db.close();
    fs.rmSync(f.directory, { recursive: true, force: true });
  });

  db.prepare('DELETE FROM schema_migrations').run();
  assert.throws(
    () => runMigrations(db, f.migrationsDir),
    /application tables exist but no migrations are recorded/
  );
});


test('rejects empty migration history when unrelated application tables remain', (t) => {
  const f = fixture();
  const db = openDatabase(f.databasePath, f.migrationsDir);
  t.after(() => {
    if (db.open) db.close();
    fs.rmSync(f.directory, { recursive: true, force: true });
  });

  db.exec('CREATE TABLE orphaned_business_table (id INTEGER PRIMARY KEY)');
  db.prepare('DELETE FROM schema_migrations').run();
  db.exec('DROP TABLE app_settings; DROP TABLE app_meta');

  assert.throws(
    () => runMigrations(db, f.migrationsDir),
    /application tables exist but no migrations are recorded/
  );
  assert.equal(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orphaned_business_table'").get().name,
    'orphaned_business_table'
  );
});
