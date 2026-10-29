// AC-28d (scenario, @surface-job, project api): story 48, coverage.md row AC-28 d.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-28; the Given/When/Then is the owning story's row AC-28d.
// Given the fixture answers HTTP 503, when a run completes, then the run is partial and the other sources'
// items are served (B-02).
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  'AC-28d: a mirror answering HTTP 503 leaves the run partial and the other sources served',
  { tag: ['@journey-ingest', '@surface-job', '@story-48'] },
  async ({ request }) => {
    // Given: the mirror fixture answers HTTP 503
    const run = runMarker();
    seed('AC-28d', run);
    const owner = signIn('owner');

    // When: a run completes
    const result = ingest(runDateToday());

    // Then: the run is partial and the other sources' items are served
    expect(result.report?.status, 'prerequisite (1, the run report): the run ends with a recorded status').toMatch(/^(completed|partial|failed)$/);
    expect(result.report?.status).toBe('partial');
    expect((result.report?.source_errors ?? []).map((error) => error.source_id)).toContain('anthropic-news-mirror');
    const feed = expectRows(await readRelation(request, 'feed', owner), 'Then');
    expect(feed.filter((row) => row.source_id !== 'anthropic-news-mirror').length).toBeGreaterThan(0);
  },
);
