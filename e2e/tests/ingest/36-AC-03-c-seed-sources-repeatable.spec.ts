// 36-AC-03c (scenario, @surface-job, project api): priitkustala/ai-news-backend#36, criterion AC-3.
// Approved settlement 51 of 2026-11-09: seed-sources is safe to run again.
// Given the base seed with the 40g set and a synthetic list of two sources, when seed-sources runs twice
// with that list, then both runs exit 0, their output lines are equal and a dry run requests exactly the
// two sources of the list.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { requireEnv, runDateToday, runMarker } from '../../support/env';
import { lastJsonObject, runBackend } from '../../support/backend';
import { ingest, seed } from '../../support/job';

test(
  '36-AC-03c: seed-sources run twice with the same list gives the same result',
  { tag: ['@journey-ingest', '@surface-job', '@story-36'] },
  async ({}) => {
    // Given: the base seed with the 40g set and a synthetic list of two sources on the fixture feed server
    const run = runMarker();
    seed('40g', run);
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

      // When: seed-sources runs twice with that list
      const first = runBackend(['seed-sources', file]);
      const second = runBackend(['seed-sources', file]);

      // Then: both exit 0, the two output lines are equal and a dry run requests exactly the two sources
      expect([first.exitCode, second.exitCode], `seed-sources exits 0 twice: ${first.stderr} ${second.stderr}`).toEqual([0, 0]);
      expect(lastJsonObject(second.stdout), 'the two output lines are equal').toEqual(lastJsonObject(first.stdout));
      const after = ingest(runDateToday(), { dryRun: true });
      expect((after.report?.requests ?? []).map((r) => r.source_id).sort(), 'the dry run requests exactly the two sources')
        .toEqual(['staging-check-a', 'staging-check-b']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
