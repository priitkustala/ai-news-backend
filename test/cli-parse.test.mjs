// The command table of the command line (priitkustala/ai-news-backend#96): each command's parse
// takes the argument list and returns its options or throws the UsageError of today with the
// message of today, and main answers an unknown command, help and a repeated --runner as before.
// The command is spawned with an empty secrets folder and a database address nothing listens on,
// so every form here ends at its usage check or before any connection. Runs after npm run build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../dist/commands.js';
import { UsageError } from '../dist/env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const parse = (name, args) => COMMANDS.get(name).parse(args);

function refuses(name, args, message) {
  assert.throws(() => parse(name, args), (error) => {
    assert.ok(error instanceof UsageError, `${name} ${args.join(' ')}: a usage error`);
    assert.equal(error.message, message);
    return true;
  });
}

function cli(args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't96-'));
  try {
    return spawnSync(process.execPath, [path.join(root, 'dist', 'cli.js'), ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        AI_NEWS_SECRETS_DIR: dir,
        DATABASE_URL: 'postgres://t96@127.0.0.1:9/t96',
        MIGRATION_DATABASE_URL: 'postgres://t96@127.0.0.1:9/t96',
        PGCONNECT_TIMEOUT: '5',
      },
      timeout: 60_000,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const INGEST_RUNNER = 'ingest takes --runner once, followed by cloud or laptop.';
const INGEST_COUNT = 'ingest takes one run date, the optional --dry-run flag and the optional --runner cloud|laptop.';
const SUMMARIES_PENDING = 'summaries-pending takes no argument or --limit N with N a positive whole number.';
const MEASURE = 'measure takes no argument or exactly --sample-dir <folder>.';
const DRAW_SAMPLE = 'draw-sample takes exactly --sources <file> --out <folder>.';
const APPLY_MIGRATIONS = 'apply-migrations takes no argument or --dry-run.';

test('AC-2 the table holds the fifteen commands of today', () => {
  assert.deepEqual([...COMMANDS.keys()].sort(), [
    'apply-migrations',
    'check-migration',
    'digest',
    'draw-sample',
    'ingest',
    'keys',
    'measure',
    'migrate',
    'notify',
    'scan-secrets',
    'seed',
    'seed-sources',
    'sign-in',
    'summaries-apply',
    'summaries-pending',
  ]);
});

test('AC-2 ingest accepts its valid forms', () => {
  assert.deepEqual(parse('ingest', ['2026-11-20']), { runDate: '2026-11-20', dryRun: false, runner: 'cloud' });
  assert.deepEqual(parse('ingest', ['2026-11-20', '--dry-run']), { runDate: '2026-11-20', dryRun: true, runner: 'cloud' });
  assert.deepEqual(parse('ingest', ['--dry-run', '2026-11-20']), { runDate: '2026-11-20', dryRun: true, runner: 'cloud' });
  assert.deepEqual(parse('ingest', ['2026-11-20', '--runner', 'laptop']), { runDate: '2026-11-20', dryRun: false, runner: 'laptop' });
  assert.deepEqual(parse('ingest', ['--runner', 'cloud', '2026-11-20', '--dry-run']), { runDate: '2026-11-20', dryRun: true, runner: 'cloud' });
  assert.deepEqual(parse('ingest', ['--dry-run', '--dry-run', '2026-11-20']), { runDate: '2026-11-20', dryRun: true, runner: 'cloud' });
});

test('AC-2 ingest refuses a bad runner value with the message of today', () => {
  refuses('ingest', ['2026-11-20', '--runner', 'elsewhere'], INGEST_RUNNER);
  refuses('ingest', ['2026-11-20', '--runner'], INGEST_RUNNER);
  refuses('ingest', ['2026-11-20', '--runner', 'Laptop'], INGEST_RUNNER);
});

test('AC-2 ingest refuses a wrong count of arguments with the message of today', () => {
  refuses('ingest', [], INGEST_COUNT);
  refuses('ingest', ['2026-11-20', '2026-11-21'], INGEST_COUNT);
  refuses('ingest', ['--dry-run'], INGEST_COUNT);
  refuses('ingest', ['--runner', 'laptop'], INGEST_COUNT);
});

test('AC-2 ingest refuses a run date that is not a calendar date with the message of today', () => {
  for (const value of ['2026-02-30', '20261120']) {
    refuses('ingest', [value], `The run date must be a calendar date as YYYY-MM-DD (got ${JSON.stringify(value)}).`);
  }
});

test('AC-2 summaries-pending accepts its valid forms', () => {
  assert.deepEqual(parse('summaries-pending', []), { limit: undefined });
  assert.deepEqual(parse('summaries-pending', ['--limit', '1']), { limit: 1 });
  assert.deepEqual(parse('summaries-pending', ['--limit', '30']), { limit: 30 });
});

test('AC-2 summaries-pending refuses every other form with the message of today', () => {
  for (const args of [
    ['--limit'],
    ['--limit', '0'],
    ['--limit', '-1'],
    ['--limit', '1.5'],
    ['--limit', 'abc'],
    ['--limit', '99999999999999999999'],
    ['--limit', '1', '2'],
    ['10'],
  ]) {
    refuses('summaries-pending', args, SUMMARIES_PENDING);
  }
});

test('AC-2 measure accepts its valid forms', () => {
  assert.deepEqual(parse('measure', []), { folder: undefined });
  assert.deepEqual(parse('measure', ['--sample-dir', 'x']), { folder: 'x' });
});

test('AC-2 measure refuses every other form with the message of today', () => {
  for (const args of [['--sample-dir'], ['x'], ['--sample', 'x'], ['--sample-dir', 'x', 'y']]) {
    refuses('measure', args, MEASURE);
  }
});

test('AC-2 draw-sample accepts its valid forms', () => {
  assert.deepEqual(parse('draw-sample', ['--sources', 's.json', '--out', 'o']), { sources: 's.json', out: 'o' });
  assert.deepEqual(parse('draw-sample', ['--out', 'o', '--sources', 's.json']), { sources: 's.json', out: 'o' });
});

test('AC-2 draw-sample refuses every other form with the message of today', () => {
  for (const args of [
    [],
    ['--sources', 's.json'],
    ['--sources', 's.json', '--out'],
    ['--sources', 'a', '--sources', 'b'],
    ['--out', 'a', '--out', 'b'],
    ['--sources', 's.json', '--out', 'o', 'x'],
  ]) {
    refuses('draw-sample', args, DRAW_SAMPLE);
  }
});

test('AC-2 apply-migrations accepts its valid forms', () => {
  assert.deepEqual(parse('apply-migrations', []), { dryRun: false });
  assert.deepEqual(parse('apply-migrations', ['--dry-run']), { dryRun: true });
});

test('AC-2 apply-migrations refuses every other form with the message of today', () => {
  for (const args of [['--dry'], ['--dry-run', '--dry-run'], ['x']]) {
    refuses('apply-migrations', args, APPLY_MIGRATIONS);
  }
});

test('AC-3 an unknown command exits 2 with the message of today', () => {
  for (const name of ['nosuchcommand', 'constructor', 'toString', '__proto__']) {
    const result = cli([name]);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stderr.split('\n')[0], `usage: Unknown command ${name}.`);
    assert.equal(result.stdout, '');
  }
});

test('AC-3 help prints the usage text with exit 0', () => {
  const results = [[], ['--help'], ['-h'], ['help']].map(cli);
  for (const result of results) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, results[0].stdout);
  }
  assert.equal(results[0].stdout.split('\n')[0], 'Usage: node dist/cli.js <command> [arguments]');
});

test('AC-5 ingest with --runner twice exits 2 with the message of today', () => {
  refuses('ingest', ['2026-11-20', '--runner', 'laptop', '--runner', 'laptop'], INGEST_RUNNER);
  refuses('ingest', ['2026-11-20', '--runner', 'laptop', '--runner', 'cloud'], INGEST_RUNNER);
  const result = cli(['ingest', '2026-11-20', '--runner', 'laptop', '--runner', 'laptop']);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stderr.split('\n').filter((line) => line !== '').at(-1), `usage: ${INGEST_RUNNER}`);
});
