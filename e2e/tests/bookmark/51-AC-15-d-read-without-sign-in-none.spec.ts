// AC-15d (invariant, @surface-data, project api): story 51, coverage.md row AC-15 d.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-15; the Given/When/Then is the owning story's row AC-15d. Kind invariant (sprint-02.md
// section 2.3, amendment 01, AD-02 and AD-03): passes once #40 is built.
// Given a seeded item bookmarked through the client, when the bookmarks table is read without a session, then
// a read without a sign-in returns none.
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { seed } from '../../support/job';
import { bookmarkFor, expectRows, isRefusedOrEmpty, readRelation, signIn, writeRelation } from '../../support/data';
import { seededItem } from '../../support/access';

test(
  'AC-15d: the bookmarks table read without a sign-in returns none',
  { tag: ['@journey-bookmark', '@surface-data', '@story-51'] },
  async ({ request }) => {
    // Given: a seeded item (<run>-a) bookmarked through the client, established by the
    // data-interface write the client makes (sprint-02.md section 2.4, client-action Given of a
    // data row): an insert into bookmarks with the owner's session, read back with the same
    // session, so the read without a sign-in has an owner row to withhold. A failed insert or
    // readback is a failed prerequisite, never this row's Then. No browser is opened here.
    const run = runMarker();
    seed('AC-15d', run);
    const owner = signIn('owner');
    const item = await seededItem(request, owner, `${run}-a`);
    const insert = await writeRelation(request, 'bookmarks', 'POST', bookmarkFor(item), owner);
    expect(insert.status, `prerequisite: the owner's bookmark insert succeeds (${insert.body.slice(0, 200)})`).toBe(201);
    const readback = await readRelation(request, 'bookmarks', owner, `item_id=eq.${encodeURIComponent(String(item.id))}`);
    expect(expectRows(readback, 'prerequisite: the owner reads bookmarks'), 'prerequisite: the owner reads the bookmark back').toHaveLength(1);

    // When: the bookmarks table is read without a session
    const anonymous = await readRelation(request, 'bookmarks');

    // Then: a read without a sign-in returns none
    expect(anonymous.status, 'bookmarks is in the exposed schema').not.toBe(404);
    expect(anonymous.malformed, 'the answer is not a malformed list').toBe(false);
    expect(isRefusedOrEmpty(anonymous)).toBe(true);
  },
);
