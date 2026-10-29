// AC-04 (scenario, @surface-job, project api): story 2, coverage.md row AC-04 -.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-04; the Given/When/Then is the owning story's row AC-04.
// Given a general fixture source with one AI-keyword item and one non-AI item, when the run completes, then
// only the AI item is in the feed view and its relevance_method is keyword.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf } from '../../support/data';

test(
  'AC-04: only the AI-keyword item of a general source is in the feed, with relevance method keyword',
  { tag: ['@journey-ingest', '@surface-job', '@story-2'] },
  async ({ request }) => {
    // Given: a general fixture source with one AI-keyword item (<run>-ai) and one non-AI item (<run>-general)
    const run = runMarker();
    seed('AC-04', run);
    const owner = signIn('owner');

    // When: the run completes
    const result = ingest(runDateToday());
    expect(result.report?.status, 'prerequisite (1, the run report): the run completes').toMatch(/^(completed|partial)$/);

    // Then: only the AI item is in the feed view and its relevance_method is keyword
    const feed = expectRows(await readRelation(request, 'feed', owner), 'Then: the feed');
    const mine = feed.filter((row) => titleOf(row).includes(run));
    expect(mine.map(titleOf)).toEqual([expect.stringContaining(`${run}-ai`)]);
    const items = expectRows(await readRelation(request, 'items', owner), 'Then: the items');
    expect(items.find((row) => row.id === mine[0]?.id)?.relevance_method).toBe('keyword');
  },
);
