// AC-01b (scenario, @surface-job, project api): story 1, coverage.md row AC-01 b.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-01; the Given/When/Then is the owning story's row AC-01b.
// Given a run date with no completed run, when a later trigger on the same date starts the job, then the run
// for that date completes.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  'AC-01b: a later trigger on the same date completes the run for that date',
  { tag: ['@journey-ingest', '@surface-job', '@story-1'] },
  async ({ request }) => {
    // Given: today's run date has a run that did not complete (the fixture set records it)
    const run = runMarker();
    seed('AC-01b', run);
    const runDate = runDateToday();
    const owner = signIn('owner');
    const earlier = expectRows(await readRelation(request, 'ingestion_runs', owner, `run_date=eq.${runDate}`), 'prerequisite: the owner reads ingestion_runs');
    expect(earlier.length, 'prerequisite: a run for today is recorded').toBeGreaterThan(0);
    expect(earlier.filter((row) => row.status === 'completed'), 'prerequisite: none of them completed').toEqual([]);

    // When: a later trigger on the same date starts the job
    const later = ingest(runDate);

    // Then: the run for that date completes
    expect(later.report?.run_date).toBe(runDate);
    expect(later.report?.status).toBe('completed');
    const runs = expectRows(await readRelation(request, 'ingestion_runs', owner), 'Then');
    expect(runs.filter((row) => row.run_date === runDate && row.status === 'completed')).toHaveLength(1);
  },
);
