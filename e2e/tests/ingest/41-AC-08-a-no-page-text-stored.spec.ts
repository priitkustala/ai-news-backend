// 41-AC-08a (scenario, @surface-job, project api): priitkustala/ai-news-backend#41, criterion AC-8.
// The job reads the vendor's own news page (source kind page) and keeps only a post's title, link
// and date, never the page's other text (B-12, B-27).
// Given the anthropic-news-mirror source is a page source whose page (fixtures/pages/news.html) holds,
// in every dated card, a paragraph starting <run>-page-body, when the run completes, then no item of
// the source holds a summary or that text.
import { test, expect } from '@playwright/test';
import { runDateToday, runMarker } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  '41-AC-08a: the items of a page source hold no text of the page beyond title, link and date',
  { tag: ['@journey-ingest', '@surface-job', '@story-41'] },
  async ({ request }) => {
    // Given: the mirror source reads the fixture news page, its cards carrying <run>-page-body
    const run = runMarker();
    const manifest = seed('41-AC-03', run);
    const sourceId = String(manifest.page_source_id);
    expect(sourceId, 'prerequisite: the manifest names the page source').toBe('anthropic-news-mirror');
    const owner = signIn('owner');

    // When: the run completes
    const result = ingest(runDateToday());
    expect(result.report?.status, 'prerequisite (1, the run report): the run ends with a recorded status').toMatch(/^(completed|partial|failed)$/);

    // Then: every item of the source has an empty summary and no page text
    const items = expectRows(await readRelation(request, 'items', owner), 'Then').filter((row) => row.source_id === sourceId);
    expect(items.filter((row) => String(row.title ?? '').includes(run)).length, 'items of this run were stored').toBeGreaterThan(0);
    for (const row of items) {
      expect(row.summary ? String(row.summary) : '').toBe('');
      expect(JSON.stringify(row)).not.toContain(`${run}-page-body`);
    }
  },
);
