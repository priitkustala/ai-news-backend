// AC-22a (scenario, @surface-job, project api): story 5, coverage.md row AC-22 a.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-22; the Given/When/Then is the owning story's row AC-22a.
// Given seeded unbookmarked items older than the window, when a run completes, then the old unbookmarked
// items are gone. CONDITIONAL on OD-20 (the window).
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf } from '../../support/data';

test(
  'AC-22a: unbookmarked items older than the retention window are gone after a run',
  { tag: ['@journey-ingest', '@surface-job', '@story-5'] },
  async ({ request }) => {
    // Given: seeded unbookmarked items (<run>-old) older than the retention window (OD-20)
    const run = runMarker();
    seed('AC-22a', run);
    const owner = signIn('owner');
    const before = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads items');
    expect(before.filter((row) => titleOf(row).includes(`${run}-old`)).length, 'prerequisite: the old items are stored').toBeGreaterThan(0);

    // When: a run completes
    const result = ingest(runDateToday());

    // Then: the old unbookmarked items are gone
    expect(result.report?.status, 'prerequisite (1, the run report): the run completes').toBe('completed');
    const items = expectRows(await readRelation(request, 'items', owner), 'Then');
    expect(items.filter((row) => titleOf(row).includes(`${run}-old`))).toHaveLength(0);
  },
);
