// AC-05 (scenario, @surface-job, project api): story 2, coverage.md row AC-05 -.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-05; the Given/When/Then is the owning story's row AC-05.
// Given fixture items that match each category's rules and one that matches none, when the run completes,
// then each item carries exactly one category from the five, the unmatched item is in Other, and the
// categories view lists the five categories with counts.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf } from '../../support/data';

const FIVE = ['releases', 'research', 'policy', 'business', 'other'];

test(
  'AC-05: each item carries one of the five categories and the unmatched item is in Other',
  { tag: ['@journey-ingest', '@surface-job', '@story-2'] },
  async ({ request }) => {
    // Given: fixture items that match each category's rules and one (<run>-unmatched) that matches none
    const run = runMarker();
    seed('AC-05', run);
    const owner = signIn('owner');

    // When: the run completes
    const result = ingest(runDateToday());
    expect(result.report?.status, 'prerequisite (1, the run report): the run completes').toMatch(/^(completed|partial)$/);

    // Then: each item has one of the five categories, the unmatched item is in Other,
    // and the categories view lists the five categories with counts
    const items = expectRows(await readRelation(request, 'items', owner), 'Then: the items');
    const mine = items.filter((row) => titleOf(row).includes(run));
    expect(mine.length).toBeGreaterThan(FIVE.length);
    for (const row of mine) expect(FIVE).toContain(row.category);
    expect(mine.find((row) => titleOf(row).includes(`${run}-unmatched`))?.category).toBe('other');
    const categories = expectRows(await readRelation(request, 'categories', owner), 'Then: the categories view');
    expect(categories.map((row) => row.id).sort()).toEqual([...FIVE].sort());
    for (const row of categories) expect(typeof row.item_count).toBe('number');
  },
);
