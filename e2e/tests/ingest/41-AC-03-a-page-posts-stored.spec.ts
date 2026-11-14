// 41-AC-03a (scenario, @surface-job, project api): priitkustala/ai-news-backend#41, criterion AC-3.
// The job reads the vendor's own news page (source kind page): the robots file first, then the page
// once; each post link with a title and a date becomes an item with the title, the link and the date
// only. A rerun of the same date stores no copy.
// Given the anthropic-news-mirror source is a page source whose page (fixtures/pages/news.html) holds
// three dated posts, a post linked twice, an undated post and a non-news link, when the run completes,
// then the source has no error, the owner reads exactly the three posts as items (link on the fixture
// origin, no summary, category releases), the page was requested once and the robots file at least
// once, and a second run of the same date leaves three items.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { requireEnv, runDateToday, runMarker } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, type Row } from '../../support/data';

// The fixture server keeps the last 2000 request paths; the entries an ingest added are those after
// the longest tail of the earlier log that the later log starts with.
function addedSince(before: string[], after: string[]): string[] {
  for (let i = 0; i <= before.length; i += 1) {
    const tail = before.slice(i);
    if (tail.every((entry, k) => after[k] === entry)) return after.slice(tail.length);
  }
  return after;
}

async function requestLog(request: APIRequestContext, fixtures: string): Promise<string[]> {
  const log = await request.get(`${fixtures}/requests`);
  expect(log.status(), 'prerequisite: the fixture server answers its request log').toBe(200);
  return ((await log.json()) as { requests?: string[] }).requests ?? [];
}

test(
  '41-AC-03a: the posts of a news page are stored as items with title, link and date, once',
  { tag: ['@journey-ingest', '@surface-job', '@story-41'] },
  async ({ request }) => {
    // Given: the mirror source reads the fixture news page
    const run = runMarker();
    const manifest = seed('41-AC-03', run);
    const sourceId = String(manifest.page_source_id);
    const titles = (manifest.page_titles as string[] | undefined) ?? [];
    expect(sourceId, 'prerequisite: the manifest names the page source').toBe('anthropic-news-mirror');
    expect(titles.length, 'prerequisite: the manifest names three page titles').toBe(3);
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const owner = signIn('owner');
    const before = await requestLog(request, fixtures);

    // When: the run completes
    const result = ingest(runDateToday());
    expect(result.report?.status, 'prerequisite (1, the run report): the run ends with a recorded status').toMatch(/^(completed|partial|failed)$/);
    const added = addedSince(before, await requestLog(request, fixtures));

    // Then: no error for the source; exactly the three posts as items; the page once, robots at least once
    expect((result.report?.source_errors ?? []).filter((e) => e.source_id === sourceId), 'the page source has no error').toEqual([]);
    const ours = (rows: Row[]) => rows.filter((row) => row.source_id === sourceId && String(row.title ?? '').includes(run));
    const items = ours(expectRows(await readRelation(request, 'items', owner), 'Then'));
    expect(items.map((row) => String(row.title)).sort()).toEqual([...titles].sort());
    const slugs = ['example-model-launch', 'example-research-note', 'example-policy-update'];
    expect(items.map((row) => String(row.canonical_url)).sort()).toEqual(slugs.map((slug) => `${fixtures}/news/${run}-${slug}`).sort());
    for (const row of items) {
      expect(row.summary, 'no summary is stored').toBeNull();
      expect(row.category).toBe('releases');
    }
    const page = added.filter((entry) => entry.startsWith('/pages/news.html?') && new URLSearchParams(entry.split('?')[1]).get('run') === run);
    expect(page.length, 'the page was requested once').toBe(1);
    expect(added.filter((entry) => entry.split('?')[0] === '/robots.txt').length, 'the robots file was requested').toBeGreaterThan(0);

    // And: a second run of the same date leaves the source's items at three
    const again = ingest(runDateToday());
    expect(again.report?.status, 'prerequisite (2, the second run report): the run ends with a recorded status').toMatch(/^(completed|partial|failed)$/);
    expect(ours(expectRows(await readRelation(request, 'items', owner), 'Then (rerun)')).length).toBe(3);
  },
);
