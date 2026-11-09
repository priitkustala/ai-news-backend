// 47-AC-2 (@surface-data, project api): priitkustala/ai-news-backend#47 (S-21a), criterion AC-2.
// The guest reads only the columns of ingestion_runs the client's last-updated line reads; the
// per-source error text stays the owner's alone.
// Given no sign-in, when ingestion_runs is read selecting the last-updated columns, then a row
// returns; when it is read with select=* or its per-source error column, then the read is refused
// (401 or 403) and no row returns.
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { seed } from '../../support/job';
import { describeRead, expectRows, signIn } from '../../support/data';
import { LAST_UPDATED_SELECT, readSelected } from '../../support/access';

test(
  '47-AC-2: without a sign-in the last-updated columns of ingestion_runs return a row; the whole row and the error text are refused',
  { tag: ['@journey-access', '@surface-data', '@story-47'] },
  async ({ request }) => {
    // The seed and the sign-in run as commands and take tens of seconds on the local stack
    test.setTimeout(120_000);
    // Given: no sign-in; the owner reads a completed run of the fixture set
    const run = runMarker();
    seed('AC-20a', run);
    const owner = signIn('owner');
    const completed = expectRows(
      await readSelected(request, 'ingestion_runs', { token: owner, filter: 'status=eq.completed' }),
      'prerequisite: the owner reads ingestion_runs',
    );
    expect(completed.length, 'prerequisite: the fixture set holds a completed run').toBeGreaterThan(0);

    // When: ingestion_runs is read as the client's last-updated line reads it, with no session
    const lastUpdated = await readSelected(request, 'ingestion_runs', {
      select: LAST_UPDATED_SELECT,
      filter: 'status=eq.completed&order=ended_at.desc.nullslast,run_date.desc',
    });
    // Then: a row returns
    const rows = expectRows(lastUpdated, 'the guest\'s last-updated read');
    expect(rows.length, 'the guest\'s last-updated read returns a row').toBeGreaterThan(0);

    // When: ingestion_runs is read whole, and its per-source error column alone, with no session
    const whole = await readSelected(request, 'ingestion_runs');
    const errors = await readSelected(request, 'ingestion_runs', { select: 'source_errors' });
    // Then: each is refused by authorization and returns no row
    expect([401, 403], `select=* is refused (${describeRead(whole)})`).toContain(whole.status);
    expect(whole.rows, 'select=* returns no row').toEqual([]);
    expect([401, 403], `select=source_errors is refused (${describeRead(errors)})`).toContain(errors.status);
    expect(errors.rows, 'select=source_errors returns no row').toEqual([]);
  },
);
