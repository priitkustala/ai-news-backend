// AC-20c (invariant, @surface-data, project api): story 43, coverage.md row AC-20 c.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-20; the Given/When/Then is the owning story's row AC-20c. Kind invariant (sprint-02.md
// section 2.3, amendment 01, AD-01): passes once #40 is built and after every later story.
// Given the seeded test owner signed in, when the tables and views of the exposed schema are read with the
// publishable key, then the reads return rows.
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';
import { exposedRelations, ownerRowsEverywhere } from '../../support/access';

test(
  'AC-20c: the seeded test owner signed in reads rows from the exposed schema',
  { tag: ['@journey-access', '@surface-data', '@story-43'] },
  async ({ request }) => {
    // Given: the seeded test owner signed in; the client-written relations hold the owner's own
    // row, written as the client writes it and read back (support/access.ts)
    const run = runMarker();
    seed('AC-20c', run);
    const owner = signIn('owner');
    const relations = exposedRelations();
    await ownerRowsEverywhere(request, owner, run, relations);

    // When: every declared table and view of the exposed schema, later and OD-08 relations
    // included, is read with the publishable key
    // Then: each read returns rows: status 200, a well-formed list, at least one row
    for (const relation of relations) {
      const rows = expectRows(await readRelation(request, relation, owner), `${relation} answers the owner`);
      expect(rows.length, `${relation} returns rows`).toBeGreaterThan(0);
    }
  },
);
