// AC-07a (scenario, @surface-job, project api): story 3, coverage.md row AC-07 a.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-07; the Given/When/Then is the owning story's row AC-07a.
// Given two fixture items with the same canonical URL after removing utm_* parameters, when the run
// completes, then the feed view returns one representative per pair and no two items share a canonical URL.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf } from '../../support/data';

test(
  'AC-07a: two items with the same canonical URL after utm removal give one representative',
  { tag: ['@journey-ingest', '@surface-job', '@story-3'] },
  async ({ request }) => {
    // Given: two fixture items (<run>-same-url) whose addresses differ only in utm_* parameters
    const run = runMarker();
    seed('AC-07a', run);
    const owner = signIn('owner');

    // When: the run completes
    const result = ingest(runDateToday());
    expect(result.report?.status, 'prerequisite (1, the run report): the run completes').toMatch(/^(completed|partial)$/);

    // Then: one representative for the pair, and no two feed items share a canonical URL
    const feed = expectRows(await readRelation(request, 'feed', owner), 'Then');
    expect(feed.filter((row) => titleOf(row).includes(`${run}-same-url`))).toHaveLength(1);
    const urls = feed.map((row) => String(row.canonical_url));
    expect(new Set(urls).size).toBe(urls.length);
  },
);
