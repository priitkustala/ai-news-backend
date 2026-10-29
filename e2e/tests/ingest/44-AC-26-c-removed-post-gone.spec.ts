// AC-26c (scenario, @surface-job, project api): story 44, coverage.md row AC-26 c.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-26; the Given/When/Then is the owning story's row AC-26c.
// Given the admitted post is absent from the listing of a later run and marked removed, when that run
// completes, then the item is gone from the feed view.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf } from '../../support/data';

test(
  'AC-26c: a Reddit post absent from a later listing and marked removed is gone from the feed view',
  { tag: ['@journey-ingest', '@surface-job', '@story-44'] },
  async ({ request }) => {
    // Given: the admitted post (<run>-reddit-admitted) stored by an earlier run, absent from
    // this run's fixture listing and marked removed; test Reddit credentials set
    const run = runMarker();
    seed('AC-26c', run);
    const owner = signIn('owner');
    const before = expectRows(await readRelation(request, 'feed', owner), 'prerequisite: the owner reads the feed view');
    expect(before.filter((row) => titleOf(row).includes(`${run}-reddit-admitted`)), 'prerequisite: the post is in the feed view').toHaveLength(1);

    // When: that run completes
    const result = ingest(runDateToday());

    // Then: the item is gone from the feed view
    expect(result.report?.status, 'prerequisite (1, the run report): the run completes').toMatch(/^(completed|partial)$/);
    const feed = expectRows(await readRelation(request, 'feed', owner), 'Then');
    expect(feed.filter((row) => titleOf(row).includes(`${run}-reddit-admitted`))).toHaveLength(0);
  },
);
