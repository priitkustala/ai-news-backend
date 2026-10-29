// AC-20b (invariant, @surface-data, project api): story 43, coverage.md row AC-20 b.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-20; the Given/When/Then is the owning story's row AC-20b. Kind invariant (sprint-02.md
// section 2.3, amendment 01, AD-01): passes once #40 is built and after every later story.
// Given a session of a second synthetic user, when any table or view of the exposed schema is read or written
// with the publishable key, then no item, bookmark or run row is returned and every write is refused.
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { seed } from '../../support/job';
import { describeRead, expectRows, signIn } from '../../support/data';
import { changeRefused, insertRefused, isRefusedOrEmpty, probeAccess } from '../../support/access';

test(
  'AC-20b: with a second synthetic user session no row is returned and every write is refused',
  { tag: ['@journey-access', '@surface-data', '@story-43'] },
  async ({ request }) => {
    // Given: a session of the second synthetic user; the owner's session holds a row in every
    // declared relation of the exposed schema (support/access.ts) and observes the effect
    const run = runMarker();
    seed('AC-20b', run);
    const owner = signIn('owner');
    const SESSION = signIn('second-user');

    // When: every declared table and view is read, and written with a relation-valid payload
    // unique to this run, with the publishable key and the second user's session
    const probes = await probeAccess(request, owner, SESSION, run);

    // Then: no row is returned and every write is refused: each insert by authorization (401 or
    // 403, not a malformed-input answer) and leaving no row; no update or delete changes the
    // owner's target row (row-level security may answer 2xx with no affected row)
    expect(probes.length, 'every declared relation is probed').toBeGreaterThan(0);
    for (const p of probes) {
      expect(p.read.status, `${p.relation} is in the exposed schema`).not.toBe(404);
      expect(p.read.malformed, `${p.relation}: the answer is not a malformed list`).toBe(false);
      expect(isRefusedOrEmpty(p.read), `${p.relation}: no row is returned (${describeRead(p.read)})`).toBe(true);
      expect(insertRefused(p), `${p.relation}: insert refused (${p.insert.status} ${p.insert.body.slice(0, 200)})`).toBe(true);
      expect(expectRows(p.inserted, `${p.relation}: the owner's readback after the insert`), `${p.relation}: the refused insert left no row`).toEqual([]);
      expect(changeRefused(p, p.update), `${p.relation}: update refused (${p.update.status})`).toBe(true);
      expect(changeRefused(p, p.remove), `${p.relation}: delete refused (${p.remove.status})`).toBe(true);
      expect(expectRows(p.after, `${p.relation}: the owner's readback of the target row`), `${p.relation}: the owner's target row is unchanged`).toEqual([p.target]);
    }
  },
);
