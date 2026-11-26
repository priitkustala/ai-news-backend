// 211-AC-2a (scenario, @surface-job, project api): priitkustala/ai-news#211, criterion AC-2.
// Approved settlement 158 of 2026-11-24 (SRC-1): the stored summary is plain text: tags stripped, then
// entities decoded, footnote marks between backslashes removed, rule lines removed, white space folded,
// then cut as today.
// Given an entry whose description holds the footnote mark \1\ and a line of 40 hyphens, when the run completes, then the stored summary holds neither.
import { test, expect } from '@playwright/test';
import { runDateToday, runMarker } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf } from '../../support/data';

test(
  '211-AC-2a: footnote marks and rule lines of the source summary are not stored',
  { tag: ['@journey-ingest', '@surface-job', '@story-211'] },
  async ({ request }) => {
    // Given: a feed-summary source with an item whose description holds \1\ after a sentence and a line of 40 hyphens
    const run = runMarker();
    const manifest = seed('211-AC-2a', run);
    const markupSource = String(manifest.markup_source_id);
    const mirrorSource = String(manifest.mirror_source_id);
    expect(markupSource !== 'undefined' && mirrorSource !== 'undefined' && manifest.case_marker === 'marks', 'prerequisite: the manifest names the markup source, the mirror source and the case').toBe(true);
    const owner = signIn('owner');

    // When: the run completes
    const result = ingest(runDateToday());
    expect(result.report?.status, 'prerequisite: the run completes').toMatch(/^(completed|partial)$/);

    // Then: the stored summary holds no footnote mark and no run of four or more hyphens
    const items = expectRows(await readRelation(request, 'items', owner), 'Then');
    const stored = items.filter((row) => row.source_id === markupSource && titleOf(row).includes(`${run}-marks `));
    expect(stored.length, 'prerequisite: the marks item is stored').toBe(1);
    const feed = expectRows(await readRelation(request, 'feed', owner), 'Then');
    const shown = feed.filter((row) => row.source_id === markupSource && titleOf(row).includes(`${run}-marks `));
    expect(shown.length, 'prerequisite: the marks item is in the feed view').toBe(1);
    expect(typeof stored[0].summary, 'prerequisite: the marks item has a stored summary').toBe('string');
    const summary = stored[0].summary as string;
    expect(summary.length, 'the summary is not empty').toBeGreaterThan(0);
    expect(summary, 'the summary holds no footnote mark between backslashes').not.toMatch(/\\[0-9]+\\/);
    expect(summary, 'the summary holds no run of four or more hyphens').not.toMatch(/-{4,}/);
    expect(shown[0].summary, 'the feed row shows the stored summary').toBe(summary);
  },
);
