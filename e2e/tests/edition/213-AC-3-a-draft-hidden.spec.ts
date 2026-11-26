// 213-AC-3a (@surface-api, project api): priitkustala/ai-news#213 (ED-1), criterion AC-3.
// The approved settlement 159 of 2026-11-24: only an approved edition is ever published; a draft is
// read by no role of the app, signed in or not.
// Given the seed radarnik-edition with a draft edition for the day before yesterday (the Tallinn date),
// when the guest and the signed-in owner read edition_published, editions and edition_stories, then
// yesterday's edition is there for each and no row of the draft is returned by any read.
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { seed } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf } from '../../support/data';

// The Tallinn date offset by whole days from today's, computed as the seed computes it.
function tallinnDay(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tallinn' }).format(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

test(
  '213-AC-3a: the draft edition is hidden from the guest and the owner in the view and both tables',
  { tag: ['@journey-edition', '@surface-api', '@story-213'] },
  async ({ request }) => {
    // The seed and the sign-in run as commands and take tens of seconds on the local stack
    test.setTimeout(120_000);
    // Given: the seed radarnik-edition, marked with this run, and the owner's session
    const run = runMarker();
    seed('radarnik-edition', run);
    const owner = signIn('owner');
    const yesterday = tallinnDay(-1);
    const draft = tallinnDay(-2);

    for (const [who, token] of [['the guest', undefined], ['the owner', owner]] as const) {
      // When: the persona reads edition_published
      const published = expectRows(await readRelation(request, 'edition_published', token), `${who} reads edition_published`);
      // Then: yesterday's edition is present, so an absence below is evidence; no row of the draft date
      expect(published.filter((row) => row.edition_date === yesterday).length, `${who}: yesterday's edition is in edition_published`).toBeGreaterThan(0);
      expect(published.filter((row) => row.edition_date === draft), `${who}: no row of the draft in edition_published`).toEqual([]);

      // When: the persona reads editions
      const editions = expectRows(await readRelation(request, 'editions', token), `${who} reads editions`);
      // Then: yesterday's edition row is present; the draft's is not
      expect(editions.filter((row) => row.edition_date === yesterday).length, `${who}: yesterday's edition is in editions`).toBe(1);
      expect(editions.filter((row) => row.edition_date === draft), `${who}: no row of the draft in editions`).toEqual([]);

      // When: the persona reads edition_stories
      const stories = expectRows(await readRelation(request, 'edition_stories', token), `${who} reads edition_stories`);
      // Then: yesterday's stories are present; none of the draft's
      expect(stories.filter((row) => titleOf(row).startsWith(`${run} yesterday `)).length, `${who}: yesterday's stories are in edition_stories`).toBe(6);
      expect(stories.filter((row) => titleOf(row).startsWith(`${run} draft `)).map(titleOf), `${who}: no story of the draft in edition_stories`).toEqual([]);
    }
  },
);
