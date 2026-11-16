// 86-AC-04a (scenario, @surface-job, project api): priitkustala/ai-news-backend#86 (LI-1), criterion AC-4.
// The two laptop sources keep their rows, so a cloud run skips them and retention keeps their
// stored items (src/retain/retain.ts deletes only the items of a source with no row).
// Given stored, unbookmarked items of both laptop sources inside 30 days (stored by a laptop run of
// the day before), when a cloud run completes, then it requests neither laptop source, their items
// are still stored and the run's deleted_removed_source is 0.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { runDateToday, runMarker } from '../../support/env';
import { runBackend } from '../../support/backend';
import { ingest, seed } from '../../support/job';
import { expectRows, LAPTOP_SOURCE_IDS, readRelation, signIn, writeFixtureSources } from '../../support/data';

const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

test(
  '86-AC-04a: a cloud run keeps the stored items of the laptop sources',
  { tag: ['@journey-ingest', '@surface-job', '@story-86'] },
  async ({ request }) => {
    test.setTimeout(300_000);
    // Given: the committed list on the fixture feed server, and the laptop sources' items stored by a laptop run
    const run = runMarker();
    seed('40g', run);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ai-news-86-${run}-`));
    try {
      const { file } = writeFixtureSources(dir, run);
      const loaded = runBackend(['seed-sources', file]);
      expect(loaded.exitCode, `prerequisite: seed-sources exits 0: ${loaded.stderr}`).toBe(0);
      const date = runDateToday();
      const laptop = ingest(dayBefore(date), { runner: 'laptop' });
      expect(laptop.report?.status, `prerequisite: the laptop run completes: ${laptop.stderr}`).toBe('completed');
      const owner = signIn('owner');
      const laptopItems = async () => expectRows(
        await readRelation(request, 'items', owner, `source_id=in.(${LAPTOP_SOURCE_IDS.join(',')})`), 'the owner reads items',
      ).map((row) => `${String(row.source_id)} ${String(row.id)}`).sort();
      const before = await laptopItems();
      for (const id of LAPTOP_SOURCE_IDS) {
        expect(before.filter((key) => key.startsWith(`${id} `)).length, `prerequisite: items of ${id} are stored`).toBeGreaterThan(0);
      }

      // When: a cloud run completes
      const cloud = ingest(date);
      expect(cloud.report?.status, `the cloud run completes: ${cloud.stderr}`).toBe('completed');

      // Then: it requests neither laptop source, their items are still stored, and nothing is deleted as of a removed source
      const ids = (cloud.report?.requests ?? []).map((r) => r.source_id);
      for (const id of LAPTOP_SOURCE_IDS) expect(ids, `the cloud run does not request ${id}`).not.toContain(id);
      expect(await laptopItems(), 'the laptop sources\' items are still stored').toEqual(before);
      const runs = expectRows(await readRelation(request, 'ingestion_runs', owner, `run_date=eq.${date}`), 'the owner reads the run');
      expect(runs, 'one cloud run row of the date').toHaveLength(1);
      expect((runs[0].counts as Record<string, unknown> | null)?.deleted_removed_source, 'deleted_removed_source is 0').toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
