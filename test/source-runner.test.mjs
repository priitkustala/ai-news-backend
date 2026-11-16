// The runner of a source and of an ingest run (priitkustala/ai-news-backend#86, LI-1): readSources
// (src/measure/draw.ts, shared by seed-sources and draw-sample) reads an entry's optional runner,
// cloud when absent, and refuses any value but cloud or laptop with a usage error; the ingest
// command takes --runner cloud|laptop and refuses any other form with exit 2 before any
// connection. The command is spawned with an empty secrets folder and a database address nothing
// listens on, so a start that got past its usage check would fail its connection with exit 1.
// Runs after npm run build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources } from '../dist/measure/draw.js';
import { UsageError } from '../dist/env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function withSources(entries, work) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't86-'));
  try {
    const file = path.join(dir, 'sources.json');
    fs.writeFileSync(file, JSON.stringify({ sources: entries }));
    return work(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const entry = (id, extra = {}) => ({ id, feed_url: `http://example.invalid/${id}.xml`, ...extra });

test('readSources gives cloud when an entry has no runner and laptop when it says so', () => {
  const { sources } = withSources([entry('a'), entry('b', { runner: 'laptop' }), entry('c', { runner: 'cloud' })], readSources);
  assert.deepEqual(sources.map((s) => [s.id, s.runner]), [['a', 'cloud'], ['b', 'laptop'], ['c', 'cloud']]);
});

for (const runner of ['elsewhere', 'Laptop', '', 1, null]) {
  test(`readSources refuses the runner ${JSON.stringify(runner)} with a usage error`, () => {
    assert.throws(() => withSources([entry('a'), entry('b', { runner })], readSources), (error) => {
      assert.ok(error instanceof UsageError, 'a usage error');
      assert.match(error.message, /runner/);
      return true;
    });
  });
}

function cli(args) {
  const secrets = fs.mkdtempSync(path.join(os.tmpdir(), 't86-env-'));
  try {
    return spawnSync(process.execPath, [path.join(root, 'dist', 'cli.js'), ...args], {
      cwd: secrets,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, AI_NEWS_SECRETS_DIR: secrets, DATABASE_URL: 'postgres://t86@127.0.0.1:9/t86', PGCONNECT_TIMEOUT: '5' },
      timeout: 60_000,
    });
  } finally {
    fs.rmSync(secrets, { recursive: true, force: true });
  }
}

for (const args of [
  ['--runner', 'elsewhere'],
  ['--runner'],
  ['--runner', 'laptop', '--runner', 'cloud'],
  ['--runner', 'laptop', '--runner', 'laptop'],
  ['--dry-run', '--runner', 'elsewhere'],
]) {
  test(`ingest 2026-11-20 ${args.join(' ')} is a usage error with exit 2 before any connection`, () => {
    const result = cli(['ingest', '2026-11-20', ...args]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /^usage: .*runner/m);
  });
}

test('ingest 2026-11-20 --runner laptop passes the usage check and then needs its connection (exit 1)', () => {
  const result = cli(['ingest', '2026-11-20', '--runner', 'laptop']);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /^error: /m);
});

test('the usage names the runner of ingest', () => {
  const result = cli(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ingest <run-date> \[--dry-run\] \[--runner cloud\|laptop\]/);
});
