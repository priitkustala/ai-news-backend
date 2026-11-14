// 41-AC-04a (scenario, @surface-job, project api): priitkustala/ai-news-backend#41, criterion AC-4.
// The job reads the vendor's own news page (source kind page) only when the host's robots file allows
// it: a disallowed page is the source's error of kind robots and is never requested.
// Given the anthropic-news-mirror source is a page source at /pages/blocked/news.html, which the fixture
// robots file disallows, when the run completes, then the source's error is of kind robots, the robots
// file was requested by that run and the page was not.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { requireEnv, runDateToday, runMarker } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { signIn } from '../../support/data';

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
  '41-AC-04a: a page the robots file disallows is the source error robots and is not requested',
  { tag: ['@journey-ingest', '@surface-job', '@story-41'] },
  async ({ request }) => {
    // Given: the mirror source reads a page under the disallowed path
    const run = runMarker();
    const manifest = seed('41-AC-04', run);
    const sourceId = String(manifest.page_source_id);
    expect(sourceId, 'prerequisite: the manifest names the page source').toBe('anthropic-news-mirror');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    signIn('owner');
    const before = await requestLog(request, fixtures);

    // When: the run completes
    const result = ingest(runDateToday());
    expect(result.report?.status, 'prerequisite (1, the run report): the run ends with a recorded status').toMatch(/^(completed|partial|failed)$/);
    const added = addedSince(before, await requestLog(request, fixtures));

    // Then: the source's error is of kind robots; robots was requested; the page was not
    const own = (result.report?.source_errors ?? []).filter((e) => e.source_id === sourceId);
    expect(own.length, 'the page source has one error').toBe(1);
    expect(own[0]?.error ?? '').toMatch(/^robots:/);
    expect(added.filter((entry) => entry.split('?')[0] === '/robots.txt').length, 'the robots file was requested').toBeGreaterThan(0);
    expect(added.filter((entry) => entry.startsWith('/pages/blocked/news.html?') && new URLSearchParams(entry.split('?')[1]).get('run') === run),
      'the disallowed page was not requested').toEqual([]);
  },
);
