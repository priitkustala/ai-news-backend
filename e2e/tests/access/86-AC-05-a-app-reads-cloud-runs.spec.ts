// 86-AC-05a (@surface-data, project api): priitkustala/ai-news-backend#86 (LI-1), criterion AC-5.
// The app reads cloud runs only (migration 0018, restrictive read rule ingestion_runs_cloud_read
// for the guest and every signed-in user): a laptop row never makes the feed look fresh when the
// cloud run failed. The client's last-updated read, the owner's read of the run table and the
// categories view's Other share are read through the data interface.
// Given today a failed cloud run and a completed laptop run, and the completed cloud run of an
// earlier date (the 40g set's stale run), when the guest reads the last-updated line, then it gets
// the earlier cloud run; when the owner reads the run table, then no laptop row and today's cloud
// row with runner cloud; and the categories view's Other share is that of the newest cloud run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { runDateToday, runMarker } from '../../support/env';
import { runBackend } from '../../support/backend';
import { ingest, seed } from '../../support/job';
import { committedSources, expectRows, LAPTOP_SOURCE_IDS, readRelation, signIn, writeFixtureSources } from '../../support/data';
import { readSelected } from '../../support/access';

test(
  '86-AC-05a: the guest and the owner read cloud runs only',
  { tag: ['@journey-access', '@surface-data', '@story-86'] },
  async ({ request }) => {
    test.setTimeout(300_000);
    // Given: the 40g set (a completed cloud run of an earlier date), the committed list on the
    // fixture feed server with every cloud source failing, a failed cloud run and a completed laptop run today
    const run = runMarker();
    const manifest = seed('40g', run);
    const earlier = String(manifest.stale_run_date);
    const date = runDateToday();
    expect(earlier < date, 'prerequisite: the stale run is of an earlier date').toBe(true);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ai-news-86-${run}-`));
    try {
      const failing = committedSources().map((s) => s.id).filter((id) => !LAPTOP_SOURCE_IDS.includes(id));
      const { file } = writeFixtureSources(dir, run, failing);
      const loaded = runBackend(['seed-sources', file]);
      expect(loaded.exitCode, `prerequisite: seed-sources exits 0: ${loaded.stderr}`).toBe(0);
      const cloud = ingest(date);
      expect(cloud.report?.status, `prerequisite: today's cloud run fails: ${cloud.stderr}`).toBe('failed');
      const laptop = ingest(date, { runner: 'laptop' });
      expect(laptop.report?.status, `prerequisite: today's laptop run completes: ${laptop.stderr}`).toBe('completed');

      // When: the guest reads the last-updated line as the client does
      const lastUpdated = expectRows(await readSelected(request, 'ingestion_runs', {
        select: 'run_date,ended_at',
        filter: 'status=eq.completed&order=ended_at.desc.nullslast,run_date.desc&limit=1',
      }), 'the guest\'s last-updated read');

      // Then: the earlier cloud run, never today's laptop run
      expect(lastUpdated.map((r) => r.run_date), 'the guest gets the earlier cloud run').toEqual([earlier]);

      // When: the owner reads the run table
      const owner = signIn('owner');
      const runs = expectRows(await readRelation(request, 'ingestion_runs', owner), 'the owner reads ingestion_runs');

      // Then: no laptop row; today's row is the failed cloud run
      expect(runs.filter((r) => r.runner !== 'cloud').map((r) => r.run_date), 'the owner reads no row but cloud rows').toEqual([]);
      expect(runs.filter((r) => r.run_date === date).map((r) => [r.id, r.runner, r.status]), 'today\'s row is the failed cloud run')
        .toEqual([[cloud.report?.run_id, 'cloud', 'failed']]);

      // and the categories view's Other share is that of the newest completed or partial cloud run
      const newest = expectRows(await readSelected(request, 'ingestion_runs', {
        select: 'run_date,other_share',
        filter: 'status=in.(completed,partial)&other_share_window_end=not.is.null&order=run_date.desc&limit=1',
      }), 'the guest reads the newest finished run');
      expect(newest.map((r) => r.run_date), 'the newest finished run the guest reads is the earlier cloud run').toEqual([earlier]);
      const categories = expectRows(await readSelected(request, 'categories', { select: 'id,other_share' }), 'the guest reads categories');
      expect(categories.length, 'prerequisite: the categories view has its rows').toBe(5);
      for (const row of categories) {
        expect(Number(row.other_share), `${String(row.id)}: the Other share is the earlier cloud run's`).toBeCloseTo(Number(newest[0].other_share), 4);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
