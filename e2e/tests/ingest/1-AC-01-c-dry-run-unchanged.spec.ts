// AC-01c (scenario, @surface-job, project api): story 1, coverage.md row AC-01 c.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-01; the Given/When/Then is the owning story's row AC-01c.
// Given --dry-run, when the job runs against the seeded local database, then it fetches and processes the
// fixture feeds and the database is unchanged.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  'AC-01c: a dry run fetches and processes the fixture feeds and leaves the database unchanged',
  { tag: ['@journey-ingest', '@surface-job', '@story-1'] },
  async ({ request }) => {
    // Given: the seeded local database and the --dry-run flag
    const run = runMarker();
    seed('AC-01c', run);
    const owner = signIn('owner');
    const itemsBefore = expectRows(await readRelation(request, 'items', owner), 'the items before the dry run');
    const runsBefore = expectRows(await readRelation(request, 'ingestion_runs', owner), 'the runs before the dry run');

    // When: the job runs against the seeded local database
    const dry = ingest(runDateToday(), { dryRun: true });

    // Then: it fetches and processes the fixture feeds and the database is unchanged
    expect(dry.exitCode, dry.stderr).toBe(0);
    expect(dry.report?.dry_run).toBe(true);
    expect(dry.report?.fetched_count ?? 0).toBeGreaterThan(0);
    expect(dry.report?.processed_count ?? 0).toBeGreaterThan(0);
    expect(expectRows(await readRelation(request, 'items', owner), 'Then: the items')).toEqual(itemsBefore);
    expect(expectRows(await readRelation(request, 'ingestion_runs', owner), 'Then: the runs')).toEqual(runsBefore);
  },
);
