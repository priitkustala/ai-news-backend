// 191-AC-1a (scenario, @surface-job, project api): priitkustala/ai-news#191 (DC-1), criterion AC-1.
// One run of the digest step takes every pending story of the day, not only 100 (bug: a day of over
// 100 stories left the rest without a digest).
// Given set 191-AC-1 (150 pending items on synthetic article pages, published 1 to 150 minutes ago)
// and the stand-in model in mode valid, when the job runs digest once, then it exits 0 and reports
// status done, pending 150, stored 150 and left 0, every item of the set holds a digest, and the last
// line of standard error ends with left 0.
import { test, expect } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { digest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  '191-AC-1a: digest stores a digest for every one of 150 pending items in one run',
  { tag: ['@journey-ingest', '@surface-job', '@bug-191'] },
  async ({ request }) => {
    // A job command of 150 items plus the seed and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(120_000);
    // Given: 150 pending items
    const run = runMarker();
    const manifest = seed('191-AC-1', run);
    const ids = manifest.ids as string[];
    expect(ids.length, 'prerequisite: the set has 150 items').toBe(150);
    const owner = signIn('owner');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const all = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads the items');
    expect(all.length, 'prerequisite: the owner reads the set\'s items').toBe(150);
    for (const row of all) {
      expect(String(row.canonical_url).startsWith(`${fixtures}/`), 'prerequisite: every stored item links to the fixture server').toBe(true);
      expect(row.digest, 'prerequisite: no item has a digest yet').toBeNull();
    }

    // When: the job runs digest once
    const result = digest({ DIGEST_API_BASE: `${fixtures}/model/valid/${run}`, DIGEST_API_KEY: 'stub-key' });

    // Then: every item is taken and stored, nothing is left
    expect(result.exitCode, 'digest exits 0').toBe(0);
    expect(result.report?.status, 'the run reports done').toBe('done');
    expect(result.report?.pending, 'the run takes all 150 items').toBe(150);
    expect(result.report?.stored, 'the run stores 150 digests').toBe(150);
    expect(result.report?.left, 'nothing is left pending').toBe(0);
    const after = expectRows(await readRelation(request, 'items', owner), 'Then');
    expect(after.filter((row) => ids.includes(String(row.id)) && row.digest !== null).length, 'every item of the set holds a digest').toBe(150);
    const lines = result.stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    expect(lines[lines.length - 1], 'the last line of standard error ends with left 0').toMatch(/, left 0$/);
  },
);
