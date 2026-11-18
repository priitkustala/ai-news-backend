// 88-AC-08a (scenario, @surface-job, project api): priitkustala/ai-news-backend#88 (DA-1), criterion AC-8.
// Changed specification: priitkustala/ai-news#191 (DC-1), the report gains its new counts after the six keys.
// A story of a reddit source never has its page read (workspace Decisions row 774): it gets its digest
// from the feed text at once.
// Given set 88-AC-08 (one pending story of the reddit source r/artificial, linking to a synthetic
// article page of the fixture server) and the stand-in model in mode valid, when the job runs digest
// once, then the last line is status done, pending 1, stored 1, article_skipped 0, invalid 0, the
// fixture server logged no read of the story's page, the stand-in recorded 1 call with article_text
// null, the story's digest is the reply followed by one space and [...], and standard error holds one
// line ending stored (feed only).
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
  '88-AC-08a: digest never reads the page of a reddit story and stores its digest from the feed text',
  { tag: ['@journey-ingest', '@surface-job', '@story-88'] },
  async ({ request }) => {
    // A job command plus the seed and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(60_000);
    // Given: one pending story of a reddit source
    const run = runMarker();
    const manifest = seed('88-AC-08', run);
    const ids = manifest.ids as string[];
    const links = manifest.links as string[];
    expect(ids.length, 'prerequisite: the set has one item').toBe(1);
    const owner = signIn('owner');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const all = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads the items');
    expect(all.length, 'prerequisite: the owner reads items').toBeGreaterThan(0);
    for (const row of all) {
      expect(String(row.canonical_url).startsWith(`${fixtures}/`), 'prerequisite: every stored item links to the fixture server').toBe(true);
    }
    const reply = await stubReply(request, fixtures, 'valid', `${run}-probe`);
    const pagePath = new URL(links[0]).pathname;
    const readsOfPage = (entries: string[]) => entries.filter((entry) => entry.startsWith(pagePath)).length;
    const logBefore = await request.get(`${fixtures}/requests`);
    expect(logBefore.status(), 'prerequisite: the fixture server answers its request log').toBe(200);
    const before = readsOfPage(((await logBefore.json()) as { requests?: string[] }).requests ?? []);

    // When: the job runs digest
    const result = digest({ DIGEST_API_BASE: `${fixtures}/model/valid/${run}`, DIGEST_API_KEY: 'stub-key' });

    // Then: the page is not read, the story is sent without article text and stored with the mark
    expect(result.exitCode, 'digest exits 0').toBe(0);
    expect(result.report, 'the last line is the digest report').toEqual({
      status: 'done', reason: null, pending: 1, stored: 1, article_skipped: 0, invalid: 0,
      stored_page: 0, stored_feed: 1, invalid_none: 0, invalid_link: 0, invalid_length: 0, invalid_sentences: 0, invalid_no_content: 0, given_up: 0, left: 0,
    });
    const logAfter = await request.get(`${fixtures}/requests`);
    expect(logAfter.status(), 'the fixture server answers its request log').toBe(200);
    expect(readsOfPage(((await logAfter.json()) as { requests?: string[] }).requests ?? []) - before, 'the reddit story\'s page was not read')
      .toBe(0);
    const record = await request.get(`${fixtures}/model-calls/${run}`);
    expect(record.status(), 'the stand-in answers its record').toBe(200);
    const calls = ((await record.json()) as { calls: Call[] }).calls;
    expect(calls.length, 'one model call').toBe(1);
    const input = JSON.parse(String(calls[0].body.messages?.find((message) => message.role === 'user')?.content)) as Record<string, unknown>;
    expect(input.article_text, 'the call carries no article text').toBeNull();
    const rows = expectRows(await readRelation(request, 'items', owner, `id=eq.${ids[0]}`), 'Then');
    expect(rows.length).toBe(1);
    expect(rows[0].digest, 'the story holds the reply and the mark').toBe(`${reply} [...]`);
    expect(result.stderr.split(/\r?\n/).filter((line) => line.endsWith('stored (feed only)')).length, 'one line stored (feed only)')
      .toBe(1);
  },
);
