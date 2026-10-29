// AC-03e (scenario, @surface-job, project api): story 47, coverage.md row AC-03 e.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-03; the Given/When/Then is the owning story's row AC-03e.
// Given seeded hostile fixtures with an item linking to a non-configured host, when the run completes, then
// the job log shows no request to any host outside the configured feed list.
import { test, expect } from '@playwright/test';
import { requireEnv, runDateToday, runMarker } from '../../support/env';
import { ingest, seed } from '../../support/job';

test(
  'AC-03e: the job log shows no request to a host outside the configured feed list',
  { tag: ['@journey-ingest', '@surface-job', '@story-47'] },
  async ({}) => {
    // Given: a fixture item linking to a host that is not in the configured feed list
    const run = runMarker();
    seed('AC-03e', run);
    const configuredHost = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).host;

    // When: the run completes
    const result = ingest(runDateToday());

    // Then: the job log lists its requests and none goes to a host outside the configured feed list
    const requests = result.report?.requests ?? [];
    expect(requests.length, 'prerequisite (1, the run report): the job log lists the requests it made').toBeGreaterThan(0);
    expect(requests.filter((entry) => entry.host !== configuredHost)).toEqual([]);
  },
);
