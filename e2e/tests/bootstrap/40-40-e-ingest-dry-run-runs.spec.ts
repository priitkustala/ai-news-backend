// 40e (bootstrap, @surface-job, project api): the environment bootstrap story (#40), coverage.md row 40 e.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// section Local test environment (bootstrap checks).
// Given the seeded synthetic database, when the job command is started with a run date and the dry-run flag,
// then it runs.
import { test, expect } from '@playwright/test';
import { runDateToday } from '../../support/env';
import { ingest } from '../../support/job';

test(
  '40e: the ingest command runs with --dry-run against the local database',
  { tag: ['@journey-bootstrap', '@surface-job', '@story-40'] },
  async ({}) => {
    // Given: the seeded synthetic database
    // When: the job command is started with a run date and the dry-run flag
    const result = ingest(runDateToday(), { dryRun: true });

    // Then: the ingest command runs with --dry-run against the local database
    expect(result.exitCode, result.stderr).toBe(0);
  },
);
