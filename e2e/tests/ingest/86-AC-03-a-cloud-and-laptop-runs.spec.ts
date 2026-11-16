// 86-AC-03a (scenario, @surface-job, project api): priitkustala/ai-news-backend#86 (LI-1), criterion AC-3.
// A run names its runner: the cloud run (no flag) fetches the sources marked cloud, a laptop run
// (--runner laptop) of the same date fetches only the two laptop sources and writes its own run
// row; one lock per run date and runner, so neither start is held by the other. The owner reads
// the run table through the data interface, where only cloud rows are visible (AC-5).
// Given the committed list on the fixture feed server, when ingest D runs and then ingest D
// --runner laptop, then the first completes with the 14 cloud ids requested and its row has runner
// cloud, the second completes as a run of its own with exactly the two laptop ids requested,
// neither reports another start running, and the cloud form started again returns the completed
// cloud run with nothing fetched (and the laptop form its own completed run of that date).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { runDateToday, runMarker } from '../../support/env';
import { lastJsonObject, runBackend } from '../../support/backend';
import { ingest, seed } from '../../support/job';
import { expectRows, LAPTOP_SOURCE_IDS, readRelation, signIn, writeFixtureSources } from '../../support/data';

const requested = (result: ReturnType<typeof ingest>) => [...new Set((result.report?.requests ?? []).map((r) => r.source_id))].sort();

test(
  '86-AC-03a: a cloud run and a laptop run of one date each fetch the sources of their runner and complete',
  { tag: ['@journey-ingest', '@surface-job', '@story-86'] },
  async ({ request }) => {
    test.setTimeout(300_000);
    // Given: the base seed with the 40g set and the committed list on the fixture feed server
    const run = runMarker();
    seed('40g', run);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ai-news-86-${run}-`));
    try {
      const { file, sources } = writeFixtureSources(dir, run);
      for (const id of LAPTOP_SOURCE_IDS) {
        expect(sources.find((s) => s.id === id)?.runner, `prerequisite: ${id} is a row marked laptop`).toBe('laptop');
      }
      const loaded = runBackend(['seed-sources', file]);
      expect(loaded.exitCode, `prerequisite: seed-sources exits 0: ${loaded.stderr}`).toBe(0);
      expect(lastJsonObject(loaded.stdout)?.count, 'prerequisite: 16 sources').toBe(16);
      const cloudIds = sources.map((s) => s.id).filter((id) => !LAPTOP_SOURCE_IDS.includes(id)).sort();
      const date = runDateToday();

      // When: the cloud form runs
      const cloud = ingest(date);

      // Then: completed, the 14 cloud ids requested and neither laptop id
      expect(cloud.exitCode, `the cloud run exits 0: ${cloud.stderr}`).toBe(0);
      expect(cloud.report?.status, 'the cloud run completes').toBe('completed');
      expect(requested(cloud), 'the cloud run requests the 14 cloud sources').toEqual(cloudIds);
      expect(cloud.log, 'the cloud start reports no other start').not.toContain('another start');

      // When: the laptop form runs on the same date
      const laptop = ingest(date, { runner: 'laptop' });

      // Then: completed, a run of its own, exactly the two laptop ids requested
      expect(laptop.exitCode, `the laptop run exits 0: ${laptop.stderr}`).toBe(0);
      expect(laptop.report?.status, 'the laptop run completes').toBe('completed');
      expect(requested(laptop), 'the laptop run requests exactly the two laptop sources').toEqual([...LAPTOP_SOURCE_IDS].sort());
      expect(laptop.report?.run_id, 'the laptop run is a run of its own').toBeTruthy();
      expect(laptop.report?.run_id, 'the laptop run is not the cloud run').not.toBe(cloud.report?.run_id);
      expect(laptop.log, 'the laptop start reports no other start').not.toContain('another start');

      // and the owner reads one row of that date, the cloud run, with runner cloud
      const owner = signIn('owner');
      const rows = expectRows(await readRelation(request, 'ingestion_runs', owner, `run_date=eq.${date}`), 'the owner reads the runs of the date');
      expect(rows.map((r) => [r.id, r.runner, r.status]), 'the cloud run row has runner cloud').toEqual([[cloud.report?.run_id, 'cloud', 'completed']]);

      // When: the cloud form starts again
      const again = ingest(date);

      // Then: the completed cloud run with nothing fetched
      expect(again.exitCode, `the cloud start again exits 0: ${again.stderr}`).toBe(0);
      expect(again.report?.run_id, 'the same cloud run').toBe(cloud.report?.run_id);
      expect(again.report?.status, 'still completed').toBe('completed');
      expect(again.report?.requests ?? [], 'nothing fetched').toEqual([]);

      // and the laptop form started again returns its own completed run row of that date, nothing fetched
      const laptopAgain = ingest(date, { runner: 'laptop' });
      expect(laptopAgain.exitCode, `the laptop start again exits 0: ${laptopAgain.stderr}`).toBe(0);
      expect(laptopAgain.report?.run_id, 'the same laptop run').toBe(laptop.report?.run_id);
      expect(laptopAgain.report?.status, 'the laptop run row is completed').toBe('completed');
      expect(laptopAgain.report?.requests ?? [], 'nothing fetched by the laptop start again').toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
