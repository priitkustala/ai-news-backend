// 55-AC-01a (scenario, @surface-job, project api): priitkustala/ai-news-backend#55, criterion AC-1.
// The items carry the model's digest columns and the feed carries the digest as its last column.
// Given a database migrated to 0017 and set 55-AC-01 (one item of the fixture digest source), when the
// owner reads items selecting digest, digest_method and digest_attempts and a visitor without a sign-in
// reads one row of feed, then both reads answer 200 and digest is the last key of the feed row.
import { test, expect } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { seed } from '../../support/job';
import { dataUrl, signIn } from '../../support/data';

test(
  '55-AC-01a: the items carry the digest columns and the feed ends with digest',
  { tag: ['@journey-ingest', '@surface-job', '@story-55'] },
  async ({ request }) => {
    // Given: the set's one item, and the owner's session
    const run = runMarker();
    seed('55-AC-01', run);
    const owner = signIn('owner');
    const key = requireEnv('E2E_PUBLISHABLE_KEY', 'the local publishable key of the local Supabase interface');

    // When: the owner reads the digest columns of items
    const items = await request.get(`${dataUrl()}/items?select=digest,digest_method,digest_attempts`, {
      headers: { apikey: key, Authorization: `Bearer ${owner}` },
    });

    // Then: the columns exist
    expect(items.status(), 'the owner reads digest, digest_method and digest_attempts of items').toBe(200);
    const itemRows = (await items.json()) as Record<string, unknown>[];
    expect(itemRows.length, 'prerequisite: the set\'s item is read').toBeGreaterThan(0);
    expect(Object.keys(itemRows[0]), 'the item row carries exactly the selected columns').toEqual(['digest', 'digest_method', 'digest_attempts']);

    // When: a visitor without a sign-in reads one row of the feed
    const feed = await request.get(`${dataUrl()}/feed?select=*&limit=1`, { headers: { apikey: key } });

    // Then: digest is the feed's last column, readable without a sign-in
    expect(feed.status(), 'the visitor reads the feed').toBe(200);
    const feedRows = (await feed.json()) as Record<string, unknown>[];
    expect(feedRows.length, 'prerequisite: the feed shows the set\'s item').toBe(1);
    const keys = Object.keys(feedRows[0]);
    expect(keys[keys.length - 1], 'digest is the last column of the feed').toBe('digest');
  },
);
