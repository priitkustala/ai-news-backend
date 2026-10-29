// 40c (bootstrap, @surface-data, project api): the environment bootstrap story (#40), coverage.md row 40 c.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// section Local test environment (bootstrap checks).
// Given the synthetic test owner seeded as an Auth user, when the owner signs in with the development sign-in
// and reads a seeded table, then the interface answers the sign-in and the read.
import { test, expect } from '@playwright/test';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  '40c: the seeded test owner signs in and reads a seeded table',
  { tag: ['@journey-bootstrap', '@surface-data', '@story-40'] },
  async ({ request }) => {
    // Given: the synthetic test owner is seeded as an Auth user
    // When: the test owner signs in with the development sign-in and reads a seeded table
    const owner = signIn('owner');
    const items = await readRelation(request, 'items', owner);

    // Then: the local Supabase interface answers the sign-in and the read as the seeded owner
    expect(expectRows(items, 'Then').length).toBeGreaterThan(0);
  },
);
