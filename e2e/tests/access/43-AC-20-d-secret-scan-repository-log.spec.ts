// AC-20d (script, @surface-job, project api): story 43, coverage.md row AC-20 d.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-20; the Given/When/Then is the owning story's row AC-20d.
// Given the ai-news-backend repository and a captured log of a local job run, when the repository scan runs
// over both, then it finds no string matching the seeded database password, secret key or Reddit secret.
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { repositoryRoot, runDateToday, runMarker } from '../../support/env';
import { ingest, scanSecrets, seed } from '../../support/job';

test(
  'AC-20d: the repository scan finds no seeded secret in the backend repository or a job log',
  { tag: ['@journey-access', '@surface-job', '@story-43'] },
  async ({}, testInfo) => {
    // Given: the ai-news-backend repository and a captured log of a local job run
    const run = runMarker();
    seed('AC-20d', run);
    const job = ingest(runDateToday());
    const log = testInfo.outputPath('job-run.log');
    writeFileSync(log, job.log, 'utf8');
    const repository = repositoryRoot();

    // When: the repository scan runs over both
    const scan = scanSecrets([repository, log]);

    // Then: it scanned both and finds no string matching the seeded database password,
    // secret key or Reddit secret
    expect(scan.exitCode, scan.stderr).toBe(0);
    for (const target of [repository, log]) {
      const entry = (scan.report?.scanned ?? []).find((s) => path.resolve(s.path) === path.resolve(target));
      expect(entry?.files ?? 0, `scanned ${target}`).toBeGreaterThan(0);
    }
    expect(scan.report?.secret_matches).toBe(0);
  },
);
