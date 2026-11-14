// 37-AC-05a (scenario, @surface-job, project api): priitkustala/ai-news-backend#37, criterion AC-5.
// summaries-apply is repeatable (the same input applies once and then skips) and a batch with a refused
// line applies its valid lines and reports the refusal.
// Given set 37-AC-01, when summaries-apply reads the same line for <run>-sum-null twice, then the first call
// reports applied 1, skipped 0, refused 0 and the second applied 0, skipped 1, refused 0; when one call
// reads valid lines for <run>-sum-empty and <run>-sum-short and a line with an id that is not stored, then
// it reports applied 2, skipped 0, refused 1 and the owner reads both valid items with summary_method model.
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { seed, summariesApply } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  '37-AC-05a: summaries-apply applies once and skips the repeat, and a batch with a refused line applies the valid lines',
  { tag: ['@journey-ingest', '@surface-job', '@story-37'] },
  async ({ request }) => {
    // Given: set 37-AC-01
    const run = runMarker();
    const manifest = seed('37-AC-01', run);
    const ids = (manifest.ids ?? {}) as Record<string, string>;
    for (const name of ['sum-null', 'sum-empty', 'sum-short']) {
      expect(String(ids[name]), `prerequisite: the manifest names the item ${name}`).toMatch(/^[0-9a-f]{64}$/);
    }
    const owner = signIn('owner');
    const unknown = createHash('sha256').update(`${run}-not-stored`).digest('hex');
    const stored = expectRows(await readRelation(request, 'items', owner, `id=eq.${unknown}`), 'prerequisite: the owner reads items');
    expect(stored.length, 'prerequisite: the unknown id is not stored').toBe(0);
    const line = { id: ids['sum-null'], text: `${run} synthetic summary: an invented group maps an AI chip roadmap. The map is fixture text only.` };

    // When: the same one-line input twice
    const first = summariesApply([line]);
    const second = summariesApply([line]);

    // Then: applied once, then skipped
    expect(first.exitCode, 'the first call exits 0').toBe(0);
    expect(first.report, 'the first call applies').toEqual({ applied: 1, skipped: 0, refused: 0 });
    expect(second.exitCode, 'the second call exits 0').toBe(0);
    expect(second.report, 'the second call skips').toEqual({ applied: 0, skipped: 1, refused: 0 });

    // When: one call with two valid lines and one unknown id
    const empty = `${run} synthetic summary: an invented lab posts AI benchmark results. The results are fixture text only.`;
    const short = `${run} synthetic summary: an invented team updates an AI coding assistant. The update is fixture text only.`;
    const batch = summariesApply([
      { id: ids['sum-empty'], text: empty },
      { id: ids['sum-short'], text: short },
      { id: unknown, text: empty },
    ]);

    // Then: applied 2, skipped 0, refused 1, and both valid items hold their texts, marked model
    expect(batch.exitCode, 'the batch exits 0 with a refusal').toBe(0);
    expect(batch.report, 'the batch applies the valid lines and reports the refusal').toEqual({ applied: 2, skipped: 0, refused: 1 });
    for (const [name, text] of [['sum-empty', empty], ['sum-short', short]]) {
      const rows = expectRows(await readRelation(request, 'items', owner, `id=eq.${ids[name]}`), 'Then');
      expect(rows.map((row) => [row.summary, row.summary_method]), `${name} holds its text, marked model`).toEqual([[text, 'model']]);
    }
  },
);
