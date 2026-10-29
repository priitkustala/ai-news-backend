// AC-03c (scenario, @surface-job, project api): story 47, coverage.md row AC-03 c.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-03; the Given/When/Then is the owning story's row AC-03c.
// Given seeded hostile fixtures with a feed with a DTD and an external entity, when the run completes, then
// the entity is not expanded.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  'AC-03c: a feed with a DTD and an external entity is processed without expanding the entity',
  { tag: ['@journey-ingest', '@surface-job', '@story-47'] },
  async ({ request }) => {
    // Given: a fixture feed with a DTD whose external entity resolves to the text xxe-<run>
    const run = runMarker();
    seed('AC-03c', run);
    const owner = signIn('owner');

    // When: the run completes
    const result = ingest(runDateToday());

    // Then: the entity is not expanded: no stored item carries the entity's text
    expect(result.report?.status, 'prerequisite (1, the run report): the run ends with a recorded status').toMatch(/^(completed|partial|failed)$/);
    const items = expectRows(await readRelation(request, 'items', owner), 'Then');
    expect(items.filter((row) => JSON.stringify(row).includes(`xxe-${run}`))).toHaveLength(0);
  },
);
