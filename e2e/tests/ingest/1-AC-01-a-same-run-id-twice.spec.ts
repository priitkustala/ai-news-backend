// AC-01a (scenario, @surface-job, project api): story 1, coverage.md row AC-01 a.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-01; the Given/When/Then is the owning story's row AC-01a.
// Given the seeded fixture feeds and no run for today's run date, when the job ingest is started twice for
// today's run date, then the second start reports the same run id, ingestion_runs shows today's run date with
// status completed, and the item count equals the count after the first start.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  'AC-01a: a second ingest start for today reports the same run id and changes nothing',
  { tag: ['@journey-ingest', '@surface-job', '@story-1'] },
  async ({ request }) => {
    // Given: the seeded fixture feeds and no run for today's run date
    const run = runMarker();
    seed('AC-01a', run);
    const runDate = runDateToday();
    const owner = signIn('owner');
    const none = expectRows(await readRelation(request, 'ingestion_runs', owner, `run_date=eq.${runDate}`), 'prerequisite: ingestion_runs is in the exposed schema');
    expect(none, 'prerequisite: no run for today (the seed resets the run records, round 19 F6)').toEqual([]);

    // When: the job ingest is started twice for today's run date
    const first = ingest(runDate);
    const itemsAfterFirst = expectRows(await readRelation(request, 'items', owner), 'the items after the first start');
    const second = ingest(runDate);

    // Then: the second start reports the same run id, ingestion_runs read through the data
    // interface shows today's run date with status completed, and the item count is unchanged
    expect(first.report?.run_id, 'the first start reports a run id').toBeTruthy();
    expect(second.report?.run_id).toBe(first.report?.run_id);
    const runs = expectRows(await readRelation(request, 'ingestion_runs', owner), 'Then');
    expect(runs.filter((row) => row.run_date === runDate && row.status === 'completed')).toHaveLength(1);
    const itemsAfterSecond = expectRows(await readRelation(request, 'items', owner), 'Then');
    expect(itemsAfterSecond.length).toBe(itemsAfterFirst.length);
  },
);
