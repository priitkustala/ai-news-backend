// 211-AC-1a (scenario, @surface-job, project api): priitkustala/ai-news#211, criterion AC-1.
// Approved settlement 158 of 2026-11-24 (SRC-1): the stored summary is plain text: tags stripped, then
// entities decoded, footnote marks between backslashes removed, rule lines removed, white space folded,
// then cut as today.
// Given an entry whose description holds a doubly escaped numeric reference in escaped markup and one whose CDATA markup holds a named entity, when the run completes, then each stored summary holds the apostrophe character and no entity code.
import { test, expect } from '@playwright/test';
import { runDateToday, runMarker } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf, type Row } from '../../support/data';

test(
  '211-AC-1a: a numeric and a named entity of the source summary are stored decoded',
  { tag: ['@journey-ingest', '@surface-job', '@story-211'] },
  async ({ request }) => {
    // Given: a feed-summary source with an item holding &amp;#8217; in escaped markup and one holding &rsquo; in CDATA markup
    const run = runMarker();
    const manifest = seed('211-AC-1a', run);
    const markupSource = String(manifest.markup_source_id);
    const mirrorSource = String(manifest.mirror_source_id);
    expect(markupSource !== 'undefined' && mirrorSource !== 'undefined' && manifest.case_marker === 'numeric', 'prerequisite: the manifest names the markup source, the mirror source and the case').toBe(true);
    const owner = signIn('owner');

    // When: the run completes
    const result = ingest(runDateToday());
    expect(result.report?.status, 'prerequisite: the run completes').toMatch(/^(completed|partial)$/);

    // Then: each stored summary holds the apostrophe character and no entity code
    const items = expectRows(await readRelation(request, 'items', owner), 'Then');
    const feed = expectRows(await readRelation(request, 'feed', owner), 'Then');
    const ofCase = (rows: Row[], marker: string) => rows.filter((row) => row.source_id === markupSource && titleOf(row).includes(`${run}-${marker} `));
    const cases = ['numeric', 'named'].map((marker) => {
      const stored = ofCase(items, marker);
      expect(stored.length, `prerequisite: the ${marker} item is stored`).toBe(1);
      const shown = ofCase(feed, marker);
      expect(shown.length, `prerequisite: the ${marker} item is in the feed view`).toBe(1);
      expect(typeof stored[0].summary, `prerequisite: the ${marker} item has a stored summary`).toBe('string');
      return { marker, summary: stored[0].summary as string, shown: shown[0].summary };
    });
    for (const { marker, summary, shown } of cases) {
      expect(summary, `the ${marker} summary holds the apostrophe character U+2019`).toContain('’');
      expect(summary, `the ${marker} summary holds no named entity code`).not.toMatch(/&[A-Za-z]+;/);
      expect(summary, `the ${marker} summary holds no numeric entity code`).not.toMatch(/&#[0-9]+;/);
      expect(shown, `the ${marker} feed row shows the stored summary`).toBe(summary);
    }
  },
);
