// 55-AC-12a (scenario, @surface-job, project api): priitkustala/ai-news-backend#55, criterion AC-12.
// Changed specification: priitkustala/ai-news#191 (DC-1), the report gains its new counts after the six keys.
// A vendor error stops the run; the digests stored before it stay, and the failed item's attempt is not
// counted.
// Given set 55-AC-12 (three pending items on synthetic article pages) and the stand-in model in mode
// fail401second (its second call answers HTTP 401), when the job runs digest, then it exits 0 with status
// stopped, reason http-401 and stored 1, the stand-in recorded 2 calls, the newest item holds the
// digest, and the second and third items hold digest_attempts 0 and no digest.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { digest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

// The stand-in's reply of a mode, asked once under a key of its own (the calls of `run` stay untouched).
async function stubReply(request: APIRequestContext, fixtures: string, mode: string, key: string): Promise<string> {
  const response = await request.post(`${fixtures}/model/${mode}/${key}/chat/completions`, {
    headers: { Authorization: 'Bearer stub-key', 'Content-Type': 'application/json' },
    data: { model: 'gpt-6-luna', messages: [] },
  });
  expect(response.status(), 'prerequisite: the stand-in answers').toBe(200);
  const content = ((await response.json()) as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
  expect(typeof content, 'prerequisite: the stand-in answers a text').toBe('string');
  return content as string;
}

test(
  '55-AC-12a: a vendor error stops digest and keeps the earlier digest',
  { tag: ['@journey-ingest', '@surface-job', '@story-55'] },
  async ({ request }) => {
    // A job command plus the seed and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(60_000);
    // Given: three pending items
    const run = runMarker();
    const manifest = seed('55-AC-12', run);
    const ids = manifest.ids as string[];
    expect(ids.length, 'prerequisite: the set has three items').toBe(3);
    const owner = signIn('owner');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const all = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads the items');
    expect(all.length, 'prerequisite: the owner reads items').toBeGreaterThan(0);
    for (const row of all) {
      expect(String(row.canonical_url).startsWith(`${fixtures}/`), 'prerequisite: every stored item links to the fixture server').toBe(true);
    }
    const reply = await stubReply(request, fixtures, 'valid', `${run}-probe`);

    // When: the job runs digest and the model's second call answers 401
    const result = digest({ DIGEST_API_BASE: `${fixtures}/model/fail401second/${run}`, DIGEST_API_KEY: 'stub-key' });

    // Then: stopped after the first item
    expect(result.exitCode, 'digest exits 0').toBe(0);
    expect(result.report, 'the last line is the stopped report').toEqual({
      status: 'stopped', reason: 'http-401', pending: 3, stored: 1, article_skipped: 0, invalid: 0,
      stored_page: 1, stored_feed: 0, invalid_none: 0, invalid_link: 0, invalid_length: 0, invalid_sentences: 0, invalid_no_content: 0, given_up: 0, left: 2,
    });
    const record = await request.get(`${fixtures}/model-calls/${run}`);
    expect(record.status(), 'the stand-in answers its record').toBe(200);
    expect(((await record.json()) as { calls: unknown[] }).calls.length, 'two model calls').toBe(2);
    const rows = expectRows(await readRelation(request, 'items', owner, `id=in.(${ids.join(',')})`), 'Then');
    const byId = (id: string) => rows.find((row) => row.id === id);
    expect(byId(ids[0])?.digest, 'the newest item holds the digest').toBe(reply);
    for (const id of ids.slice(1)) {
      expect(byId(id)?.digest_attempts, 'the stopped run counts no attempt').toBe(0);
      expect(byId(id)?.digest, 'no digest is stored after the stop').toBeNull();
    }
  },
);
