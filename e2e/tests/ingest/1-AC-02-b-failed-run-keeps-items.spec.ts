// AC-02b (scenario, @surface-job, project api): story 1, coverage.md row AC-02 b.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-02; the Given/When/Then is the owning story's row AC-02b.
// Given every fixture feed failing, when the run ends, then the status is failed and the feed view still
// returns the items stored before.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  'AC-02b: a run with every feed failing ends failed and the feed view still returns the stored items',
  { tag: ['@journey-ingest', '@surface-job', '@story-1'] },
  async ({ request }) => {
    // Given: items stored before and every fixture feed failing
    const run = runMarker();
    seed('AC-02b', run);
    const owner = signIn('owner');
    const before = expectRows(await readRelation(request, 'feed', owner), 'the feed before the run');

    // When: the run ends
    const result = ingest(runDateToday());

    // Then: the status is failed and the feed view still returns the items stored before
    expect(result.report?.status).toBe('failed');
    const after = expectRows(await readRelation(request, 'feed', owner), 'Then');
    expect(before.length).toBeGreaterThan(0);
    expect(after.map((row) => row.id)).toEqual(expect.arrayContaining(before.map((row) => row.id)));
  },
);
