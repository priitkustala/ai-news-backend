// 55-AC-02a (scenario, @surface-job, project api): priitkustala/ai-news-backend#55, criterion AC-2.
// The digest command stores the model's valid digest of each pending item.
// Given set 55-AC-02 (three pending items, each linking to a synthetic article page of about 4500
// characters of text on the fixture server) and the stand-in model in mode valid (a 5-sentence,
// 820-character reply), when the job runs digest, then the three rows hold that reply with
// digest_method model and digest_attempts 0, the last line is status done, reason null, pending 3,
// stored 3, article_skipped 0, invalid 0, and the stand-in recorded 3 calls for this run.
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
  '55-AC-02a: digest stores the model\'s valid digest of three pending items',
  { tag: ['@journey-ingest', '@surface-job', '@story-55'] },
  async ({ request }) => {
    // A job command plus the seed and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(60_000);
    // Given: three pending items on the fixture server's article pages
    const run = runMarker();
    const manifest = seed('55-AC-02', run);
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
    expect(reply.length, 'prerequisite: the stand-in\'s valid reply has 820 characters').toBe(820);

    // When: the job runs digest against the stand-in model
    const result = digest({ DIGEST_API_BASE: `${fixtures}/model/valid/${run}`, DIGEST_API_KEY: 'stub-key' });

    // Then: done, three stored, and the rows hold the reply
    expect(result.exitCode, 'digest exits 0').toBe(0);
    expect(result.report, 'the last line is the digest report').toEqual({
      status: 'done', reason: null, pending: 3, stored: 3, article_skipped: 0, invalid: 0,
    });
    expect(Object.keys(result.report ?? {}), 'the report keys are in their order')
      .toEqual(['status', 'reason', 'pending', 'stored', 'article_skipped', 'invalid']);
    const rows = expectRows(await readRelation(request, 'items', owner, `id=in.(${ids.join(',')})`), 'Then');
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.digest, 'the row holds the model\'s digest').toBe(reply);
      expect(row.digest_method, 'the digest method is model').toBe('model');
      expect(row.digest_attempts, 'a stored digest counts no attempt').toBe(0);
    }
    const calls = await request.get(`${fixtures}/model-calls/${run}`);
    expect(calls.status(), 'the stand-in answers its record').toBe(200);
    expect(((await calls.json()) as { calls: unknown[] }).calls.length, 'one model call per item').toBe(3);
  },
);
