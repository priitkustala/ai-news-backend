// 213-AC-2a (@surface-api, project api): priitkustala/ai-news#213 (ED-1), criterion AC-2.
// The approved settlement 159 of 2026-11-24: an edition publishes at 07:00 Europe/Tallinn on its
// date; before that time no role of the app reads it, through the view or through the tables.
// Given the seed radarnik-edition with an approved edition for tomorrow (the Tallinn date; its publish
// time has not passed) and no sign-in, when the guest reads edition_published and edition_stories, then
// yesterday's edition is there and no row of tomorrow's edition is returned by either read.
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { seed } from '../../support/job';
import { expectRows, readRelation, titleOf } from '../../support/data';

// The Tallinn date offset by whole days from today's, computed as the seed computes it.
function tallinnDay(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tallinn' }).format(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

test(
  '213-AC-2a: tomorrow\'s approved edition is hidden from the guest in the view and in edition_stories',
  { tag: ['@journey-edition', '@surface-api', '@story-213'] },
  async ({ request }) => {
    // The seed runs as a command and takes tens of seconds on the local stack
    test.setTimeout(120_000);
    // Given: the seed radarnik-edition, marked with this run
    const run = runMarker();
    seed('radarnik-edition', run);
    const yesterday = tallinnDay(-1);
    const tomorrow = tallinnDay(1);

    // When: the guest reads edition_published
    const published = expectRows(await readRelation(request, 'edition_published'), 'the guest reads edition_published');
    // Then: yesterday's edition is present, so an absence below is evidence
    expect(published.filter((row) => row.edition_date === yesterday).length, 'yesterday\'s edition is in edition_published').toBeGreaterThan(0);
    // Then: no row of tomorrow's edition
    expect(published.filter((row) => row.edition_date === tomorrow), 'no row of tomorrow\'s edition in edition_published').toEqual([]);

    // When: the guest reads edition_stories directly
    const stories = expectRows(await readRelation(request, 'edition_stories'), 'the guest reads edition_stories');
    // Then: yesterday's stories are present, and none of tomorrow's
    expect(stories.filter((row) => titleOf(row).startsWith(`${run} yesterday `)).length, 'yesterday\'s stories are in edition_stories').toBe(6);
    expect(stories.filter((row) => titleOf(row).startsWith(`${run} tomorrow `)).map(titleOf), 'no story of tomorrow\'s edition in edition_stories').toEqual([]);
  },
);
