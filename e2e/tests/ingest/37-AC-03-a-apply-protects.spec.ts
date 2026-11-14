// 37-AC-03a (scenario, @surface-job, project api): priitkustala/ai-news-backend#37, criterion AC-3.
// summaries-apply skips an item that has a usable summary and refuses an unknown id, an empty text and a
// text over 600 characters; no row other than the applied one changes.
// Given set 37-AC-01, when one summaries-apply call reads five lines (sum-short with a valid text, sum-long
// with a valid text, an id that is not stored, sum-empty with an empty text, sum-null with a text of 601
// characters), then it reports applied 1, skipped 1, refused 3, and in the owner's read of every item only
// sum-short changed.
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { seed, summariesApply } from '../../support/job';
import { expectRows, readRelation, signIn, type Row } from '../../support/data';

const summaryColumns = (rows: Row[]) =>
  new Map(rows.map((row) => [String(row.id), JSON.stringify([row.summary ?? null, row.summary_method ?? null])]));

test(
  '37-AC-03a: summaries-apply skips a usable summary and refuses an unknown id, an empty text and a text over 600 characters',
  { tag: ['@journey-ingest', '@surface-job', '@story-37'] },
  async ({ request }) => {
    // Given: set 37-AC-01, its 200-character summary on sum-long
    const run = runMarker();
    const manifest = seed('37-AC-01', run);
    const ids = (manifest.ids ?? {}) as Record<string, string>;
    for (const name of ['sum-short', 'sum-long', 'sum-empty', 'sum-null']) {
      expect(String(ids[name]), `prerequisite: the manifest names the item ${name}`).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(manifest.long_summary_length, 'prerequisite: the long summary is 200 characters').toBe(200);
    const owner = signIn('owner');
    const before = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads items');
    const unknown = createHash('sha256').update(`${run}-not-stored`).digest('hex');
    expect(unknown, 'prerequisite: the unknown id has 64 hex characters').toMatch(/^[0-9a-f]{64}$/);
    expect(before.some((row) => row.id === unknown), 'prerequisite: the unknown id is not stored').toBe(false);
    const valid = `${run} synthetic summary: an invented team ships an AI coding assistant update. The note is fixture text only.`;
    const tooLong = `${run} ${'x'.repeat(600)}`.slice(0, 601);
    expect(tooLong.length, 'prerequisite: the long text has 601 characters').toBe(601);

    // When: one call with the five lines
    const result = summariesApply([
      { id: ids['sum-short'], text: valid },
      { id: ids['sum-long'], text: valid },
      { id: unknown, text: valid },
      { id: ids['sum-empty'], text: '' },
      { id: ids['sum-null'], text: tooLong },
    ]);

    // Then: applied 1, skipped 1, refused 3, and only sum-short changed
    expect(result.exitCode, 'summaries-apply exits 0 with refusals').toBe(0);
    expect(result.report, 'summaries-apply reports the counts').toEqual({ applied: 1, skipped: 1, refused: 3 });
    const after = expectRows(await readRelation(request, 'items', owner), 'Then');
    expect(after.length, 'the row count of items is unchanged').toBe(before.length);
    const was = summaryColumns(before);
    const now = summaryColumns(after);
    const changed = [...now.keys()].filter((id) => now.get(id) !== was.get(id));
    expect(changed, 'only sum-short changed').toEqual([ids['sum-short']]);
    expect(now.get(ids['sum-short']), 'sum-short holds the text, marked model').toBe(JSON.stringify([valid, 'model']));
  },
);
