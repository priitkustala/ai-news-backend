// AC-07b (scenario, @surface-job, project api): story 3, coverage.md row AC-07 b.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-07; the Given/When/Then is the owning story's row AC-07b.
// Given two items with near-identical titles from different sources within 48 hours, when the run completes,
// then the feed view returns one representative per pair.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf } from '../../support/data';

test(
  'AC-07b: two near-identical titles from different sources within 48 hours give one representative',
  { tag: ['@journey-ingest', '@surface-job', '@story-3'] },
  async ({ request }) => {
    // Given: two items from different sources within 48 hours whose titles (<run>-near-title)
    // are near-identical after normalisation
    const run = runMarker();
    seed('AC-07b', run);
    const owner = signIn('owner');

    // When: the run completes
    const result = ingest(runDateToday());
    expect(result.report?.status, 'prerequisite (1, the run report): the run completes').toMatch(/^(completed|partial)$/);

    // Then: the feed view returns one representative for the pair
    const feed = expectRows(await readRelation(request, 'feed', owner), 'Then');
    expect(feed.filter((row) => titleOf(row).includes(`${run}-near-title`))).toHaveLength(1);
  },
);
