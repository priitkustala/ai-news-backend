// 55-AC-07a (scenario, @surface-job, project api): priitkustala/ai-news-backend#55, criterion AC-7.
// Changed specification: priitkustala/ai-news-backend#88 (DA-1), the owner decisions of 2026-11-16 (workspace Decisions rows 769 and 775).
// Changed specification: priitkustala/ai-news#191 (DC-1), the owner report of 2026-11-17 (workspace Decisions rows 769 and 909).
// One run sends every pending item, newest first, each with at most 12000 characters of article text (#88 AC-5).
// Given set 55-AC-07 (105 pending items, published 1 to 105 minutes ago, each on a synthetic article page
// with over 12000 characters of text) and the stand-in model in mode valid, when the job runs digest,
// then pending is 105, the stand-in recorded 105 calls whose titles are the 105 items newest first,
// each call's article_text has at most 12000 characters, and 0 items stay without a digest.
import { test, expect } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { digest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

type Call = { n: number; body: { messages?: { role?: string; content?: string }[] } };

// The visible text of a page's paragraphs (a lower bound of the article text): tags removed, the
// page's entities decoded, white space collapsed.
function paragraphText(html: string): string {
  return (html.match(/<p>[\s\S]*?<\/p>/g) ?? [])
    .map((paragraph) => paragraph.replace(/<[^>]*>/g, ' '))
    .join(' ')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

test(
  '55-AC-07a: digest sends every pending item, newest first, with at most 12000 characters each',
  { tag: ['@journey-ingest', '@surface-job', '@story-55', '@story-88', '@bug-191'] },
  async ({ request }) => {
    // A job command of 105 items plus the seed and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(90_000);
    // Given: 105 pending items on big article pages
    const run = runMarker();
    const manifest = seed('55-AC-07', run);
    const ids = manifest.ids as string[];
    const links = manifest.links as string[];
    expect(ids.length, 'prerequisite: the set has 105 items').toBe(105);
    const owner = signIn('owner');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const all = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads the items');
    expect(all.length, 'prerequisite: the owner reads the set\'s items').toBe(105);
    for (const row of all) {
      expect(String(row.canonical_url).startsWith(`${fixtures}/`), 'prerequisite: every stored item links to the fixture server').toBe(true);
    }
    const newest = [...all]
      .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))
      .map((row) => row.title);
    expect(newest.slice(0, 100), 'prerequisite: the newest 100 are the set\'s first 100').toEqual(
      ids.slice(0, 100).map((id) => all.find((row) => row.id === id)?.title),
    );
    for (const link of links) {
      const page = await request.get(link);
      expect(page.status(), 'prerequisite: the big page answers').toBe(200);
      expect(paragraphText(await page.text()).length, 'prerequisite: the big page has over 12000 characters of text').toBeGreaterThan(12000);
    }

    // When: the job runs digest
    const result = digest({ DIGEST_API_BASE: `${fixtures}/model/valid/${run}`, DIGEST_API_KEY: 'stub-key' });

    // Then: 105 calls, newest first, each cut at 12000 characters
    expect(result.exitCode, 'digest exits 0').toBe(0);
    expect(result.report?.pending, 'the run takes 105 items').toBe(105);
    const record = await request.get(`${fixtures}/model-calls/${run}`);
    expect(record.status(), 'the stand-in answers its record').toBe(200);
    const calls = ((await record.json()) as { calls: Call[] }).calls;
    expect(calls.length, '105 model calls').toBe(105);
    const inputs = calls.map((call) =>
      JSON.parse(String(call.body.messages?.find((message) => message.role === 'user')?.content)) as { title?: string; article_text?: string });
    expect(inputs.map((input) => input.title), 'the calls are the 105 items, newest first').toEqual(newest);
    for (const input of inputs) {
      expect(String(input.article_text).length, 'the article text sent is at most 12000 characters').toBeLessThanOrEqual(12000);
    }
    const after = expectRows(await readRelation(request, 'items', owner), 'Then');
    expect(after.filter((row) => row.digest === null).length, '0 items stay without a digest').toBe(0);
  },
);
