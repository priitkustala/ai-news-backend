// 36-AC-03b (scenario, @surface-job, project api): priitkustala/ai-news-backend#36, criterion AC-3.
// Approved settlement 51 of 2026-11-09: seed-sources deletes every configured source and inserts the
// rows of the file, so the next run requests the file's sources only.
// Given the base seed with the 40g set, whose dry run requests a source of the base seed, and a synthetic
// list of two sources, when seed-sources runs with that list and then a dry run, then seed-sources exits 0
// and the dry run requests exactly the two sources of the list.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { requireEnv, runDateToday, runMarker } from '../../support/env';
import { runBackend } from '../../support/backend';
import { ingest, seed } from '../../support/job';

test(
  '36-AC-03b: seed-sources replaces the configured sources, so a dry run requests only the list',
  { tag: ['@journey-ingest', '@surface-job', '@story-36'] },
  async ({}) => {
    // Given: the base seed with the 40g set, whose dry run requests a source of the base seed
    const run = runMarker();
    const manifest = seed('40g', run);
    const seeded = (manifest.source_ids as string[] | undefined) ?? [];
    const before = ingest(runDateToday(), { dryRun: true });
    const beforeIds = (before.report?.requests ?? []).map((r) => r.source_id);
    expect(beforeIds.some((id) => seeded.includes(id)), 'prerequisite: the dry run requests a source of the base seed').toBe(true);

    // and a synthetic list of two sources on the fixture feed server
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ai-news-36-${run}-`));
    try {
      const file = path.join(dir, 'sources.json');
      fs.writeFileSync(file, `${JSON.stringify({ sources: [
        { id: 'staging-check-a', name: 'staging-check-a (fixture)', feed_url: `${fixtures}/feeds/ok.xml?run=${run}`,
          source_type: 'feed', default_categories: ['releases'], display_policy: 'feed-summary', source_weight: 1 },
        { id: 'staging-check-b', name: 'staging-check-b (fixture)', feed_url: `${fixtures}/feeds/ok.xml?run=${run}-b`,
          source_type: 'feed', default_categories: ['releases'], display_policy: 'feed-summary', source_weight: 1 },
      ] }, null, 2)}\n`);

      // When: seed-sources runs with that list, then a dry run
      const result = runBackend(['seed-sources', file]);
      const after = ingest(runDateToday(), { dryRun: true });

      // Then: seed-sources exits 0 and the dry run requests exactly the two sources
      expect(result.exitCode, `seed-sources exits 0: ${result.stderr}`).toBe(0);
      expect((after.report?.requests ?? []).map((r) => r.source_id).sort(), 'the dry run requests exactly the two sources')
        .toEqual(['staging-check-a', 'staging-check-b']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
