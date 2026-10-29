// AC-27c (scenario, @surface-job, project api): story 44, coverage.md row AC-27 c.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-27; the Given/When/Then is the owning story's row AC-27c.
// Given a configuration with no Reddit credentials set and a fixture Reddit listing present on the fixture
// server, when a run completes, then the job log shows no request to the fixture Reddit listing.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';

test(
  'AC-27c: without Reddit credentials the job log shows no request to the fixture Reddit listing',
  { tag: ['@journey-ingest', '@surface-job', '@story-44'] },
  async ({}) => {
    // Given: no Reddit credentials set and a fixture Reddit listing on the fixture server
    const run = runMarker();
    seed('AC-27c', run);

    // When: a run completes
    const result = ingest(runDateToday());

    // Then: the job log lists its requests and none goes to the Reddit listing
    const requests = result.report?.requests ?? [];
    expect(requests.length, 'prerequisite (1, the run report): the job log lists the requests it made').toBeGreaterThan(0);
    expect(requests.filter((entry) => entry.source_type === 'reddit')).toEqual([]);
  },
);
