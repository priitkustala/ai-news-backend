// 55-AC-06a (scenario, @surface-job, project api): priitkustala/ai-news-backend#55, criterion AC-6.
// Changed specification: priitkustala/ai-news-backend#88 (DA-1), the owner decisions of 2026-11-16 (workspace Decisions rows 769 and 775).
// Changed specification: priitkustala/ai-news#191 (DC-1), the report gains its new counts after the six keys.
// An item that has used its three attempts is not read again, and gets its digest from the feed text (#88 AC-2).
// Given set 55-AC-06 (two items on synthetic article pages; the second, older one already has
// digest_attempts 3) and the stand-in model in mode valid, when the job runs digest, then pending is 2,
// stored 2, article_skipped 0 and invalid 0, the stand-in recorded 2 calls, the first (the newer item's)
// with its page's text and the second (the older item's) with article_text null, the newer item's
// digest is the reply with no mark, the older item's digest is the reply followed by one space and
// [...] and it keeps digest_attempts 3, and the fixture server logged no read of the older item's page.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { digest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

type Call = { n: number; body: { messages?: { role?: string; content?: string }[] } };

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
  '55-AC-06a: digest does not read the page of an item with three attempts and stores its digest from the feed text',
  { tag: ['@journey-ingest', '@surface-job', '@story-55', '@story-88'] },
  async ({ request }) => {
    // A job command plus the seed and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(60_000);
    // Given: a pending item and an item with three attempts
    const run = runMarker();
    const manifest = seed('55-AC-06', run);
    const ids = manifest.ids as string[];
    const links = manifest.links as string[];
    expect(ids.length, 'prerequisite: the set has two items').toBe(2);
    const owner = signIn('owner');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const all = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads the items');
    expect(all.length, 'prerequisite: the owner reads items').toBeGreaterThan(0);
    for (const row of all) {
      expect(String(row.canonical_url).startsWith(`${fixtures}/`), 'prerequisite: every stored item links to the fixture server').toBe(true);
    }
    const first = all.find((row) => row.id === ids[0]);
    const second = all.find((row) => row.id === ids[1]);
    const reply = await stubReply(request, fixtures, 'valid', `${run}-probe`);
    const secondPath = new URL(links[1]).pathname;
    const readsOfSecond = (entries: string[]) => entries.filter((entry) => entry.startsWith(secondPath)).length;
    const logBefore = await request.get(`${fixtures}/requests`);
    expect(logBefore.status(), 'prerequisite: the fixture server answers its request log').toBe(200);
    const before = readsOfSecond(((await logBefore.json()) as { requests?: string[] }).requests ?? []);

    // When: the job runs digest
    const result = digest({ DIGEST_API_BASE: `${fixtures}/model/valid/${run}`, DIGEST_API_KEY: 'stub-key' });

    // Then: both items stored, the older one from the feed text with the mark and its page not read
    expect(result.exitCode, 'digest exits 0').toBe(0);
    expect(result.report, 'the last line is the digest report').toEqual({
      status: 'done', reason: null, pending: 2, stored: 2, article_skipped: 0, invalid: 0,
      stored_page: 1, stored_feed: 1, invalid_none: 0, invalid_link: 0, invalid_length: 0, invalid_sentences: 0, invalid_no_content: 0, given_up: 0, left: 0,
    });
    const record = await request.get(`${fixtures}/model-calls/${run}`);
    expect(record.status(), 'the stand-in answers its record').toBe(200);
    const calls = ((await record.json()) as { calls: Call[] }).calls;
    expect(calls.length, 'two model calls').toBe(2);
    const inputs = calls.map((call) =>
      JSON.parse(String(call.body.messages?.find((message) => message.role === 'user')?.content)) as { title?: string; article_text?: unknown });
    expect(inputs[0].title, 'the first call is the newer item\'s').toBe(first?.title);
    expect(typeof inputs[0].article_text, 'the newer item is sent with its page\'s text').toBe('string');
    expect(inputs[1].title, 'the second call is the older item\'s').toBe(second?.title);
    expect(inputs[1].article_text, 'the older item is sent without article text').toBeNull();
    const newer = expectRows(await readRelation(request, 'items', owner, `id=eq.${ids[0]}`), 'Then');
    expect(newer.length).toBe(1);
    expect(newer[0].digest, 'the newer item holds the reply with no mark').toBe(reply);
    const rows = expectRows(await readRelation(request, 'items', owner, `id=eq.${ids[1]}`), 'Then');
    expect(rows.length).toBe(1);
    expect(rows[0].digest, 'the older item holds the reply and the mark').toBe(`${reply} [...]`);
    expect(rows[0].digest_attempts, 'the older item keeps three attempts').toBe(3);
    const logAfter = await request.get(`${fixtures}/requests`);
    expect(logAfter.status(), 'the fixture server answers its request log').toBe(200);
    expect(readsOfSecond(((await logAfter.json()) as { requests?: string[] }).requests ?? []) - before, 'the second item\'s page was not read')
      .toBe(0);
  },
);
