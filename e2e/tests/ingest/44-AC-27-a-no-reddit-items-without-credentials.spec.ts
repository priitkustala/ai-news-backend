// AC-27a (scenario, @surface-job, project api): story 44, coverage.md row AC-27 a.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-27; the Given/When/Then is the owning story's row AC-27a.
// Given a configuration with no Reddit credentials set and a fixture Reddit listing present on the fixture
// server, when a run completes, then no item in the feed view is of source type reddit.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  'AC-27a: without Reddit credentials no item in the feed view is of source type reddit',
  { tag: ['@journey-ingest', '@surface-job', '@story-44'] },
  async ({ request }) => {
    // Given: no Reddit credentials set and a fixture Reddit listing on the fixture server
    const run = runMarker();
    seed('AC-27a', run);
    const owner = signIn('owner');

    // When: a run completes
    const result = ingest(runDateToday());

    // Then: no item in the feed view is of source type reddit
    expect(result.report?.status, 'prerequisite (1, the run report): the run completes').toMatch(/^(completed|partial)$/);
    const feed = expectRows(await readRelation(request, 'feed', owner), 'Then');
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.filter((row) => row.source_type === 'reddit')).toHaveLength(0);
  },
);
