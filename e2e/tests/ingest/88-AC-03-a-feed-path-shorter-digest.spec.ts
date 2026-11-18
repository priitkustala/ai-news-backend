// 88-AC-03a (scenario, @surface-job, project api): priitkustala/ai-news-backend#88 (DA-1), criterion AC-3.
// Changed specification: priitkustala/ai-news#191 (DC-1), the report gains its new counts after the six keys.
// The feed path keeps a shorter reply that the page path refuses.
// Given set 55-AC-06 (two items on synthetic article pages; the second, older one already has
// digest_attempts 3) and the stand-in model in mode three (a reply of 704 characters and 3 sentences),
// when the job runs digest once, then the last line is status done, pending 2, stored 1,
// article_skipped 0, invalid 1, the newer item (page path) has no digest and digest_attempts 1, and the
// older item (feed path) holds the 3-sentence reply followed by one space and [...].
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
  '88-AC-03a: digest keeps a shorter reply on the feed path and refuses it on the page path',
  { tag: ['@journey-ingest', '@surface-job', '@story-88'] },
  async ({ request }) => {
    // A job command plus the seed and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(60_000);
    // Given: a pending item and an item with three attempts
    const run = runMarker();
    const manifest = seed('55-AC-06', run);
    const ids = manifest.ids as string[];
    expect(ids.length, 'prerequisite: the set has two items').toBe(2);
    const owner = signIn('owner');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const all = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads the items');
    expect(all.length, 'prerequisite: the owner reads items').toBeGreaterThan(0);
    for (const row of all) {
      expect(String(row.canonical_url).startsWith(`${fixtures}/`), 'prerequisite: every stored item links to the fixture server').toBe(true);
    }
    const reply = await stubReply(request, fixtures, 'three', `${run}-probe`);
    expect(reply.length, 'prerequisite: the stand-in\'s three-sentence reply has 704 characters').toBe(704);

    // When: the job runs digest and the model replies with 3 sentences
    const result = digest({ DIGEST_API_BASE: `${fixtures}/model/three/${run}`, DIGEST_API_KEY: 'stub-key' });

    // Then: the newer item is refused and counts an attempt, the older one is stored with the mark
    expect(result.exitCode, 'digest exits 0').toBe(0);
    expect(result.report, 'the last line is the digest report').toEqual({
      status: 'done', reason: null, pending: 2, stored: 1, article_skipped: 0, invalid: 1,
      stored_page: 0, stored_feed: 1, invalid_none: 0, invalid_link: 0, invalid_length: 0, invalid_sentences: 1, invalid_no_content: 0, given_up: 0, left: 1,
    });
    const newer = expectRows(await readRelation(request, 'items', owner, `id=eq.${ids[0]}`), 'Then');
    expect(newer.length).toBe(1);
    expect(newer[0].digest, 'the newer item\'s refused reply is not stored').toBeNull();
    expect(newer[0].digest_attempts, 'the refused reply counts one attempt').toBe(1);
    const older = expectRows(await readRelation(request, 'items', owner, `id=eq.${ids[1]}`), 'Then');
    expect(older.length).toBe(1);
    expect(older[0].digest, 'the older item holds the shorter reply and the mark').toBe(`${reply} [...]`);
  },
);
