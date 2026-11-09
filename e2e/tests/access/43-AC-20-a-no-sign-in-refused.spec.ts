// AC-20a (invariant, @surface-data, project api): story 43, coverage.md row AC-20 a.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-20; the Given/When/Then is the owning story's row AC-20a. Kind invariant (sprint-02.md
// section 2.3, amendment 01, AD-01): passes once #40 is built and after every later story.
// Rewritten by priitkustala/ai-news-backend#47 (S-21a, AC-1, AC-3 and AC-4; the owner's decision of
// 2026-11-09, question 1: rewrite it): the read half changes, the write assertions stay as they were.
// Given no sign-in, when any table or view of the exposed schema is read or written with the publishable key,
// then feed, categories and items return rows, ingestion_runs read with the last-updated columns returns rows,
// bookmarks and push_subscriptions return none, and every write is refused with no owner row changed.
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { seed } from '../../support/job';
import { describeRead, expectRows, readRelation, signIn } from '../../support/data';
import {
  LAST_UPDATED_SELECT,
  NEWS_RELATIONS,
  changeRefused,
  idsOf,
  insertRefused,
  isRefusedOrEmpty,
  probeAccess,
  readSelected,
} from '../../support/access';

test(
  'AC-20a: without a sign-in the news is read, no personal row is returned and every write is refused',
  { tag: ['@journey-access', '@surface-data', '@story-43', '@story-47'] },
  async ({ request }) => {
    // Given: no sign-in (the publishable key only); the owner's session holds a row in every
    // declared relation of the exposed schema (support/access.ts) and observes the effect
    const run = runMarker();
    seed('AC-20a', run);
    const owner = signIn('owner');

    // When: every declared table and view is read, and written with a relation-valid payload
    // unique to this run, with the publishable key and no session
    const probes = await probeAccess(request, owner, undefined, run);

    // Then: feed, categories and items return the news rows, the ones the owner reads; the whole
    // row of ingestion_runs and every row of bookmarks and push_subscriptions are not returned,
    // while ingestion_runs read with the last-updated columns returns rows; every write is
    // refused: each insert by authorization (401 or 403, not a malformed-input answer) and
    // leaving no row; no update or delete changes the owner's target row
    expect(probes.length, 'every declared relation is probed').toBeGreaterThan(0);
    for (const p of probes) {
      expect(p.read.status, `${p.relation} is in the exposed schema`).not.toBe(404);
      expect(p.read.malformed, `${p.relation}: the answer is not a malformed list`).toBe(false);
      if (NEWS_RELATIONS.includes(p.relation)) {
        const rows = expectRows(p.read, `${p.relation}: the news rows read without a sign-in`);
        expect(rows.length, `${p.relation}: the news rows read without a sign-in are more than 0`).toBeGreaterThan(0);
        const ownerRows = expectRows(await readRelation(request, p.relation, owner), `${p.relation}: the owner's read`);
        expect(idsOf(p.relation, rows), `${p.relation}: the read without a sign-in returns the ids the owner reads`).toEqual(idsOf(p.relation, ownerRows));
      } else {
        expect(isRefusedOrEmpty(p.read), `${p.relation}: no row is returned (${describeRead(p.read)})`).toBe(true);
      }
      if (p.relation === 'ingestion_runs') {
        const lastUpdated = expectRows(
          await readSelected(request, 'ingestion_runs', { select: LAST_UPDATED_SELECT }),
          'ingestion_runs: the last-updated columns read without a sign-in',
        );
        expect(lastUpdated.length, 'ingestion_runs: the last-updated columns read without a sign-in return rows').toBeGreaterThan(0);
      }
      expect(insertRefused(p), `${p.relation}: insert refused (${p.insert.status} ${p.insert.body.slice(0, 200)})`).toBe(true);
      expect(expectRows(p.inserted, `${p.relation}: the owner's readback after the insert`), `${p.relation}: the refused insert left no row`).toEqual([]);
      expect(changeRefused(p, p.update), `${p.relation}: update refused (${p.update.status})`).toBe(true);
      expect(changeRefused(p, p.remove), `${p.relation}: delete refused (${p.remove.status})`).toBe(true);
      expect(expectRows(p.after, `${p.relation}: the owner's readback of the target row`), `${p.relation}: the owner's target row is unchanged`).toEqual([p.target]);
    }
  },
);
