// 55-AC-04a (scenario, @surface-job, project api): priitkustala/ai-news-backend#55, criterion AC-4.
// Changed specification: priitkustala/ai-news-backend#88 (DA-1), the owner decisions of 2026-11-16 (workspace Decisions rows 769 and 775).
// Changed specification: priitkustala/ai-news#191 (DC-1), the report gains its new counts after the six keys.
// A story whose article page cannot be read gets its digest from the feed text (#88 AC-1 and AC-6).
// Given set 55-AC-04 (four pending items whose pages are disallowed by the fixture robots file, answer
// HTTP 404, answer after 11 seconds, and hold 300 characters of text, in this order), when the job runs
// digest against the stand-in model in mode valid, then the last line is status done, pending 4,
// stored 4, article_skipped 4, invalid 0, the stand-in recorded 4 calls for this run, each with
// article_text null and a system content that asks for professional English for a reader who skips the
// original article, each item's digest is the stand-in's reply followed by one space and [...] with
// digest_method model and digest_attempts 0, and standard error holds 4 lines ending stored (feed only).
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
  '55-AC-04a: digest writes the digest of unreadable article pages from the feed text, with the mark',
  { tag: ['@journey-ingest', '@surface-job', '@story-55', '@story-88'] },
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
    const reply = await stubReply(request, fixtures, 'valid', `${run}-probe`);

    // When: the job runs digest
    const result = digest({ DIGEST_API_BASE: `${fixtures}/model/valid/${run}`, DIGEST_API_KEY: 'stub-key' });

    // Then: every page skipped, every story sent without its page and stored from the feed with the mark
    expect(result.exitCode, 'digest exits 0').toBe(0);
    expect(result.report, 'the last line is the digest report').toEqual({
      status: 'done', reason: null, pending: 4, stored: 4, article_skipped: 4, invalid: 0,
      stored_page: 0, stored_feed: 4, invalid_none: 0, invalid_link: 0, invalid_length: 0, invalid_sentences: 0, invalid_no_content: 0, given_up: 0, left: 0,
    });
    const record = await request.get(`${fixtures}/model-calls/${run}`);
    expect(record.status(), 'the stand-in answers its record').toBe(200);
    const calls = ((await record.json()) as { calls: Call[] }).calls;
    expect(calls.length, 'every story reaches the model').toBe(4);
    for (const call of calls) {
      const messages = call.body.messages ?? [];
      const system = String(messages.find((message) => message.role === 'system')?.content);
      expect(system, 'the instruction asks for professional English').toContain('Write in professional English that is easy to understand');
      expect(system, 'the instruction names the reader who skips the original').toContain('without reading the original article in complex English');
      const input = JSON.parse(String(messages.find((message) => message.role === 'user')?.content)) as Record<string, unknown>;
      expect(input.article_text, 'the call carries no article text').toBeNull();
    }
    const rows = expectRows(await readRelation(request, 'items', owner, `id=in.(${ids.join(',')})`), 'Then');
    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect(row.digest, 'the story holds the reply and the mark').toBe(`${reply} [...]`);
      expect(row.digest_method, 'the digest method is model').toBe('model');
      expect(row.digest_attempts, 'an unreadable page counts no attempt').toBe(0);
    }
    expect(result.stderr.split(/\r?\n/).filter((line) => line.endsWith('stored (feed only)')).length, 'four lines stored (feed only)')
      .toBe(4);
  },
);
