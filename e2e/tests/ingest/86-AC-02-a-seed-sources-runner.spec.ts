// 86-AC-02a (scenario, @surface-job, project api): priitkustala/ai-news-backend#86 (LI-1), criterion AC-2.
// seed-sources writes each entry's runner mark (absent: cloud); the committed list holds 16 rows, of
// which eu-ai-act-newsletter and import-ai are marked laptop. The rows are read through the job's
// own selection: a dry run selects the sources of its runner. A file with any other runner value
// is refused with exit 2 before any connection and changes nothing.
// Given the base seed with the 40g set, when seed-sources loads config/sources.json, then it reports
// 16 ids with both laptop ids; when it loads the same list on the fixture feed server, then a cloud
// dry run requests the 14 other ids and a laptop dry run exactly the two; when it loads a copy with
// "runner": "elsewhere" on one entry, then it exits 2 naming the runner and the selection is unchanged.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { repositoryRoot, runDateToday, runMarker } from '../../support/env';
import { lastJsonObject, runBackend } from '../../support/backend';
import { ingest, seed } from '../../support/job';
import { LAPTOP_SOURCE_IDS, writeFixtureSources } from '../../support/data';

const requested = (result: ReturnType<typeof ingest>) => [...new Set((result.report?.requests ?? []).map((r) => r.source_id))].sort();

test(
  '86-AC-02a: seed-sources stores the runner of each source; a runner other than cloud or laptop is refused with exit 2',
  { tag: ['@journey-ingest', '@surface-job', '@story-86'] },
  async ({}) => {
    test.setTimeout(300_000);
    // Given: the base seed with the 40g set
    const run = runMarker();
    seed('40g', run);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ai-news-86-${run}-`));
    try {
      // When: seed-sources loads the committed list
      const committed = runBackend(['seed-sources', path.join(repositoryRoot(), 'config', 'sources.json')]);

      // Then: 16 rows, both laptop ids among them
      expect(committed.exitCode, `seed-sources exits 0: ${committed.stderr}`).toBe(0);
      const output = lastJsonObject(committed.stdout);
      expect(output?.count, 'the committed list has 16 rows').toBe(16);
      for (const id of LAPTOP_SOURCE_IDS) expect(output?.sources as string[], `${id} is a row`).toContain(id);

      // When: seed-sources loads the same list on the fixture feed server
      const { file, sources } = writeFixtureSources(dir, run);
      const loaded = runBackend(['seed-sources', file]);
      expect(loaded.exitCode, `prerequisite: seed-sources of the fixture list exits 0: ${loaded.stderr}`).toBe(0);

      // Then: the cloud dry run selects the 14 rows not marked laptop, the laptop dry run exactly the two
      const cloudIds = sources.map((s) => s.id).filter((id) => !LAPTOP_SOURCE_IDS.includes(id)).sort();
      expect(cloudIds, 'prerequisite: 14 rows are not laptop rows').toHaveLength(14);
      const cloud = ingest(runDateToday(), { dryRun: true });
      expect(cloud.exitCode, `the cloud dry run exits 0: ${cloud.stderr}`).toBe(0);
      expect(requested(cloud), 'the cloud dry run requests the 14 cloud sources').toEqual(cloudIds);
      const laptop = ingest(runDateToday(), { dryRun: true, runner: 'laptop' });
      expect(laptop.exitCode, `the laptop dry run exits 0: ${laptop.stderr}`).toBe(0);
      expect(requested(laptop), 'the laptop dry run requests exactly the two laptop sources').toEqual([...LAPTOP_SOURCE_IDS].sort());

      // When: seed-sources loads a copy with "runner": "elsewhere" on one entry
      const bad = path.join(dir, 'elsewhere.json');
      const copy = JSON.parse(fs.readFileSync(file, 'utf8')) as { sources: Record<string, unknown>[] };
      copy.sources[0] = { ...copy.sources[0], runner: 'elsewhere' };
      fs.writeFileSync(bad, `${JSON.stringify(copy)}\n`);
      const refused = runBackend(['seed-sources', bad]);

      // Then: exit 2, standard error names the runner, and the selection is unchanged
      expect(refused.exitCode, `the copy is refused: ${refused.stderr}`).toBe(2);
      expect(refused.stderr, 'standard error names the runner').toContain('runner');
      expect(requested(ingest(runDateToday(), { dryRun: true })), 'the configured sources are unchanged').toEqual(cloudIds);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
