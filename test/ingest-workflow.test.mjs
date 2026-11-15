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
    '        if: ${{ inputs.dry_run == false }}',
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

test('the job may run 20 minutes', () => {
  assert.ok(lines.includes('    timeout-minutes: 20'));
  assert.equal(lines.some((line) => /timeout-minutes: 10\b/.test(line)), false);
});
