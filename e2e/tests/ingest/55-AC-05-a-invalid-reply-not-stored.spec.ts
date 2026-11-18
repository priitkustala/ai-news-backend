// 55-AC-05a (scenario, @surface-job, project api): priitkustala/ai-news-backend#55, criterion AC-5
// (end to end for one of its six replies; the validator's unit tests cover all six).
// Changed specification: priitkustala/ai-news#191 (DC-1), the report gains its new counts after the six keys.
// An invalid reply of the model is not stored, and the attempt is counted.
// Given set 55-AC-05 (one pending item on a synthetic article page) and the stand-in model in mode three
// (a reply of 3 sentences), when the job runs digest, then the last line counts stored 0 and invalid 1,
// and the item has digest_attempts 1 and no digest.
import { test, expect } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { digest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  '55-AC-05a: digest does not store an invalid reply and counts the attempt',
  { tag: ['@journey-ingest', '@surface-job', '@story-55'] },
  async ({ request }) => {
    // A job command plus the seed and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(60_000);
    // Given: one pending item
    const run = runMarker();
    const manifest = seed('55-AC-05', run);
    const ids = manifest.ids as string[];
    expect(ids.length, 'prerequisite: the set has one item').toBe(1);
    const owner = signIn('owner');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const all = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads the items');
    expect(all.length, 'prerequisite: the owner reads items').toBeGreaterThan(0);
    for (const row of all) {
      expect(String(row.canonical_url).startsWith(`${fixtures}/`), 'prerequisite: every stored item links to the fixture server').toBe(true);
    }

    // When: the job runs digest and the model replies with 3 sentences
    const result = digest({ DIGEST_API_BASE: `${fixtures}/model/three/${run}`, DIGEST_API_KEY: 'stub-key' });

    // Then: nothing stored, one invalid, one attempt
    expect(result.exitCode, 'digest exits 0').toBe(0);
    expect(result.report, 'the last line is the digest report').toEqual({
      status: 'done', reason: null, pending: 1, stored: 0, article_skipped: 0, invalid: 1,
      stored_page: 0, stored_feed: 0, invalid_none: 0, invalid_link: 0, invalid_length: 0, invalid_sentences: 1, invalid_no_content: 0, given_up: 0, left: 1,
    });
    const rows = expectRows(await readRelation(request, 'items', owner, `id=eq.${ids[0]}`), 'Then');
    expect(rows.length).toBe(1);
    expect(rows[0].digest_attempts, 'the invalid reply counts one attempt').toBe(1);
    expect(rows[0].digest, 'the invalid reply is not stored').toBeNull();
  },
);
