// 108-AC-01c (scenario, @surface-job, project api): priitkustala/ai-news#108, criterion AC-1.
// Approved settlement 47 of 2026-11-09: an HTTP 301 or 308 is followed, at most two redirects, only to
// the configured host (a leading www. aside) and never to a lower scheme; every other redirect stays the
// source's failure (B-03).
// Given a feed address that answers HTTP 301 twice, each target on the same site and a feed that succeeds, when the run completes, then the case source has no error and its items are served, and the fixture server logged both redirect addresses and the target.
import { test, expect } from '@playwright/test';
import { requireEnv, runDateToday, runMarker } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf } from '../../support/data';

test(
  '108-AC-01c: a run follows two permanent redirects within the configured site',
  { tag: ['@journey-ingest', '@surface-job', '@story-108'] },
  async ({ request }) => {
    // Given: a feed address that answers HTTP 301 twice, each target on the same site, and a feed that succeeds
    const run = runMarker();
    const manifest = seed('108-AC-01c', run);
    const caseSource = String(manifest.case_source_id);
    const caseId = String(manifest.case_id);
    const okSource = String(manifest.ok_source_id);
    expect(caseSource !== 'undefined' && caseId !== 'undefined' && okSource !== 'undefined', 'prerequisite: the manifest names the case source, its id and the ok source').toBe(true);
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const owner = signIn('owner');

    // When: the run completes
    const result = ingest(runDateToday());

    // Then: the case source has no error and its items are served, and the fixture server logged both redirect addresses and the target
    const errors = result.report?.source_errors ?? [];
    expect(errors.filter((e) => e.source_id === caseSource), 'the redirected source has no error').toEqual([]);
    const feed = expectRows(await readRelation(request, 'feed', owner), 'Then');
    expect(feed.filter((row) => row.source_id === caseSource && titleOf(row).includes(`${run}-${caseId}`)).length,
      'an item of the redirect target is served').toBeGreaterThan(0);
    const log = await request.get(`${fixtures}/requests`);
    expect(log.status(), 'the fixture server answers its request log').toBe(200);
    const requests = ((await log.json()) as { requests?: string[] }).requests ?? [];
    const ours = requests.filter((entry) => new URLSearchParams(entry.split('?')[1] ?? '').get('run')?.startsWith(run));
    expect(ours.some((entry) => entry.startsWith(`/redirect/301/2/${caseId}?`)), 'the first redirect address was requested').toBe(true);
    expect(ours.some((entry) => entry.startsWith(`/redirect/301/1/${caseId}?`)), 'the second redirect address was requested').toBe(true);
    expect(ours.some((entry) => new URLSearchParams(entry.split('?')[1] ?? '').get('target') === caseId), 'the redirect target was requested').toBe(true);
  },
);
