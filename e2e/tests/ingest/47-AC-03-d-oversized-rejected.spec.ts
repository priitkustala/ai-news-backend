// AC-03d (scenario, @surface-job, project api): story 47, coverage.md row AC-03 d.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-03; the Given/When/Then is the owning story's row AC-03d.
// Given seeded hostile fixtures with an oversized item, when the run completes, then the oversized item is
// rejected and recorded.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf } from '../../support/data';

test(
  'AC-03d: an oversized item is rejected and recorded',
  { tag: ['@journey-ingest', '@surface-job', '@story-47'] },
  async ({ request }) => {
    // Given: a fixture feed with an item over the size limit, titled oversized-<run>
    const run = runMarker();
    const manifest = seed('AC-03d', run);
    const oversizedSource = String(manifest.oversized_source_id);
    const owner = signIn('owner');

    // When: the run completes
    const result = ingest(runDateToday());

    // Then: the oversized item is rejected and recorded
    expect(result.report?.status, 'prerequisite (1, the run report): the run ends with a recorded status').toMatch(/^(completed|partial|failed)$/);
    const rejections = (result.report?.rejected ?? []).filter((r) => r.source_id === oversizedSource);
    expect(rejections, 'the run records the rejection of the oversized fixture').toHaveLength(1);
    const reason = rejections[0]?.reason;
    expect(typeof reason === 'string' && reason.trim() !== '', `with its reason (${JSON.stringify(reason)})`).toBe(true);
    const items = expectRows(await readRelation(request, 'items', owner), 'Then');
    expect(items.filter((row) => titleOf(row).includes(`oversized-${run}`))).toHaveLength(0);
  },
);
