// 55-AC-10a (scenario, @surface-job, project api): priitkustala/ai-news-backend#55, criterion AC-10.
// The model receives the item's title, source name, category, feed summary and the article's text, and
// nothing else.
// Given set 55-AC-10 (two pending items on synthetic article pages, the first without a feed summary)
// and the stand-in model in mode valid, when the job runs digest, then the stand-in recorded 2 calls of
// model gpt-6-luna, each with two messages, system then user, the same system content in both, a user
// content that parses to an object with exactly the keys title, source_name, category, feed_summary and
// article_text, and the first item's feed_summary null.
import { test, expect } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { digest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

type Call = { n: number; body: { model?: unknown; reasoning_effort?: unknown; messages?: { role?: string; content?: string }[] } };

test(
  '55-AC-10a: digest sends the model only the item\'s fields and the article\'s text',
  { tag: ['@journey-ingest', '@surface-job', '@story-55'] },
  async ({ request }) => {
    // A job command plus the seed and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(60_000);
    // Given: two pending items, the first without a feed summary
    const run = runMarker();
    const manifest = seed('55-AC-10', run);
    const ids = manifest.ids as string[];
    expect(ids.length, 'prerequisite: the set has two items').toBe(2);
    const owner = signIn('owner');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const all = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads the items');
    expect(all.length, 'prerequisite: the owner reads items').toBeGreaterThan(0);
    for (const row of all) {
      expect(String(row.canonical_url).startsWith(`${fixtures}/`), 'prerequisite: every stored item links to the fixture server').toBe(true);
    }
    const first = all.find((row) => row.id === ids[0]);
    expect(first?.summary, 'prerequisite: the first item has no feed summary').toBeNull();

    // When: the job runs digest
    const result = digest({ DIGEST_API_BASE: `${fixtures}/model/valid/${run}`, DIGEST_API_KEY: 'stub-key' });

    // Then: two calls, each with the five fields only
    expect(result.exitCode, 'digest exits 0').toBe(0);
    const record = await request.get(`${fixtures}/model-calls/${run}`);
    expect(record.status(), 'the stand-in answers its record').toBe(200);
    const calls = ((await record.json()) as { calls: Call[] }).calls;
    expect(calls.length, 'two model calls').toBe(2);
    const inputs = calls.map((call) => {
      expect(call.body.model, 'the model is gpt-6-luna').toBe('gpt-6-luna');
      expect(call.body.reasoning_effort, 'the effort is none').toBe('none');
      const messages = call.body.messages ?? [];
      expect(messages.map((message) => message.role), 'two messages, system then user').toEqual(['system', 'user']);
      const input = JSON.parse(String(messages[1].content)) as Record<string, unknown>;
      expect(Object.keys(input).sort(), 'the input holds exactly the five fields').toEqual(
        ['article_text', 'category', 'feed_summary', 'source_name', 'title'],
      );
      return { system: messages[0].content, input };
    });
    expect(inputs[1].system, 'the system content is the same constant in both calls').toBe(inputs[0].system);
    expect(inputs[0].input.title, 'the first call is the first item\'s').toBe(first?.title);
    expect(inputs[0].input.feed_summary, 'the first item\'s feed summary is null').toBeNull();
  },
);
