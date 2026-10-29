// AC-02a (scenario, @surface-job, project api): story 1, coverage.md row AC-02 a.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-02; the Given/When/Then is the owning story's row AC-02a.
// Given one fixture feed that answers HTTP 500 and one that returns invalid XML among the seeded feeds, when
// a run completes, then the run status is partial, both failures are listed per source, and items from the
// other feeds are served.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf } from '../../support/data';

test(
  'AC-02a: a run with one HTTP 500 feed and one invalid XML feed ends partial and serves the rest',
  { tag: ['@journey-ingest', '@surface-job', '@story-1'] },
  async ({ request }) => {
    // Given: one fixture feed answers HTTP 500 and one returns invalid XML among the seeded feeds
    const run = runMarker();
    const manifest = seed('AC-02a', run);
    // the manifest names the failing fixtures and a feed that succeeds (fixture set AC-02a)
    const failing = (Array.isArray(manifest.failing_sources) ? manifest.failing_sources : []) as { source_id: string; failure: string }[];
    expect(failing.map((s) => s.failure).sort(), 'prerequisite: one HTTP 500 and one invalid XML fixture').toEqual(['http-500', 'invalid-xml']);
    const okSource = String(manifest.ok_source_id);
    const owner = signIn('owner');

    // When: a run completes
    const result = ingest(runDateToday());

    // Then: status partial, both failures listed per source, the other feeds' items served
    expect(result.report?.status).toBe('partial');
    const errors = result.report?.source_errors ?? [];
    expect(errors.map((e) => e.source_id).sort(), 'exactly the two failing fixtures are listed').toEqual(failing.map((s) => s.source_id).sort());
    for (const e of errors) {
      expect(typeof e.error === 'string' && e.error.trim() !== '', `the failure of ${e.source_id} is recorded with a reason (${JSON.stringify(e.error)})`).toBe(true);
    }
    const feed = expectRows(await readRelation(request, 'feed', owner), 'Then');
    expect(feed.filter((row) => row.source_id === okSource && titleOf(row).includes(run)).length,
      'an item of the succeeding fixture is served').toBeGreaterThan(0);
  },
);
