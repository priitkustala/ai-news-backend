// 213-AC-1a (@surface-api, project api): priitkustala/ai-news#213 (ED-1), criterion AC-1.
// The approved settlement 159 of 2026-11-24: one dated Radarnik edition a day, published at 07:00
// Europe/Tallinn on its date; the guest role and the signed-in role read only the stories of
// approved editions whose publish time has passed, through the view edition_published.
// Given the seed radarnik-edition and no sign-in (the publishable key only), when the guest reads
// edition_published, then the newest edition returned is yesterday's (the Tallinn date), its rows come
// first and carry its 2 ticker lines and 6 stories in positions 1 to 6 in order, position 1 the lead,
// every title starting with the run marker.
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { seed } from '../../support/job';
import { expectRows, readRelation } from '../../support/data';

// The Tallinn date offset by whole days from today's, computed as the seed computes it.
function tallinnDay(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tallinn' }).format(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

test(
  '213-AC-1a: the guest reads yesterday\'s edition with its two ticker lines and six stories in order',
  { tag: ['@journey-edition', '@surface-api', '@story-213'] },
  async ({ request }) => {
    // The seed runs as a command and takes tens of seconds on the local stack
    test.setTimeout(120_000);
    // Given: the seed radarnik-edition, marked with this run
    const run = runMarker();
    seed('radarnik-edition', run);
    const yesterday = tallinnDay(-1);

    // When: the guest reads edition_published
    const rows = expectRows(await readRelation(request, 'edition_published'), 'the guest reads edition_published');
    expect(rows.length, 'edition_published returns rows to the guest').toBeGreaterThan(0);

    // Then: the newest edition is yesterday's, and its rows come first
    const dates = rows.map((row) => String(row.edition_date));
    expect([...dates].sort().reverse()[0], 'the newest edition returned is yesterday\'s').toBe(yesterday);
    const edition = rows.slice(0, 6);
    expect(edition.map((row) => row.edition_date), 'the first six rows are yesterday\'s').toEqual(Array(6).fill(yesterday));
    expect(dates.filter((date) => date === yesterday).length, 'yesterday\'s edition has 6 stories').toBe(6);
    expect(new Set(edition.map((row) => row.edition_id)).size, 'the six rows are one edition').toBe(1);

    // Then: its 6 stories in positions 1 to 6, in order, position 1 the lead
    expect(edition.map((row) => row.position), 'positions 1 to 6 in order').toEqual([1, 2, 3, 4, 5, 6]);
    expect(String(edition[0].title), 'position 1 is the lead story of yesterday').toMatch(new RegExp(`^${run} yesterday story 1:`));
    for (const row of edition) {
      expect(String(row.title).startsWith(`${run} `), `the title ${String(row.title)} starts with the run marker`).toBe(true);
    }

    // Then: each row carries the edition's 2 ticker lines
    for (const row of edition) {
      expect(row.ticker_lines, `the ticker lines of position ${String(row.position)}`).toEqual([
        `${run} synthetic ticker line 1`,
        `${run} synthetic ticker line 2`,
      ]);
    }
  },
);
