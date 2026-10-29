// AC-21a (scenario, @surface-data, project api): story 45, coverage.md row AC-21 a.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-21; the Given/When/Then is the owning story's row AC-21a.
// Given a completed run, when the owner reads the ingestion_runs table, then it returns the last run date and
// status.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  'AC-21a: the ingestion_runs table returns the last run date and status',
  { tag: ['@journey-read-feed', '@surface-data', '@story-45'] },
  async ({ request }) => {
    // Given: a completed run for today's run date, made by the job and not by the seed: the
    // fixture set loads the fixture feeds and earlier completed runs only, so the bootstrap
    // seed cannot satisfy the Then (round 19 F1)
    const run = runMarker();
    seed('AC-21a', run);
    const runDate = runDateToday();
    const owner = signIn('owner');
    const before = expectRows(await readRelation(request, 'ingestion_runs', owner, `run_date=eq.${runDate}`), 'prerequisite: ingestion_runs is in the exposed schema');
    expect(before, 'prerequisite: no run recorded for today before the job runs').toEqual([]);
    const result = ingest(runDate);
    // The first failing step after #40 is a prerequisite that 1 provides, not 45's own:
    // the job records the run and reports it completed (the run recording of B-21; 1 Code
    // touchpoints). Once 1 is built nothing 45 provides is left for this data row, so it
    // can pass before 45: there is no owner-only red here, and the ownership is the owner's
    // decision at the gate (pull-requests.md, Conflicts for the orchestrator, C-2)
    expect(result.report?.run_date, 'prerequisite (1, the run report; ownership conflict C-2): the run report names today').toBe(runDate);
    expect(result.report?.status, 'prerequisite (1, the run report; ownership conflict C-2): the run completed').toBe('completed');

    // When: the owner reads the ingestion_runs table
    const runs = expectRows(await readRelation(request, 'ingestion_runs', owner), 'Then');

    // Then: it returns the last run date and status
    const latest = [...runs].sort((a, b) => String(b.run_date).localeCompare(String(a.run_date)))[0];
    expect(latest?.run_date).toBe(runDate);
    expect(latest?.status).toBe('completed');
  },
);
