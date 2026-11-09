// 36-AC-03d (scenario, @surface-job, project api): priitkustala/ai-news-backend#36, criterion AC-3.
// Approved settlement 51 of 2026-11-09: seed-sources parses the file as draw-sample does and refuses a bad
// file with its usage error before any connection, changing nothing.
// Given the base seed with the 40g set and three bad files (not JSON, an empty sources list, an id that
// appears twice), when seed-sources runs with each, then each exits 2 and its standard error names the
// file's problem (exit 2 alone is also an unknown command before the command exists: the words count), and
// a dry run afterwards requests the same sources as before.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { runDateToday, runMarker } from '../../support/env';
import { runBackend } from '../../support/backend';
import { ingest, seed } from '../../support/job';

test(
  '36-AC-03d: seed-sources refuses a malformed sources file with exit 2 and changes nothing',
  { tag: ['@journey-ingest', '@surface-job', '@story-36'] },
  async ({}) => {
    // Given: the base seed with the 40g set, the sources its dry run requests, and three bad files
    const run = runMarker();
    seed('40g', run);
    const before = ingest(runDateToday(), { dryRun: true });
    const beforeIds = (before.report?.requests ?? []).map((r) => r.source_id).sort();
    expect(beforeIds.length, 'prerequisite: the dry run requests the seeded sources').toBeGreaterThan(0);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ai-news-36-${run}-`));
    try {
      const row = (id: string) => ({ id, name: `${id} (fixture)`, feed_url: `http://example.invalid/${id}.xml`,
        source_type: 'feed', default_categories: ['releases'], display_policy: 'feed-summary', source_weight: 1 });
      const cases = [
        { name: 'not-json.json', body: '{ "sources": [', problem: 'is not JSON' },
        { name: 'empty.json', body: `${JSON.stringify({ sources: [] })}\n`, problem: 'non-empty list' },
        { name: 'twice.json', body: `${JSON.stringify({ sources: [row('staging-check-a'), row('staging-check-a')] })}\n`, problem: 'appears twice' },
      ];
      for (const c of cases) fs.writeFileSync(path.join(dir, c.name), c.body);

      for (const c of cases) {
        // When: seed-sources runs with the bad file
        const result = runBackend(['seed-sources', path.join(dir, c.name)]);

        // Then: exit 2 and standard error names the file's problem
        expect(result.exitCode, `${c.name}: ${result.stderr}`).toBe(2);
        expect(result.stderr, `${c.name}: standard error names the problem`).toContain(c.problem);
      }

      // and a dry run afterwards requests the same sources as before
      const after = ingest(runDateToday(), { dryRun: true });
      expect((after.report?.requests ?? []).map((r) => r.source_id).sort(), 'the configured sources are unchanged').toEqual(beforeIds);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
