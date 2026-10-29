// AC-15c (invariant, @surface-data, project api): story 51, coverage.md row AC-15 c.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-15; the Given/When/Then is the owning story's row AC-15c. Kind invariant (sprint-02.md
// section 2.3, amendment 01, AD-02 and AD-03): passes once #40 is built.
// Given a seeded item bookmarked through the client, when the bookmarks table is read with the owner's
// sign-in, then it holds one row for it.
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { seed } from '../../support/job';
import { bookmarkFor, expectRows, readRelation, signIn, writeRelation } from '../../support/data';
import { seededItem } from '../../support/access';

test(
  'AC-15c: the bookmarks table read with the owner sign-in holds one row for the bookmarked item',
  { tag: ['@journey-bookmark', '@surface-data', '@story-51'] },
  async ({ request }) => {
    // Given: a seeded item (<run>-a) bookmarked through the client, established by the
    // data-interface write the client makes (sprint-02.md section 2.4, client-action Given of a
    // data row): an insert into bookmarks with the owner's session, read back with the same
    // session. A failed insert or readback is a failed prerequisite, never this row's Then. The
    // client action itself is proven by AC-15a, AC-15b and AC-15e; no browser is opened here.
    const run = runMarker();
    seed('AC-15c', run);
    const owner = signIn('owner');
    const item = await seededItem(request, owner, `${run}-a`);
    const filter = `item_id=eq.${encodeURIComponent(String(item.id))}`;
    const before = expectRows(await readRelation(request, 'bookmarks', owner, filter), 'prerequisite: bookmarks is in the exposed schema');
    expect(before, 'prerequisite: the fresh item is not bookmarked yet').toEqual([]);
    const insert = await writeRelation(request, 'bookmarks', 'POST', bookmarkFor(item), owner);
    expect(insert.status, `prerequisite: the owner's bookmark insert succeeds (${insert.body.slice(0, 200)})`).toBe(201);
    const readback = expectRows(await readRelation(request, 'bookmarks', owner, filter), 'prerequisite: the owner reads bookmarks');
    expect(readback.length, 'prerequisite: the owner reads the bookmark back').toBeGreaterThan(0);

    // When: the bookmarks table is read with the owner's sign-in
    const bookmarks = await readRelation(request, 'bookmarks', owner);

    // Then: it holds one row for the item
    expect(expectRows(bookmarks, 'Then').filter((row) => row.item_id === item.id)).toHaveLength(1);
  },
);
