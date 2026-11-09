// 109-AC-04a (scenario, @surface-job, project api): priitkustala/ai-news#109, criterion AC-4.
// Approved settlement 50 of 2026-11-09 (B-09): a stored summary is at most 1000 characters; a longer one is
// cut after its last sentence end within 1000 characters, or at its last space with one ellipsis.
// Given a feed item with an empty description and a title-link source, when the run completes, then their stored summaries are null.
import { test, expect } from '@playwright/test';
import { requireEnv, runDateToday, runMarker } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf } from '../../support/data';

// The description (plain text) of the fixture item of this run and case, read from the fixture server.
async function descriptionOf(run: string, marker: string): Promise<string> {
  const origin = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
  const response = await fetch(`${origin}/feeds/summary-cut.xml?${new URLSearchParams({ run })}`);
  expect(response.status, 'prerequisite: the fixture server serves summary-cut.xml').toBe(200);
  const xml = await response.text();
  const item = xml.split('<item>').slice(1).find((part) => (part.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').includes(`${run}-${marker} `));
  expect(item, `prerequisite: the feed has the item ${run}-${marker}`).toBeDefined();
  const match = (item as string).match(/<description>([\s\S]*?)<\/description>|<description\s*\/>/);
  return match?.[1] ?? '';
}

test(
  '109-AC-04a: a summary that is absent or empty, or of a title-link source, stays null',
  { tag: ['@journey-ingest', '@surface-job', '@story-109'] },
  async ({ request }) => {
    // Given: a feed-summary source whose item has an empty description, and the mirror source with a title-link policy
    const run = runMarker();
    const manifest = seed('109-AC-04a', run);
    const summarySource = String(manifest.summary_source_id);
    const mirrorSource = String(manifest.mirror_source_id);
    expect(summarySource !== 'undefined' && mirrorSource !== 'undefined' && manifest.case_marker === 'empty', 'prerequisite: the manifest names the summary source, the mirror source and the case').toBe(true);
    const description = await descriptionOf(run, 'empty');
    expect(description.length, 'prerequisite: the description has the length of the case (empty)').toBe(0);
    const owner = signIn('owner');

    // When: the run completes
    const result = ingest(runDateToday());
    expect(result.report?.status, 'prerequisite: the run completes').toMatch(/^(completed|partial)$/);

    // Then: the empty item's summary is null, and so is every mirror item's
    const items = expectRows(await readRelation(request, 'items', owner), 'Then');
    const stored = items.filter((row) => row.source_id === summarySource && titleOf(row).includes(`${run}-empty `));
    expect(stored.length, 'prerequisite: the case item is stored').toBe(1);
    const feed = expectRows(await readRelation(request, 'feed', owner), 'Then');
    const shown = feed.filter((row) => row.source_id === summarySource && titleOf(row).includes(`${run}-empty `));
    expect(shown.length, 'prerequisite: the case item is in the feed view').toBe(1);
    expect(stored[0].summary, 'the empty item is stored with summary null').toBeNull();
    expect(shown[0].summary, 'the feed row shows summary null').toBeNull();
    const mirror = items.filter((row) => row.source_id === mirrorSource);
    expect(mirror.length, 'prerequisite: mirror items are stored').toBeGreaterThan(0);
    for (const row of mirror) expect(row.summary, 'a title-link item is stored with summary null').toBeNull();
  },
);
