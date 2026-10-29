// AC-08 (scenario, @surface-data, project api): story 3, coverage.md row AC-08 -.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-08; the Given/When/Then is the owning story's row AC-08.
// Given more seeded arXiv items than the configured daily cap, when the owner reads the feed, then the number
// of arXiv items for that day does not exceed the cap.
import { test, expect } from '@playwright/test';
import { runDateToday, runMarker } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  'AC-08: the feed holds no more arXiv items for a day than the configured cap',
  { tag: ['@journey-read-feed', '@surface-data', '@story-3'] },
  async ({ request }) => {
    // Given: more seeded arXiv items for one day than the configured daily cap, seeded as a
    // fixture arXiv feed that a run processes (the cap is applied by the job module process,
    // 3 Code touchpoints, so stored rows seeded past the job would bypass it); the manifest
    // names the arXiv source, the day, the configured cap and the seeded count
    const run = runMarker();
    const manifest = seed('AC-08', run);
    const cap = Number(manifest.arxiv_daily_cap);
    expect(Number(manifest.arxiv_seeded_for_day), 'prerequisite: more arXiv items seeded than the cap').toBeGreaterThan(cap);
    const owner = signIn('owner');
    const result = ingest(runDateToday());
    expect(result.report?.status, 'prerequisite (1, the run report): the run completes').toMatch(/^(completed|partial)$/);

    // When: the owner reads the feed
    const feed = expectRows(await readRelation(request, 'feed', owner), 'Then');

    // Then: the arXiv items for that day are present and do not exceed the cap
    const shown = feed.filter(
      (row) => row.source_id === manifest.arxiv_source_id && String(row.published_at).startsWith(String(manifest.arxiv_day)),
    );
    expect(shown.length, 'arXiv items of that day are in the feed').toBeGreaterThan(0);
    expect(shown.length).toBeLessThanOrEqual(cap);
  },
);
