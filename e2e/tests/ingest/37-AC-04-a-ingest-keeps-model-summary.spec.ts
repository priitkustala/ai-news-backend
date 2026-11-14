// 37-AC-04a (scenario, @surface-job, project api): priitkustala/ai-news-backend#37, criterion AC-4.
// An ingest never erases a model-written summary: a copy that wins under B-07 and brings no summary
// keeps the stored summary and summary_method model.
// Given <run>-model-kept of set 37-AC-01 with a model-written summary applied by summaries-apply, and the
// fixture feed stored-summaries.xml delivering the same item with no summary, earlier than the stored copy
// at the same source weight (so the copy wins), when today's run date is ingested (a new run date) and
// then the same run date again, then after each the owner reads the item with the applied summary and
// summary_method model, and the fixture server logged that the first ingest requested this run's feed.
import { test, expect } from '@playwright/test';
import { requireEnv, runDateToday, runMarker } from '../../support/env';
import { ingest, seed, summariesApply } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  '37-AC-04a: an ingest keeps a model-written summary when the feed gives none',
  { tag: ['@journey-ingest', '@surface-job', '@story-37'] },
  async ({ request }) => {
    // Two ingests of about ten seconds each; the row took 19 to 21 seconds alone, so the default 30 second timeout is too close under load.
    test.setTimeout(60_000);
    // Given: <run>-model-kept stored with no summary, and a model-written summary applied to it
    const run = runMarker();
    const manifest = seed('37-AC-01', run);
    const id = String(((manifest.ids ?? {}) as Record<string, string>)['model-kept']);
    expect(id, 'prerequisite: the manifest names the item model-kept').toMatch(/^[0-9a-f]{64}$/);
    const owner = signIn('owner');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const text = `${run} synthetic summary: an invented lab publishes an AI model card for a small model. The card text is fixture only.`;
    const applied = summariesApply([{ id, text }]);
    expect(applied.exitCode, 'summaries-apply exits 0').toBe(0);
    expect(applied.report, 'summaries-apply applies the model-written summary').toEqual({ applied: 1, skipped: 0, refused: 0 });
    const given = expectRows(await readRelation(request, 'items', owner, `id=eq.${id}`), 'prerequisite: the owner reads the item');
    expect(given.map((row) => [row.summary, row.summary_method]), 'prerequisite: the item holds the model-written summary').toEqual([[text, 'model']]);
    const ourFeed = (entries: string[]) => entries.filter((entry) =>
      entry.startsWith('/feeds/stored-summaries.xml?') && new URLSearchParams(entry.split('?')[1] ?? '').get('run') === run).length;
    const logBefore = await request.get(`${fixtures}/requests`);
    expect(logBefore.status(), 'prerequisite: the fixture server answers its request log').toBe(200);
    const requestedBefore = ourFeed(((await logBefore.json()) as { requests?: string[] }).requests ?? []);

    // When: today's run date is ingested (a new run date: the base seed's last run is older)
    const first = ingest(runDateToday());
    expect(first.report?.status, 'prerequisite: the run completes').toMatch(/^(completed|partial)$/);
    const logAfter = await request.get(`${fixtures}/requests`);
    expect(logAfter.status(), 'prerequisite: the fixture server answers its request log').toBe(200);
    const requestedAfter = ourFeed(((await logAfter.json()) as { requests?: string[] }).requests ?? []);
    expect(requestedAfter - requestedBefore, 'prerequisite: the ingest requested this run\'s stored-summaries.xml').toBeGreaterThan(0);

    // Then: the model-written summary and its method stay
    const afterFirst = expectRows(await readRelation(request, 'items', owner, `id=eq.${id}`), 'Then');
    expect(afterFirst.length).toBe(1);
    expect(afterFirst[0].summary, 'the model-written summary is kept after a new run date').toBe(text);
    expect(afterFirst[0].summary_method, 'the method stays model after a new run date').toBe('model');

    // When: the same run date is ingested again
    const second = ingest(runDateToday());
    expect(second.report?.status, 'prerequisite: the same run date answers its run').toMatch(/^(completed|partial)$/);

    // Then: the same reading
    const afterSecond = expectRows(await readRelation(request, 'items', owner, `id=eq.${id}`), 'Then');
    expect(afterSecond.length).toBe(1);
    expect(afterSecond[0].summary, 'the model-written summary is kept after the same run date').toBe(text);
    expect(afterSecond[0].summary_method, 'the method stays model after the same run date').toBe('model');
  },
);
