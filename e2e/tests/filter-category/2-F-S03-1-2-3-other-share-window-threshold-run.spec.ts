// F-S03-1, F-S03-2, F-S03-3 (scenario, @surface-data, project api): story 2, repair round 2 of
// AC-06, from the findings of Astra's round 1 report (evaluations/ai-news-app/S-03/round-01/S-03.md).
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-06 and behaviour B-06 (the job computes the Other share per run); the window and the
// denominator follow OD-15 (representative items, 7 days rolling, ending at the run). AC-06's own
// row is unchanged; these rows reproduce the findings through the categories view.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf, type Row } from '../../support/data';
import type { APIRequestContext } from '@playwright/test';

const FIVE = ['releases', 'research', 'policy', 'business', 'other'];
const TAGS = ['@journey-filter-category', '@surface-data', '@story-2'];

async function otherRow(request: APIRequestContext, owner: string): Promise<{ categories: Row[]; other: Row | undefined }> {
  const categories = expectRows(await readRelation(request, 'categories', owner), 'prerequisite: the categories view is in the exposed schema');
  const other = categories.find((row) => row.id === 'other');
  expect(other, 'prerequisite: the categories view lists Other').toBeDefined();
  expect(Object.keys(other ?? {}), 'prerequisite: the view exposes the Other share and the notice').toEqual(
    expect.arrayContaining(['other_share', 'over_threshold']),
  );
  return { categories, other };
}

const shareOf = (other: Row | undefined) => ({ other_share: Number(other?.other_share), over_threshold: other?.over_threshold });

const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 24 * 3600 * 1000).toISOString().slice(0, 10);

test(
  'F-S03-1: future-dated and expired items stay outside the window; the Other share stays 0.4 with the notice',
  { tag: TAGS },
  async ({ request }) => {
    // Given: ten representatives in the window, four in Other (one in the window by its fetch
    // time), plus future-dated Other and non-Other items and expired ones
    const run = runMarker();
    seed('F-S03-1', run);
    const owner = signIn('owner');

    // When: the owner reads the categories view
    const { categories, other } = await otherRow(request, owner);

    // Then: the share is 4 of 10 and the notice is shown; the category list is unchanged
    expect(Number(other?.other_share), 'F-S03-1: items dated after the end of the window are not counted').toBeCloseTo(0.4, 5);
    expect(other?.over_threshold).toBe(true);
    expect(categories.map((row) => row.id).sort()).toEqual([...FIVE].sort());
  },
);

test(
  'F-S03-2a: exactly 30 percent Other (3 of 10) shows no notice',
  { tag: TAGS },
  async ({ request }) => {
    // Given: a window of 10 representatives, 3 in Other
    const run = runMarker();
    seed('F-S03-2-exact', run);
    const owner = signIn('owner');

    // When: the owner reads the categories view
    const { other } = await otherRow(request, owner);

    // Then: the share is 0.3 and the notice is not shown (the threshold is "above 30 percent")
    expect(Number(other?.other_share)).toBeCloseTo(0.3, 5);
    expect(other?.over_threshold).toBe(false);
  },
);

test(
  'F-S03-2b: a share above 30 percent by less than the display rounding (1,000 of 3,333) shows the notice',
  { tag: TAGS },
  async ({ request }) => {
    test.setTimeout(120_000);
    // Given: a window of 3,333 representatives, 1,000 in Other (0.30003, shown as 0.3000)
    const run = runMarker();
    seed('F-S03-2-above', run);
    const owner = signIn('owner');

    // When: the owner reads the categories view
    const { other } = await otherRow(request, owner);

    // Then: the notice is shown; the displayed share is rounded separately
    expect(Number(other?.other_share)).toBeCloseTo(0.3, 4);
    expect(other?.over_threshold, 'F-S03-2: the notice compares the unrounded share with 0.30').toBe(true);
  },
);

test(
  'F-S03-2c: a share below 30 percent (999 of 3,333) shows no notice',
  { tag: TAGS },
  async ({ request }) => {
    test.setTimeout(120_000);
    // Given: a window of 3,333 representatives, 999 in Other
    const run = runMarker();
    seed('F-S03-2-below', run);
    const owner = signIn('owner');

    // When: the owner reads the categories view
    const { other } = await otherRow(request, owner);

    // Then: the notice is not shown
    expect(other?.over_threshold).toBe(false);
  },
);

test(
  'F-S03-3: the Other share is the one stored by the latest run: stable between reads, changed by the next run',
  { tag: TAGS },
  async ({ request }) => {
    test.setTimeout(180_000);
    // Given: AC-06's window plus one Other item that leaves the window 40 seconds after the
    // seed, and one completed run (of yesterday's run date)
    const run = runMarker();
    const manifest = seed('F-S03-3', run);
    const owner = signIn('owner');
    const today = runDateToday();
    const first = ingest(dayBefore(today));
    expect(first.report?.status, 'prerequisite (1, the run report): the run completes').toMatch(/^(completed|partial)$/);

    // When: the owner reads the categories view, again after the item has left the window
    // (a different now, no run in between), and after the next run
    const afterRun = shareOf((await otherRow(request, owner)).other);
    const leavesAt = Date.parse(String(manifest.leaves_window_at));
    expect(Number.isNaN(leavesAt), 'prerequisite: the manifest names when the item leaves the window').toBe(false);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, leavesAt - Date.now()) + 2_000));
    const items = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the items');
    expect(items.some((row) => titleOf(row).includes(`${run}-leaving`)), 'prerequisite: the item is still stored').toBe(true);
    const readLater = shareOf((await otherRow(request, owner)).other);

    // Then: the value is the run's: the same on both reads
    expect(readLater, 'F-S03-3: the share does not change between runs').toEqual(afterRun);

    const second = ingest(today);
    expect(second.report?.status, 'prerequisite (1, the run report): the next run completes').toMatch(/^(completed|partial)$/);
    const afterNextRun = shareOf((await otherRow(request, owner)).other);
    // ... and the next run computes it again over its own window, without the item that left
    expect(afterNextRun, 'F-S03-3: the next run stores a new share').not.toEqual(afterRun);
  },
);
