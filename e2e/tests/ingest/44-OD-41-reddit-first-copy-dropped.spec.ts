// OD-41 (scenario, @surface-job, project api): story 44, repair round 2.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// OD-41 (line 904), the owner's answer "drop" (drop the Reddit post, keep the feed item), and finding
// F-S07-1 of evaluations/ai-news-app/S-07/round-01/S-07.md (the Reddit copy stored first).
// Given a stored item of a Reddit source for an external address, a feed source of the same weight
// whose feed carries that address with a later publication time, and the Reddit listing still
// carrying the post, when the run completes, then the feed view holds one row for the address,
// owned by the feed source and without the Reddit fields. The feed-first order keeps the feed item.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, type Row } from '../../support/data';

function expectFeedOwned(rows: Row[], manifest: Record<string, unknown>) {
  const copies = rows.filter((row) => row.canonical_url === manifest.shared_url);
  expect(copies, 'one row for the address').toHaveLength(1);
  const [row] = copies;
  expect(row.source_type, 'owned by a feed source').toBe('feed');
  expect(row.source_name, 'owned by the feed source').toBe(manifest.feed_source);
  expect(row.title, "the feed's title").toBe(manifest.feed_title);
  expect(row.summary, "the feed's summary").not.toBeNull();
  expect([row.post_url, row.external_url, row.author_handle, row.community], 'no Reddit fields').toEqual([null, null, null, null]);
}

test(
  'OD-41: a feed copy takes over a Reddit post of the same address stored by an earlier run',
  { tag: ['@journey-ingest', '@surface-job', '@story-44'] },
  async ({ request }) => {
    // Given: the Reddit post's external address stored by an earlier run as an item of the
    // Reddit source; a feed source of the same weight whose feed carries that address with a
    // later publication time; this run's listing still carries the post; test Reddit credentials set
    const run = runMarker();
    const manifest = seed('OD-41-reddit-first', run);
    const owner = signIn('owner');
    const before = expectRows(await readRelation(request, 'feed', owner), 'prerequisite: the owner reads the feed view');
    expect(before.filter((row) => row.canonical_url === manifest.shared_url && row.source_type === 'reddit'),
      'prerequisite: the stored Reddit item is in the feed view').toHaveLength(1);

    // When: the run completes
    const result = ingest(runDateToday());

    // Then: one row for the address, owned by the feed source, without the Reddit fields
    expect(result.report?.status, 'prerequisite (1, the run report): the run completes').toMatch(/^(completed|partial)$/);
    expectFeedOwned(expectRows(await readRelation(request, 'feed', owner), 'Then'), manifest);
  },
);

test(
  'OD-41: a stored feed item stays when the Reddit post of the same address comes in later',
  { tag: ['@journey-ingest', '@surface-job', '@story-44'] },
  async ({ request }) => {
    // Given: the same address stored as an item of the feed source; the listing carries the post
    const run = runMarker();
    const manifest = seed('OD-41-feed-first', run);
    const owner = signIn('owner');

    // When: the run completes
    const result = ingest(runDateToday());

    // Then: the feed item stays, without the Reddit fields
    expect(result.report?.status, 'prerequisite (1, the run report): the run completes').toMatch(/^(completed|partial)$/);
    expectFeedOwned(expectRows(await readRelation(request, 'feed', owner), 'Then'), manifest);
  },
);
