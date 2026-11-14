// 37-AC-04b (scenario, @surface-job, project api): priitkustala/ai-news-backend#37, criterion AC-4.
// A feed summary of 40 characters or more replaces a model-written one, and the method becomes feed.
// Given <run>-feed-wins of set 37-AC-01 with a model-written summary applied by summaries-apply, and the
// fixture feed stored-summaries.xml delivering the same item with a 100-character description, earlier
// than the stored copy at the same source weight (so the copy wins), when today's run date is ingested,
// then the owner reads the item with the feed's 100 characters as its summary and summary_method feed.
import { test, expect } from '@playwright/test';
import { runDateToday, runMarker } from '../../support/env';
import { ingest, seed, summariesApply } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  '37-AC-04b: a feed summary of 40 characters or more replaces a model-written one',
  { tag: ['@journey-ingest', '@surface-job', '@story-37'] },
  async ({ request }) => {
    // Given: <run>-feed-wins stored with no summary, and a model-written summary applied to it
    const run = runMarker();
    const manifest = seed('37-AC-01', run);
    const id = String(((manifest.ids ?? {}) as Record<string, string>)['feed-wins']);
    expect(id, 'prerequisite: the manifest names the item feed-wins').toMatch(/^[0-9a-f]{64}$/);
    const feedText = String(manifest.feed_text_100);
    expect(feedText.length, 'prerequisite: the manifest carries the feed\'s 100 characters').toBe(100);
    const owner = signIn('owner');
    const text = `${run} synthetic summary: an invented lab finishes an AI safety review. The review text is fixture only.`;
    const applied = summariesApply([{ id, text }]);
    expect(applied.exitCode, 'summaries-apply exits 0').toBe(0);
    expect(applied.report, 'summaries-apply applies the model-written summary').toEqual({ applied: 1, skipped: 0, refused: 0 });

    // When: today's run date is ingested
    const result = ingest(runDateToday());
    expect(result.report?.status, 'prerequisite: the run completes').toMatch(/^(completed|partial)$/);

    // Then: the feed's 100 characters replace the model-written summary, and the method is feed
    const after = expectRows(await readRelation(request, 'items', owner, `id=eq.${id}`), 'Then');
    expect(after.length).toBe(1);
    expect(after[0].summary, 'the feed\'s summary replaces the model-written one').toBe(feedText);
    expect(after[0].summary_method, 'the method becomes feed').toBe('feed');
  },
);
