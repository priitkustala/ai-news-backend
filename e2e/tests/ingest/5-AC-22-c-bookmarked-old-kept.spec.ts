// AC-22c (scenario, @surface-job, project api): story 5, coverage.md row AC-22 c.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-22; the Given/When/Then is the owning story's row AC-22c.
// Given one bookmarked old item, when a run completes, then the bookmarked item remains.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { bookmarkFor, expectRows, readRelation, signIn, titleOf, writeRelation } from '../../support/data';

test(
  'AC-22c: a bookmarked item older than the retention window remains after a run',
  { tag: ['@journey-ingest', '@surface-job', '@story-5'] },
  async ({ request }) => {
    // Given: one old item (<run>-bookmarked-old), bookmarked with the write the client makes
    // (an insert into bookmarks with the owner's session), the bookmark read back before the
    // run; beside it an unbookmarked old item (<run>-old) that the same run must remove, so
    // the retention pass is shown to have run (round 19 F3)
    const run = runMarker();
    seed('AC-22c', run);
    const owner = signIn('owner');
    const items = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads items');
    const old = items.find((row) => titleOf(row).includes(`${run}-bookmarked-old`));
    expect(old, 'prerequisite: the seeded old item').toBeDefined();
    expect(items.filter((row) => titleOf(row).includes(`${run}-old`)).length, 'prerequisite: the unbookmarked old item').toBeGreaterThan(0);
    const insert = await writeRelation(request, 'bookmarks', 'POST', bookmarkFor(old ?? {}), owner);
    expect(insert.status, `prerequisite: the owner's bookmark insert succeeds (${insert.body.slice(0, 200)})`).toBe(201);
    const readback = expectRows(await readRelation(request, 'bookmarks', owner, `item_id=eq.${encodeURIComponent(String(old?.id))}`), 'prerequisite: the owner reads bookmarks');
    expect(readback, 'prerequisite: the owner reads the bookmark back').toHaveLength(1);

    // When: a run completes
    const result = ingest(runDateToday());

    // Then: the bookmarked item remains, while the unbookmarked old item is gone
    expect(result.report?.status, 'prerequisite (1, the run report): the run completes').toBe('completed');
    const after = expectRows(await readRelation(request, 'items', owner), 'Then');
    expect(after.filter((row) => row.id === old?.id)).toHaveLength(1);
    expect(after.filter((row) => titleOf(row).includes(`${run}-old`)), 'the retention pass ran').toHaveLength(0);
  },
);
