// AC-06 (scenario, @surface-data, project api): story 2, coverage.md row AC-06 -.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-06; the Given/When/Then is the owning story's row AC-06.
// Given a seeded window in which Other holds 4 of 10 representative items, when the owner reads the
// categories view, then it reports an Other share of 0.4 and an over-threshold notice, and the category list
// is unchanged. CONDITIONAL: window and denominator follow OD-15.
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

const FIVE = ['releases', 'research', 'policy', 'business', 'other'];

test(
  'AC-06: the categories view reports an Other share of 0.4 with the over-threshold notice',
  { tag: ['@journey-filter-category', '@surface-data', '@story-2'] },
  async ({ request }) => {
    // Given: a seeded window in which Other holds 4 of 10 representative items (OD-15 sets
    // the window and the denominator; the fixture set follows the decided rule)
    const run = runMarker();
    seed('AC-06', run);
    const owner = signIn('owner');

    // When: the owner reads the categories view
    const categories = expectRows(await readRelation(request, 'categories', owner), 'prerequisite: the categories view is in the exposed schema');
    const other = categories.find((row) => row.id === 'other');
    expect(other, 'prerequisite: the categories view lists Other').toBeDefined();

    // First unmet step (2, its migration for the categories view: counts and the Other
    // share): the view exposes other_share and over_threshold. Whether the bootstrap view of
    // #40 may already carry that projection is the boundary pending the owner's ruling
    // (pull-requests.md, Conflicts for the orchestrator, C-3): a bootstrap view that computes
    // the Other share over the seeded window would pass here, so this row is not established
    // feature-red evidence until the owner rules; no column is added to make it red
    expect(Object.keys(other ?? {}), 'first unmet step (2; the bootstrap boundary is pending the owner\'s ruling, C-3): the view exposes the Other share and the notice').toEqual(
      expect.arrayContaining(['other_share', 'over_threshold']),
    );

    // Then: an Other share of 0.4 and an over-threshold notice; the category list is unchanged
    expect(Number(other?.other_share)).toBeCloseTo(0.4, 5);
    expect(other?.over_threshold).toBe(true);
    expect(categories.map((row) => row.id).sort()).toEqual([...FIVE].sort());
  },
);
