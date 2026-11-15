// 55-AC-08a (scenario, @surface-job, project api): priitkustala/ai-news-backend#55, criterion AC-8.
// An ingest never changes a stored digest: a copy that wins under B-07 with a new feed summary replaces
// the summary and leaves the digest as it was.
// Given <run>-kept of set 55-AC-08 with no summary and a stored digest (digest_method model), and the
// fixture feed digest-kept.xml delivering the same item with a 100-character description, earlier than
// the stored copy at the same source weight (so the copy wins), when today's run date is ingested once,
// then the owner reads the item with the feed's summary and summary_method feed (the copy won), with
// the same digest and digest_method model, and the fixture server logged that the ingest requested this
// run's feed.
import { test, expect } from '@playwright/test';
import { requireEnv, runDateToday, runMarker } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { dataUrl, signIn } from '../../support/data';

test(
  '55-AC-08a: an ingest whose copy wins keeps the stored digest',
  { tag: ['@journey-ingest', '@surface-job', '@story-55'] },
  async ({ request }) => {
    // An ingest of about ten seconds plus the seed and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(90_000);
    // Given: <run>-kept stored with a digest and no summary
    const run = runMarker();
    const manifest = seed('55-AC-08', run);
    const id = String(manifest.id);
    const stored = String(manifest.digest);
    expect(id, 'prerequisite: the manifest names the item').toMatch(/^[0-9a-f]{64}$/);
    const owner = signIn('owner');
    const key = requireEnv('E2E_PUBLISHABLE_KEY', 'the local publishable key of the local Supabase interface');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const read = async () => {
      const response = await request.get(`${dataUrl()}/items?select=id,summary,summary_method,digest,digest_method&id=eq.${id}`, {
        headers: { apikey: key, Authorization: `Bearer ${owner}` },
      });
      expect(response.status(), 'the owner reads the item with its digest columns').toBe(200);
      return (await response.json()) as Record<string, unknown>[];
    };
    const given = await read();
    expect(given.map((row) => [row.summary, row.digest, row.digest_method]), 'prerequisite: the item holds the stored digest and no summary')
      .toEqual([[null, stored, 'model']]);
    const ourFeed = (entries: string[]) => entries.filter((entry) =>
      entry.startsWith('/feeds/digest-kept.xml?') && new URLSearchParams(entry.split('?')[1] ?? '').get('run') === run).length;
    const logBefore = await request.get(`${fixtures}/requests`);
    expect(logBefore.status(), 'prerequisite: the fixture server answers its request log').toBe(200);
    const requestedBefore = ourFeed(((await logBefore.json()) as { requests?: string[] }).requests ?? []);

    // When: today's run date is ingested (a new run date: the base seed's last run is older)
    const run1 = ingest(runDateToday());
    expect(run1.report?.status, 'prerequisite: the run completes').toMatch(/^(completed|partial)$/);
    const logAfter = await request.get(`${fixtures}/requests`);
    expect(logAfter.status(), 'prerequisite: the fixture server answers its request log').toBe(200);
    const requestedAfter = ourFeed(((await logAfter.json()) as { requests?: string[] }).requests ?? []);
    expect(requestedAfter - requestedBefore, 'prerequisite: the ingest requested this run\'s digest-kept.xml').toBeGreaterThan(0);

    // Then: the copy's summary won, and the digest stays
    const after = await read();
    expect(after.length).toBe(1);
    expect(after[0].summary, 'the winning copy brought its summary').toBe(manifest.feed_text_100);
    expect(after[0].summary_method, 'the summary is the feed\'s').toBe('feed');
    expect(after[0].digest, 'the stored digest is unchanged').toBe(stored);
    expect(after[0].digest_method, 'the digest method stays model').toBe('model');
  },
);
