// 40d (bootstrap, @surface-data, project api): the environment bootstrap story (#40), coverage.md row 40 d.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// section Local test environment (bootstrap checks). Then rewritten by priitkustala/ai-news-backend#47
// (S-21a, AC-1 and AC-3; the owner's decision of 2026-11-09, question 1: rewrite it): a visitor without a
// sign-in reads the news, and personal data stays behind the owner's sign-in.
// Given the local Supabase interface with the local publishable key, when the seeded items table is read
// without a session, then it returns the seeded rows; when the bookmarks table is read without a session,
// then the read is refused or empty.
import { test, expect } from '@playwright/test';
import { describeRead, expectRows, isRefusedOrEmpty, readRelation, signIn } from '../../support/data';
import { idsOf } from '../../support/access';

test(
  '40d: without a sign-in the seeded items are read and bookmarks are refused or empty',
  { tag: ['@journey-bootstrap', '@surface-data', '@story-40', '@story-47'] },
  async ({ request }) => {
    // Given: the local Supabase interface with the local publishable key and no session; the
    // seeded table holds rows the owner can read
    const owner = expectRows(await readRelation(request, 'items', signIn('owner')), 'prerequisite: the owner reads items');
    expect(owner.length, 'prerequisite: items holds seeded rows for the owner').toBeGreaterThan(0);

    // When: the seeded items table is read without a session
    const items = await readRelation(request, 'items');

    // Then: it returns the seeded rows, the ones the owner reads
    const rows = expectRows(items, 'items: the seeded rows read without a session');
    expect(rows.length, 'items: the seeded rows read without a session are more than 0').toBeGreaterThan(0);
    expect(idsOf('items', rows), 'items: the read without a session returns the ids the owner reads').toEqual(idsOf('items', owner));

    // When: the bookmarks table is read without a session
    const bookmarks = await readRelation(request, 'bookmarks');

    // Then: the interface refuses the read (refused, or answered with a well-formed empty list)
    expect(bookmarks.status, 'bookmarks is in the exposed schema').not.toBe(404);
    expect(bookmarks.malformed, 'the answer is not a malformed list').toBe(false);
    expect(isRefusedOrEmpty(bookmarks), `bookmarks: no row is returned (${describeRead(bookmarks)})`).toBe(true);
  },
);
