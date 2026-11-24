// 211-AC-3a (scenario, @surface-job, project api): priitkustala/ai-news#211, criterion AC-3.
// Approved settlement 158 of 2026-11-24 (SRC-1): the stored summary is plain text: tags stripped, then
// entities decoded, footnote marks between backslashes removed, rule lines removed, white space folded,
// then cut as today.
// Given an entry whose description is about 1200 characters of plain whole sentences, when the run completes, then the stored summary is cut as today: at most 1000 characters, after its last sentence end within them.
import { test, expect } from '@playwright/test';
import { requireEnv, runDateToday, runMarker } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf } from '../../support/data';

// The description (plain text) of the fixture item of this run and case, read from the fixture server.
async function descriptionOf(run: string, marker: string): Promise<string> {
  const origin = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
  const response = await fetch(`${origin}/feeds/source-markup.xml?${new URLSearchParams({ run })}`);
  expect(response.status, 'prerequisite: the fixture server serves source-markup.xml').toBe(200);
  const xml = await response.text();
  const item = xml.split('<item>').slice(1).find((part) => part.includes(`<title>${run}-${marker} `));
  expect(item, `prerequisite: the feed has the item ${run}-${marker}`).toBeDefined();
  const match = (item as string).match(/<description>([\s\S]*?)<\/description>/);
  expect(match, `prerequisite: the item ${run}-${marker} has a description`).not.toBeNull();
  return (match as RegExpMatchArray)[1];
}

test(
  '211-AC-3a: a plain source summary longer than 1000 characters is cut as today',
  { tag: ['@journey-ingest', '@surface-job', '@story-211'] },
  async ({ request }) => {
    // Given: a feed-summary source whose item has a description of about 1200 characters of plain whole sentences
    const run = runMarker();
    const manifest = seed('211-AC-3a', run);
    const markupSource = String(manifest.markup_source_id);
    const mirrorSource = String(manifest.mirror_source_id);
    expect(markupSource !== 'undefined' && mirrorSource !== 'undefined' && manifest.case_marker === 'plain', 'prerequisite: the manifest names the markup source, the mirror source and the case').toBe(true);
    const description = await descriptionOf(run, 'plain');
    expect(description.length, 'prerequisite: the description is longer than 1000 characters').toBeGreaterThan(1000);
    // The cut of 109-AC-01a: after the last full stop, exclamation mark or question mark followed by a space below index 1000.
    const ends = [...description.slice(0, 1000)].map((c, i) => ({ c, i })).filter(({ c, i }) => '.!?'.includes(c) && description[i + 1] === ' ');
    expect(ends.length, 'prerequisite: the description has a sentence end within 1000 characters').toBeGreaterThan(0);
    const expected = description.slice(0, ends[ends.length - 1].i + 1);
    const owner = signIn('owner');

    // When: the run completes
    const result = ingest(runDateToday());
    expect(result.report?.status, 'prerequisite: the run completes').toMatch(/^(completed|partial)$/);

    // Then: the stored summary is at most 1000 characters and equals the description cut after its last sentence end within them
    const items = expectRows(await readRelation(request, 'items', owner), 'Then');
    const stored = items.filter((row) => row.source_id === markupSource && titleOf(row).includes(`${run}-plain `));
    expect(stored.length, 'prerequisite: the plain item is stored').toBe(1);
    const feed = expectRows(await readRelation(request, 'feed', owner), 'Then');
    const shown = feed.filter((row) => row.source_id === markupSource && titleOf(row).includes(`${run}-plain `));
    expect(shown.length, 'prerequisite: the plain item is in the feed view').toBe(1);
    expect(typeof stored[0].summary, 'prerequisite: the plain item has a stored summary').toBe('string');
    const summary = stored[0].summary as string;
    expect(summary.length, 'the summary is at most 1000 characters').toBeLessThanOrEqual(1000);
    expect(summary, 'the summary is the description cut after its last sentence end within 1000 characters').toBe(expected);
    expect(shown[0].summary, 'the feed row shows the stored summary').toBe(summary);
  },
);
