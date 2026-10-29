// AC-28c (scenario, @surface-job, project api): story 48, coverage.md row AC-28 c.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-28; the Given/When/Then is the owning story's row AC-28c.
// Given a fixture shaped like the mirror as source anthropic-news-mirror, when a run completes, then the
// items table holds no description text for it.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  'AC-28c: the items table holds no description text for the anthropic-news-mirror items',
  { tag: ['@journey-ingest', '@surface-job', '@story-48'] },
  async ({ request }) => {
    // Given: a fixture shaped like the mirror (RSS 2.0, each description a whole article that
    // starts with <run>-article-body) on the fixture server as source anthropic-news-mirror
    const run = runMarker();
    seed('AC-28c', run);
    const owner = signIn('owner');

    // When: a run completes
    const result = ingest(runDateToday());
    expect(result.report?.status, 'prerequisite (1, the run report): the run completes').toMatch(/^(completed|partial)$/);

    // Then: the items table holds no description text for it
    const items = expectRows(await readRelation(request, 'items', owner), 'Then');
    const mirror = items.filter((row) => row.source_id === 'anthropic-news-mirror');
    expect(mirror.length, 'mirror items stored').toBeGreaterThan(0);
    for (const row of mirror) {
      expect(row.summary ? String(row.summary) : '').toBe('');
      expect(JSON.stringify(row)).not.toContain(`${run}-article-body`);
    }
  },
);
