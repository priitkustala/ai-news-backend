// The migration command that applies only the pending migrations, with a dry run
// (priitkustala/ai-news-backend#58, AC-1 to AC-5): applyMigrations on folders built here under the
// system temporary folder (a copy of db/migrations, already in the ledger, plus the test's own
// files), and the command form `apply-migrations` spawned with only MIGRATION_DATABASE_URL set.
// Runs after npm run build against the box stack migrated with `node dist/cli.js migrate`; the
// address is loaded from the stack's local.env as the command loads it and never printed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from '../dist/env.js';
import { withClient } from '../dist/db.js';
import { applyMigrations } from '../dist/migrate.js';

loadLocalEnv();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(root, 'db', 'migrations');
const REPORT_KEYS = ['mode', 'pending', 'applied', 'failed', 'error_code', 'files_total', 'ledger_total', 'owner_only_findings'];
const TEST_TABLES = ['app_private.t58_note', 'app_private.t58_first', 'app_private.t58_third', 'public.t58_open'];

const NOTE = {
  '9001_t58_note.sql':
    'create table app_private.t58_note (id integer primary key);\nrevoke all on table app_private.t58_note from public, anon, authenticated;\n',
  '9002_t58_note_body.sql': 'alter table app_private.t58_note add column body text;\n',
};
const THREE = {
  '9011_t58_first.sql':
    'create table app_private.t58_first (id integer primary key);\nrevoke all on table app_private.t58_first from public, anon, authenticated;\n',
  '9012_t58_invalid.sql': 'this is not sql;\n',
  '9013_t58_third.sql':
    'create table app_private.t58_third (id integer primary key);\nrevoke all on table app_private.t58_third from public, anon, authenticated;\n',
};
const OPEN = {
  '9021_t58_open_to_anon.sql': 'create table public.t58_open (id integer primary key);\ngrant select on table public.t58_open to anon;\n',
};
const TEST_VERSIONS = [...Object.keys(NOTE), ...Object.keys(THREE), ...Object.keys(OPEN)];

const query = (sql, params = []) => withClient('MIGRATION_DATABASE_URL', async (client) => (await client.query(sql, params)).rows);

async function cleanUp() {
  await withClient('MIGRATION_DATABASE_URL', async (client) => {
    for (const table of TEST_TABLES) await client.query(`drop table if exists ${table}`);
    await client.query('delete from app_private.schema_migrations where version = any($1::text[])', [TEST_VERSIONS]);
  });
}

// A folder of its own: every file of db/migrations plus the test's files.
function buildFolder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't58-'));
  for (const file of fs.readdirSync(MIGRATIONS)) fs.copyFileSync(path.join(MIGRATIONS, file), path.join(dir, file));
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}

async function inFolder(files, work) {
  const dir = buildFolder(files);
  try {
    return await work(dir, fs.readdirSync(dir).length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The form of catalogState in src/migrate.ts over the schemas public and app_private: name, kind and
// access list of every relation, and the policies of public.
async function fingerprint() {
  const [row] = await query(
    `select md5(coalesce((select string_agg(concat_ws('|', tablename, policyname, permissive, roles::text, cmd, qual, with_check), ',' order by tablename, policyname)
                            from pg_catalog.pg_policies where schemaname = 'public'), '')
                || coalesce((select string_agg(concat_ws('|', n.nspname, c.relname, c.relkind, c.relacl::text), ',' order by n.nspname, c.relname)
                               from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                              where n.nspname in ('public', 'app_private')), '')) as fingerprint`,
  );
  return row.fingerprint;
}

async function ledger() {
  return (await query('select version from app_private.schema_migrations order by version')).map((r) => r.version);
}

async function relationExists(name) {
  const [row] = await query('select to_regclass($1) is not null as present', [name]);
  return row.present;
}

async function ledgerHas(version) {
  const [row] = await query('select exists (select 1 from app_private.schema_migrations where version = $1) as present', [version]);
  return row.present;
}

async function counts() {
  const [row] = await query(
    `select (select count(*)::integer from auth.users) as users,
            (select count(*)::integer from app_private.owner) as owner,
            (select count(*)::integer from public.items) as items`,
  );
  return row;
}

// The command form: only PATH and the migration address in its environment.
function runCommand(address) {
  return spawnSync(process.execPath, ['dist/cli.js', 'apply-migrations'], {
    cwd: root,
    env: { PATH: process.env.PATH, MIGRATION_DATABASE_URL: address },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

before(async () => {
  if (!process.env.MIGRATION_DATABASE_URL) {
    throw new Error('Set-up: MIGRATION_DATABASE_URL is not set; run `node dist/cli.js keys` and start the stack, or set it.');
  }
  await cleanUp();
  const report = await applyMigrations({ dryRun: true });
  if (report.pending.length > 0 || report.error_code !== null || report.failed !== null) {
    throw new Error(`Set-up: the database is not at the last migration (pending ${report.pending.length}, failed ${report.failed}, error_code ${report.error_code}); run \`node dist/cli.js migrate\` first.`);
  }
});

after(cleanUp);

test('AC-1: a dry run lists both pending files in order, applies none of them, and leaves the catalog and the ledger as they were', async () => {
  await inFolder(NOTE, async (dir, filesInFolder) => {
    const fingerprintBefore = await fingerprint();
    const ledgerBefore = await ledger();
    const report = await applyMigrations({ dryRun: true, dir });
    assert.deepEqual(Object.keys(report), REPORT_KEYS);
    assert.equal(report.mode, 'dry-run');
    assert.deepEqual(report.pending, ['9001_t58_note.sql', '9002_t58_note_body.sql']);
    assert.deepEqual(report.applied, []);
    assert.equal(report.failed, null);
    assert.equal(report.error_code, null);
    assert.equal(report.files_total, filesInFolder);
    assert.equal(report.ledger_total, ledgerBefore.length);
    assert.equal(report.owner_only_findings, 0);
    assert.equal(await fingerprint(), fingerprintBefore);
    assert.deepEqual(await ledger(), ledgerBefore);
    assert.equal(await relationExists('app_private.t58_note'), false);
  });
});

test('AC-2: apply applies both pending files in order with their ledger rows, and a second apply finds nothing pending', async () => {
  await inFolder(NOTE, async (dir, filesInFolder) => {
    const ledgerBefore = await ledger();
    const first = await applyMigrations({ dryRun: false, dir });
    assert.equal(first.mode, 'apply');
    assert.deepEqual(first.pending, ['9001_t58_note.sql', '9002_t58_note_body.sql']);
    assert.deepEqual(first.applied, ['9001_t58_note.sql', '9002_t58_note_body.sql']);
    assert.equal(first.failed, null);
    assert.equal(first.error_code, null);
    assert.equal(first.files_total, filesInFolder);
    assert.equal(first.ledger_total, ledgerBefore.length + 2);
    assert.equal(first.owner_only_findings, 0);
    assert.equal(await ledgerHas('9001_t58_note.sql'), true);
    assert.equal(await ledgerHas('9002_t58_note_body.sql'), true);
    const columns = await query(
      "select column_name from information_schema.columns where table_schema = 'app_private' and table_name = 't58_note' and column_name = 'body'",
    );
    assert.equal(columns.length, 1);

    const second = await applyMigrations({ dryRun: false, dir });
    assert.deepEqual(second.pending, []);
    assert.deepEqual(second.applied, []);
    assert.equal(second.failed, null);
    assert.equal(second.error_code, null);
    assert.equal(second.ledger_total, ledgerBefore.length + 2);
  });
});

test('AC-3: an invalid middle file stops apply after the first file and keeps nothing in a dry run; the command exits 1 with a code only', async () => {
  await inFolder(THREE, async (dir, filesInFolder) => {
    const applied = await applyMigrations({ dryRun: false, dir });
    assert.equal(applied.mode, 'apply');
    assert.deepEqual(applied.pending, ['9011_t58_first.sql', '9012_t58_invalid.sql', '9013_t58_third.sql']);
    assert.equal(applied.failed, '9012_t58_invalid.sql');
    assert.equal(applied.error_code, '42601');
    assert.deepEqual(applied.applied, ['9011_t58_first.sql']);
    assert.equal(applied.files_total, filesInFolder);
    assert.equal(await relationExists('app_private.t58_first'), true);
    assert.equal(await ledgerHas('9011_t58_first.sql'), true);
    assert.equal(await ledgerHas('9012_t58_invalid.sql'), false);
    assert.equal(await ledgerHas('9013_t58_third.sql'), false);
    assert.equal(await relationExists('app_private.t58_third'), false);

    await cleanUp();

    const dry = await applyMigrations({ dryRun: true, dir });
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.failed, '9012_t58_invalid.sql');
    assert.equal(dry.error_code, '42601');
    assert.deepEqual(dry.applied, []);
    for (const table of ['app_private.t58_first', 'app_private.t58_third']) assert.equal(await relationExists(table), false);
    for (const version of Object.keys(THREE)) assert.equal(await ledgerHas(version), false);
  });

  const absent = new URL(process.env.MIGRATION_DATABASE_URL);
  absent.pathname = '/t58_absent';
  const result = runCommand(absent.toString());
  assert.equal(result.status, 1);
  assert.ok(result.stdout.endsWith('\n'));
  const lines = result.stdout.slice(0, -1).split('\n');
  assert.equal(lines.length, 1);
  const line = JSON.parse(lines[0]);
  assert.equal(typeof line, 'object');
  assert.equal(line.failed, null);
  assert.equal(line.error_code, '3D000');
  const scheme = new RegExp(['postgres', ':'].join(''), 'i');
  for (const output of [result.stdout, result.stderr]) {
    assert.equal(scheme.test(output), false);
    assert.equal(/password/i.test(output), false);
  }
});

test('AC-4: a file that opens a table to anon is refused and rolled back in both modes', async () => {
  await inFolder(OPEN, async (dir) => {
    for (const dryRun of [true, false]) {
      const report = await applyMigrations({ dryRun, dir });
      assert.equal(report.mode, dryRun ? 'dry-run' : 'apply');
      assert.equal(report.failed, '9021_t58_open_to_anon.sql');
      assert.equal(report.error_code, null);
      assert.ok(report.owner_only_findings > 0);
      assert.deepEqual(report.applied, []);
      assert.equal(await relationExists('public.t58_open'), false);
      assert.equal(await ledgerHas('9021_t58_open_to_anon.sql'), false);
      await cleanUp();
    }
  });
});

test('AC-5: the command with only the migration address set changes no user, owner or item', async () => {
  const countsBefore = await counts();
  const result = runCommand(process.env.MIGRATION_DATABASE_URL);
  assert.equal(result.status, 0);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  const line = JSON.parse(lines[0]);
  assert.equal(line.mode, 'apply');
  assert.deepEqual(line.pending, []);
  assert.deepEqual(await counts(), countsBefore);
});
