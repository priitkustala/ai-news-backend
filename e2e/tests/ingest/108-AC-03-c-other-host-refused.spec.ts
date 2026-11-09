// 108-AC-03c (scenario, @surface-job, project api): priitkustala/ai-news#108, criterion AC-3.
// Approved settlement 47 of 2026-11-09: an HTTP 301 or 308 is followed, at most two redirects, only to
// the configured host (a leading www. aside) and never to a lower scheme; every other redirect stays the
// source's failure (B-03).
// Given a feed address that answers HTTP 301 with a target on another host and a feed that succeeds, when the run completes, then the case source's error starts http-301: and ends redirects are not followed, the feed that succeeds is served, and the redirect target was never requested.
import { test, expect } from '@playwright/test';
import { requireEnv, runDateToday, runMarker } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf } from '../../support/data';

test(
  '108-AC-03c: a run refuses a permanent redirect to another host as the failure of the source',
  { tag: ['@journey-ingest', '@surface-job', '@story-108'] },
  async ({ request }) => {
    // Given: a feed address that answers HTTP 301 with a target on another host, and a feed that succeeds
    const run = runMarker();
    const manifest = seed('108-AC-03c', run);
    const caseSource = String(manifest.case_source_id);
    const caseId = String(manifest.case_id);
    const okSource = String(manifest.ok_source_id);
    expect(caseSource !== 'undefined' && caseId !== 'undefined' && okSource !== 'undefined', 'prerequisite: the manifest names the case source, its id and the ok source').toBe(true);
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const owner = signIn('owner');

    // When: the run completes
    const result = ingest(runDateToday());

    // Then: the case source's error starts http-301: and ends redirects are not followed, the feed that succeeds is served, and the redirect target was never requested
    const errors = result.report?.source_errors ?? [];
    const caseError = String(errors.find((e) => e.source_id === caseSource)?.error ?? '');
    expect(caseError.startsWith('http-301:'), `the redirected source fails with http-301 (${caseError})`).toBe(true);
    expect(caseError.endsWith('redirects are not followed'), `the failure ends redirects are not followed (${caseError})`).toBe(true);
    expect(errors.filter((e) => e.source_id === okSource), 'the feed that succeeds has no error').toEqual([]);
    const feed = expectRows(await readRelation(request, 'feed', owner), 'Then');
    expect(feed.filter((row) => row.source_id === okSource && titleOf(row).includes(run)).length,
      'an item of the feed that succeeds is served').toBeGreaterThan(0);
    const log = await request.get(`${fixtures}/requests`);
    expect(log.status(), 'the fixture server answers its request log').toBe(200);
    const requests = ((await log.json()) as { requests?: string[] }).requests ?? [];
    expect(requests.filter((entry) => {
      const query = new URLSearchParams(entry.split('?')[1] ?? '');
      return query.get('target') === caseId && (query.get('run') ?? '').startsWith(run);
    }), 'the redirect target was never requested in this run').toEqual([]);
  },
);
