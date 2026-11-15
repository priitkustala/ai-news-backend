// 55-AC-04a (scenario, @surface-job, project api): priitkustala/ai-news-backend#55, criterion AC-4.
// An article page that cannot be read is skipped without a model call, and the attempt is counted.
// Given set 55-AC-04 (four pending items whose pages are disallowed by the fixture robots file, answer
// HTTP 404, answer after 11 seconds, and hold 300 characters of text, in this order), when the job runs
// digest against the stand-in model in mode valid, then the last line is status done, pending 4,
// stored 0, article_skipped 4, invalid 0, the stand-in recorded 0 calls for this run, and each item has
// digest_attempts 1 and no digest.
import { test, expect } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { digest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  '55-AC-04a: digest skips unreadable article pages and counts the attempt',
  { tag: ['@journey-ingest', '@surface-job', '@story-55'] },
  async ({ request }) => {
    // A job command that waits out a 10 second page timeout, plus the seed and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(60_000);
    // Given: four pending items whose pages cannot be read
    const run = runMarker();
    const manifest = seed('55-AC-04', run);
    const ids = manifest.ids as string[];
    expect(ids.length, 'prerequisite: the set has four items').toBe(4);
    const owner = signIn('owner');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const all = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads the items');
    expect(all.length, 'prerequisite: the owner reads items').toBeGreaterThan(0);
    for (const row of all) {
      expect(String(row.canonical_url).startsWith(`${fixtures}/`), 'prerequisite: every stored item links to the fixture server').toBe(true);
    }

    // When: the job runs digest
    const result = digest({ DIGEST_API_BASE: `${fixtures}/model/valid/${run}`, DIGEST_API_KEY: 'stub-key' });

    // Then: every item skipped, no call, one attempt each
    expect(result.exitCode, 'digest exits 0').toBe(0);
    expect(result.report, 'the last line is the digest report').toEqual({
      status: 'done', reason: null, pending: 4, stored: 0, article_skipped: 4, invalid: 0,
    });
    const calls = await request.get(`${fixtures}/model-calls/${run}`);
    expect(calls.status(), 'the stand-in answers its record').toBe(200);
    expect(((await calls.json()) as { calls: unknown[] }).calls.length, 'no item reached the model').toBe(0);
    const rows = expectRows(await readRelation(request, 'items', owner, `id=in.(${ids.join(',')})`), 'Then');
    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect(row.digest_attempts, 'the skipped item counts one attempt').toBe(1);
      expect(row.digest, 'the skipped item has no digest').toBeNull();
    }
  },
);
