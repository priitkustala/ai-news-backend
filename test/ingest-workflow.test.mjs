// The production ingest workflow's digest step (priitkustala/ai-news-backend#55, AC-11), read as text
// (no YAML package): a step named digest directly after the step named ingest, run only when the dry
// run is off, with DIGEST_API_KEY from the secret of that name in that step's environment only, and
// the job's time limit of 20 minutes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lines = fs.readFileSync(path.join(root, '.github', 'workflows', 'ingest.yml'), 'utf8').split(/\r?\n/);

// The job's steps, each a list of its lines, from its `      - ` line to the next one.
function steps() {
  const start = lines.indexOf('    steps:');
  assert.ok(start >= 0, 'the job has steps');
  const result = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('      - ')) result.push([line]);
    else if (line.startsWith('       ') || line === '') result[result.length - 1]?.push(line);
    else break;
  }
  return result.map((step) => step.filter((line) => line !== ''));
}

// The job's own environment: the lines between `    env:` and `    steps:`.
function jobEnv() {
  const start = lines.indexOf('    env:');
  const end = lines.indexOf('    steps:');
  assert.ok(start >= 0 && end > start, 'the job has its environment before its steps');
  return lines.slice(start + 1, end);
}

const named = (step) => step[0].replace(/^      - name: /, '');

// priitkustala/ai-news-backend#69 (PG-2): one run at a time, the trigger unchanged, and the session check
// between the step connection check (before) and the step ingest, in every run, dry or not.
test('the workflow runs one at a time: a top-level concurrency block between permissions and jobs', () => {
  const at = lines.indexOf('concurrency:');
  assert.ok(at >= 0, 'a top-level concurrency block');
  assert.deepEqual(lines.slice(at, at + 3), ['concurrency:', '  group: ingest-production', '  cancel-in-progress: false']);
  assert.ok(at > lines.indexOf('permissions:') && at < lines.indexOf('jobs:'), 'between permissions and jobs');
});

// priitkustala/ai-news-backend#73 (DR-1): the workflow ingest starts by hand and once a day by itself at 04:17 UTC,
// the input dry_run still defaults to true, and the workflow is named ingest.
// priitkustala/ai-news-backend#98 (DI-1): three starts a day, at 04:17, 10:17 and 16:17 UTC, so one dropped start loses no day.
test('the triggers are workflow_dispatch with its two inputs and three daily schedule entries', () => {
  const from = lines.indexOf('on:');
  const to = lines.indexOf('permissions:');
  assert.ok(from >= 0 && to > from, 'on: comes before permissions:');
  assert.deepEqual(lines.slice(from, to).filter((line) => line !== ''), [
    'on:',
    '  workflow_dispatch:',
    '    inputs:',
    '      run_date:',
    '        type: string',
    '        required: false',
    '        description: the run date YYYY-MM-DD, empty means today in UTC',
    '      dry_run:',
    '        type: boolean',
    '        default: true',
    '        description: write nothing',
    '  schedule:',
    '    - cron: \'17 4 * * *\'',
    '    - cron: \'17 10 * * *\'',
    '    - cron: \'17 16 * * *\'',
  ]);
  assert.equal(lines.filter((line) => line.trimStart().startsWith('- cron:')).length, 3, 'exactly three schedule entries');
});

test('the input dry_run still defaults to true', () => {
  const at = lines.indexOf('      dry_run:');
  assert.ok(at >= 0, 'the input dry_run exists');
  assert.deepEqual(lines.slice(at, at + 3), ['      dry_run:', '        type: boolean', '        default: true']);
});

test('the workflow is named ingest', () => {
  assert.deepEqual(lines.filter((line) => line.startsWith('name:')), ['name: ingest']);
});

test('a step named session check comes between connection check (before) and ingest', () => {
  const names = steps().map(named);
  const at = names.indexOf('session check');
  assert.ok(at > 0, 'the step session check exists');
  assert.deepEqual(names.slice(at - 1, at + 2), ['connection check (before)', 'session check', 'ingest']);
});

test('the session check prints one of two lines, stops the job on DIFFERENT and runs in every run', () => {
  const step = steps().find((each) => each[0] === '      - name: session check');
  assert.ok(step, 'the step session check exists');
  const text = step.join('\n');
  assert.ok(text.includes('session check: SAME'));
  assert.ok(text.includes('session check: DIFFERENT'));
  assert.equal(text.split('console.log').length - 1, 1, 'exactly one console.log');
  assert.ok(text.includes('pg_backend_pid()'));
  assert.ok(text.includes('process.exit(1)'));
  assert.equal(step.some((line) => line.startsWith('        if:')), false, 'no condition: dry or not');
});

test('a step named digest comes directly after the step named ingest', () => {
  const all = steps();
  const ingest = all.findIndex((step) => step[0] === '      - name: ingest');
  assert.ok(ingest >= 0, 'the step ingest exists');
  assert.equal(named(all[ingest + 1] ?? ['']), 'digest');
});

test('the digest step runs the command only with the dry run off, its key from the secret', () => {
  const digest = steps().find((step) => step[0] === '      - name: digest');
  assert.deepEqual(digest, [
    '      - name: digest',
    '        if: ${{ github.event_name == \'schedule\' || inputs.dry_run == false }}',
    '        env:',
    '          DIGEST_API_KEY: ${{ secrets.DIGEST_API_KEY }}',
    '        run: node dist/cli.js digest',
  ]);
});

test('DIGEST_API_KEY is in no other step and not in the job\'s environment', () => {
  for (const step of steps()) {
    if (step[0] === '      - name: digest') continue;
    assert.equal(step.some((line) => line.includes('DIGEST_API_KEY')), false, `step ${step[0].trim()}`);
  }
  assert.equal(jobEnv().some((line) => line.includes('DIGEST_API_KEY')), false);
});

// priitkustala/ai-news#191: the digest step works until nothing is pending or its 15-minute budget is used.
test('the job may run 30 minutes', () => {
  assert.ok(lines.includes('    timeout-minutes: 30'));
  assert.equal(lines.some((line) => /timeout-minutes: (10|20)\b/.test(line)), false);
});
