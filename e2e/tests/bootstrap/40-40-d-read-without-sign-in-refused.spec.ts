// 40d (bootstrap, @surface-data, project api): the environment bootstrap story (#40), coverage.md row 40 d.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// section Local test environment (bootstrap checks).
// Given the local Supabase interface with the local publishable key, when a seeded table is read without a
// session, then the read is refused.
import { test, expect } from '@playwright/test';
import { expectRows, isRefusedOrEmpty, readRelation, signIn } from '../../support/data';

test(
  '40d: a read of a seeded table without a sign-in is refused',
  { tag: ['@journey-bootstrap', '@surface-data', '@story-40'] },
  async ({ request }) => {
    // Given: the local Supabase interface with the local publishable key and no session; the
    // seeded table holds rows the owner can read, so an empty answer is a refusal, not an empty table
    const owner = expectRows(await readRelation(request, 'items', signIn('owner')), 'prerequisite: the owner reads items');
    expect(owner.length, 'prerequisite: items holds seeded rows for the owner').toBeGreaterThan(0);

    // When: a seeded table is read without a session
    const items = await readRelation(request, 'items');

    // Then: the interface refuses the read (refused, or answered with a well-formed empty list)
    expect(items.status, 'items is in the exposed schema').not.toBe(404);
    expect(items.malformed, 'the answer is not a malformed list').toBe(false);
    expect(isRefusedOrEmpty(items)).toBe(true);
  },
);
