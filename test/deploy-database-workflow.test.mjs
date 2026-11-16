// The production database deployment workflow (priitkustala/ai-news-backend#80, MD-2b), read as text
// (no YAML package), in the form of ingest-workflow.test.mjs: started only by hand with a dry run by
// default; with the dry run off an encrypted backup first, then the migrations, the after-reading and
// the source list, each step only after every step before it passed; and the rollback rule in AGENTS.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-database.yml'), 'utf8');
const lines = text.split(/\r?\n/);
const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8').split(/\r?\n/);

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

// The job variable that holds the environment secret, read from its own line (no test names it).
const db = lines.flatMap((l) => l.match(/^      ([A-Z][A-Z0-9_]+): \$\{\{ secrets\.\1 \}\}$/)?.[1] ?? [])[0];
const nameOf = (step) => step.map((line) => line.match(/^      [- ] name: (.+)$/)?.[1]).find(Boolean);
const afterBuild = () => {
  const all = steps();
  const build = all.findIndex((step) => step[0] === '      - run: npm run build');
  assert.ok(build >= 0, 'the build step is there');
  return all.slice(build + 1);
};
const named = (name) => afterBuild().find((step) => nameOf(step) === name);
const notDry = "        if: env.DRY_RUN != 'true'";

test('the only trigger is the start by hand, with a dry run by default', () => {
  const on = lines.indexOf('on:');
  const end = lines.indexOf('permissions:');
  assert.ok(on >= 0 && end > on, 'on: comes before permissions:');
  assert.deepEqual(lines.slice(on + 1, end).filter((line) => line !== ''), [
    '  workflow_dispatch:',
    '    inputs:',
    '      dry_run:',
    lines.slice(on + 1, end).find((line) => line.startsWith('        description: ')),
    '        type: boolean',
    '        default: true',
  ]);
  assert.equal(lines.filter((line) => /^\s*(push|pull_request|schedule|paths):/.test(line)).length, 0);
});

test('the job runs in production with DRY_RUN from the input, one secret and one variable', () => {
  assert.ok(lines.includes('    environment: production'));
  assert.ok(lines.includes('      DRY_RUN: ${{ inputs.dry_run }}'));
  assert.equal(text.split('${{ secrets').length - 1, 1, 'one secret reference');
  assert.equal(text.split('${{ vars.').length - 1, 1, 'one variable reference');
  assert.ok(named('dump').includes('          DUMP_PUBLIC_KEY: ${{ vars.DUMP_PUBLIC_KEY }}'), 'the variable is on the step dump');
});

test('after the build the named steps are dump, dry run, apply, after, sources, the upload right after dump', () => {
  const after = afterBuild();
  assert.deepEqual(after.map(nameOf).filter(Boolean), ['dump', 'dry run', 'apply', 'after', 'sources']);
  const upload = after[after.findIndex((step) => nameOf(step) === 'dump') + 1];
  assert.match(upload.join('\n'), /uses: actions\/upload-artifact@[0-9a-f]{40} # v\d/);
  assert.ok(upload.includes(notDry.replace('        if:', '      - if:')), 'the upload runs only with the dry run off');
  assert.ok(upload.includes('          retention-days: 30'));
  assert.ok(upload.includes('          name: database-dump-${{ github.run_id }}'));
});

test('dump, apply and sources run only with the dry run off; dry run and after always', () => {
  for (const name of ['dump', 'apply', 'sources']) assert.ok(named(name).includes(notDry), `${name} runs only with the dry run off`);
  for (const name of ['dry run', 'after']) assert.ok(!named(name).some((line) => line.trim().startsWith('if:')), `${name} has no condition`);
  assert.ok(named('dry run').includes('        run: node dist/cli.js apply-migrations --dry-run'));
  assert.ok(named('apply').includes('        run: node dist/cli.js apply-migrations'));
  assert.ok(named('after').join('\n').includes('node dist/cli.js apply-migrations --dry-run | tee after.json'));
  assert.match(named('after').join('\n'), /r\.owner_only_findings !== 0 \|\| \(process\.env\.DRY_RUN !== "true" && r\.pending\.length !== 0\)/);
  assert.ok(named('sources').includes('        run: node dist/cli.js seed-sources config/sources.json'));
});

test('dump refuses an empty key first and pipes the dump straight into gpg', () => {
  const run = named('dump');
  const first = run[run.indexOf('        run: |') + 1];
  assert.match(first, /^          test -n "\$DUMP_PUBLIC_KEY" \|\| /);
  const body = run.join('\n');
  assert.ok(db, 'the job reads one environment secret');
  assert.ok(body.includes(`pg_dump" --schema=public --schema=app_private --no-owner "$${db}" \\\n            | gpg --batch `), 'pg_dump is piped into gpg');
  assert.match(body, /--recipient-file dump-key\.asc --output "database-dump-\$GITHUB_RUN_ID\.gpg" --encrypt/);
});

test('no step runs after a failure: no continue-on-error, no always()', () => {
  assert.equal(text.includes('continue-on-error'), false);
  assert.equal(text.includes('always()'), false);
  assert.equal(text.includes('current_user'), false);
});

test('AGENTS.md carries the apply-migrations row and the rollback rule', () => {
  assert.equal(agents.filter((line) => line === '## Rollback').length, 1);
  assert.ok(agents.some((line) => line.startsWith('| Apply only the pending migrations') && line.includes('`node dist/cli.js apply-migrations [--dry-run]`')));
  const start = agents.indexOf('## Rollback');
  const end = agents.findIndex((line, i) => i > start && line.startsWith('## '));
  assert.ok(agents.slice(start, end).some((line) => line.includes('never by an agent')));
});

// The lines of a step's run block: the value after `run:`, or the lines of a `run: |` block without their indent.
const runBlock = (step) => {
  const at = step.findIndex((line) => /^      [- ] run: /.test(line));
  if (at < 0) return [];
  const value = step[at].replace(/^      [- ] run: /, '');
  return value === '|' ? step.slice(at + 1).map((line) => line.replace(/^ {10}/, '')) : [value];
};
const explicitBash = '        shell: bash';

test('dump and after run under explicit bash, as does every step with a pipe in its run block', () => {
  for (const name of ['dump', 'after']) assert.ok(named(name).includes(explicitBash), `${name} carries shell: bash`);
  for (const step of steps()) {
    if (runBlock(step).some((line) => line.includes('|'))) assert.ok(step.includes(explicitBash), `${step[0].trim()} has a pipe and carries shell: bash`);
  }
});

test('a failed pg_dump fails the step dump even when gpg succeeds (offline, stubs only)', async () => {
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-dump-'));
  try {
    const bin = path.join(tmp, 'bin');
    const stub = (file, body) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    };
    stub(path.join(bin, 'psql'), 'echo 170004');
    stub(path.join(bin, 'sudo'), 'exit 0');
    stub(path.join(bin, 'gpg'), 'out=\nwhile [ $# -gt 0 ]; do if [ "$1" = --output ]; then out=$2; fi; shift; done\ncat > "$out"');
    // The block calls pg_dump by its full path; only the literal prefix /usr/lib/postgresql is replaced, by the temporary folder.
    const pg = path.join(tmp, 'postgresql');
    stub(path.join(pg, '17', 'bin', 'pg_dump'), 'if [ "$1" = --version ]; then echo "pg_dump (PostgreSQL) 17.4"; exit 0; fi\necho "some dump bytes"\nexit "$PG_DUMP_EXIT"');
    const block = runBlock(named('dump')).join('\n').split('/usr/lib/postgresql').join(pg);
    const script = path.join(tmp, 'dump.sh');
    fs.writeFileSync(script, `${block}\n`);
    // GitHub Actions runs an explicit `shell: bash` as `bash --noprofile --norc -eo pipefail {0}`, a step with no shell as `bash -e {0}`.
    const actions = named('dump').includes(explicitBash) ? ['--noprofile', '--norc', '-eo', 'pipefail'] : ['-e'];
    const run = (flags, exit) => {
      const output = path.join(tmp, 'database-dump-4242.gpg');
      fs.rmSync(output, { force: true });
      const env = { PATH: `${bin}:${process.env.PATH}`, HOME: tmp, DUMP_PUBLIC_KEY: 'test-key', [db]: 'test-database', GITHUB_RUN_ID: '4242', PG_DUMP_EXIT: String(exit) };
      const result = spawnSync('bash', [...flags, script], { cwd: tmp, env, encoding: 'utf8' });
      return { status: result.status, written: fs.existsSync(output) };
    };
    const ok = run(actions, 0);
    assert.equal(ok.status, 0, 'a good dump passes');
    assert.ok(ok.written, 'the encrypted file is written');
    assert.notEqual(run(actions, 1).status, 0, 'a failed pg_dump fails the step');
    assert.equal(run(['-e'], 1).status, 0, 'without pipefail the failed pg_dump is masked by gpg');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
