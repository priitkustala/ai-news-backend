// 108-AC-01b (scenario, @surface-job, project api): priitkustala/ai-news#108, criterion AC-1.
// Approved settlement 47 of 2026-11-09: an HTTP 301 or 308 is followed, at most two redirects, only to
// the configured host (a leading www. aside) and never to a lower scheme; every other redirect stays the
// source's failure (B-03).
// Given a feed address that answers HTTP 308 once with a target on the same site and a feed that succeeds, when the run completes, then the case source has no error and its items are served.
import { test, expect } from '@playwright/test';
import { requireEnv, runDateToday, runMarker } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf } from '../../support/data';

test(
  '108-AC-01b: a run follows a permanent redirect (HTTP 308) within the configured site',
  { tag: ['@journey-ingest', '@surface-job', '@story-108'] },
  async ({ request }) => {
    // Given: a feed address that answers HTTP 308 once with a target on the same site, and a feed that succeeds
    const run = runMarker();
    const manifest = seed('108-AC-01b', run);
    const caseSource = String(manifest.case_source_id);
    const caseId = String(manifest.case_id);
    const okSource = String(manifest.ok_source_id);
    expect(caseSource !== 'undefined' && caseId !== 'undefined' && okSource !== 'undefined', 'prerequisite: the manifest names the case source, its id and the ok source').toBe(true);
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const owner = signIn('owner');

    // When: the run completes
    const result = ingest(runDateToday());

    // Then: the case source has no error and its items are served
    const errors = result.report?.source_errors ?? [];
    expect(errors.filter((e) => e.source_id === caseSource), 'the redirected source has no error').toEqual([]);
    const feed = expectRows(await readRelation(request, 'feed', owner), 'Then');
    expect(feed.filter((row) => row.source_id === caseSource && titleOf(row).includes(`${run}-${caseId}`)).length,
      'an item of the redirect target is served').toBeGreaterThan(0);
  },
);
