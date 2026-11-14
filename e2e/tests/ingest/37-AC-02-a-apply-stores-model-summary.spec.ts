// 37-AC-02a (scenario, @surface-job, project api): priitkustala/ai-news-backend#37, criterion AC-2.
// summaries-apply stores a model-written summary for an item without a usable one and marks it model.
// Given the item <run>-sum-null of set 37-AC-01, stored with a null summary, when summaries-apply reads
// one line with its id and two invented sentences, then it reports applied 1, skipped 0, refused 0, the
// owner reads the item with that summary and summary_method model, and summaries-pending no longer lists it.
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { seed, summariesApply, summariesPending } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  '37-AC-02a: summaries-apply stores a model-written summary and marks it model',
  { tag: ['@journey-ingest', '@surface-job', '@story-37'] },
  async ({ request }) => {
    // Given: <run>-sum-null stored with a null summary
    const run = runMarker();
    const manifest = seed('37-AC-01', run);
    const id = String(((manifest.ids ?? {}) as Record<string, string>)['sum-null']);
    expect(id, 'prerequisite: the manifest names the item sum-null').toMatch(/^[0-9a-f]{64}$/);
    const owner = signIn('owner');
    const before = expectRows(await readRelation(request, 'items', owner, `id=eq.${id}`), 'prerequisite: the owner reads the item');
    expect(before.map((row) => row.summary), 'prerequisite: its summary is null').toEqual([null]);
    const text = `${run} synthetic summary: an invented lab shows a small AI chip roadmap. The fixture note names no real company.`;
    expect(text.length >= 40 && text.length <= 600, 'prerequisite: the text is between 40 and 600 characters').toBe(true);

    // When: summaries-apply reads one line with its id and the text
    const result = summariesApply([{ id, text }]);

    // Then: applied 1, skipped 0, refused 0; the owner reads the text and the method model; pending no longer lists it
    expect(result.exitCode, 'summaries-apply exits 0').toBe(0);
    expect(result.report, 'summaries-apply reports the counts').toEqual({ applied: 1, skipped: 0, refused: 0 });
    const after = expectRows(await readRelation(request, 'items', owner, `id=eq.${id}`), 'Then');
    expect(after.length).toBe(1);
    expect(after[0].summary, 'the stored summary is the text').toBe(text);
    expect(after[0].summary_method, 'the stored method is model').toBe('model');
    const pending = summariesPending();
    expect(pending.exitCode, 'summaries-pending exits 0').toBe(0);
    expect(pending.rows.some((row) => row.id === id), 'summaries-pending no longer lists the item').toBe(false);
  },
);
