// 213-AC-4a (@surface-api, project api): priitkustala/ai-news#213 (ED-1), criterion AC-4.
// The approved settlement 159 of 2026-11-24: the guest role and the signed-in role read published
// editions only; no role of the app inserts, updates or deletes an edition or a story.
// Given the seed radarnik-edition, the guest (no sign-in) and the signed-in owner, when each tries an
// insert, an update and a delete on editions and on edition_stories through the REST interface, then
// every write is refused with an authorization error (401 or 403) and a read after shows the published
// rows, the editions and the stories unchanged in count and content.
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { seed } from '../../support/job';
import { expectRows, isAuthorizationRefusal, readRelation, signIn, writeRelation, type Row } from '../../support/data';

// The Tallinn date offset by whole days from today's, computed as the seed computes it.
function tallinnDay(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tallinn' }).format(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

const RELATIONS = ['edition_published', 'editions', 'edition_stories'];

test(
  '213-AC-4a: every insert, update and delete of the guest and the owner on editions and edition_stories is refused',
  { tag: ['@journey-edition', '@surface-api', '@story-213'] },
  async ({ request }) => {
    // The seed and the sign-in run as commands and take tens of seconds on the local stack
    test.setTimeout(120_000);
    // Given: the seed radarnik-edition, marked with this run, and the owner's session
    const run = runMarker();
    seed('radarnik-edition', run);
    const owner = signIn('owner');
    const yesterday = tallinnDay(-1);

    for (const [who, token] of [['the guest', undefined], ['the owner', owner]] as const) {
      // Given: the rows the persona reads, so an unchanged read after is evidence
      const before: Record<string, Row[]> = {};
      for (const relation of RELATIONS) {
        before[relation] = expectRows(await readRelation(request, relation, token), `${who} reads ${relation} before the writes`);
        expect(before[relation].length, `${who}: ${relation} holds rows before the writes`).toBeGreaterThan(0);
      }
      const edition = before.editions.find((row) => row.edition_date === yesterday);
      expect(edition, `${who}: yesterday's edition is in editions`).toBeDefined();
      const story = before.edition_stories.find((row) => row.edition_id === edition?.id);
      expect(story, `${who}: a story of yesterday's edition is in edition_stories`).toBeDefined();
      const editionFilter = `id=eq.${String(edition?.id)}`;
      const storyFilter = `id=eq.${String(story?.id)}`;

      // When: the persona inserts, updates and deletes on editions and on edition_stories
      const attempts = {
        'insert editions': await writeRelation(request, 'editions', 'POST',
          { edition_date: '2099-12-31', status: 'approved', ticker_lines: [`${run} write`] }, token),
        'insert edition_stories': await writeRelation(request, 'edition_stories', 'POST', {
          edition_id: edition?.id, position: 99, title: `${run} write`, category: 'other',
          what_happened: 'Synthetic write.', why_it_matters: 'Synthetic write.', your_move: 'Synthetic write.',
          source_name: 'Fixture Edition Source', original_url: `https://edition.example.test/${run}/write`,
          published_on: yesterday, reading_minutes: 1,
        }, token),
        'update editions': await writeRelation(request, 'editions', 'PATCH', { status: 'draft' }, token, editionFilter),
        'update edition_stories': await writeRelation(request, 'edition_stories', 'PATCH', { title: `${run} changed` }, token, storyFilter),
        'delete editions': await writeRelation(request, 'editions', 'DELETE', {}, token, editionFilter),
        'delete edition_stories': await writeRelation(request, 'edition_stories', 'DELETE', {}, token, storyFilter),
      };

      // Then: each write is refused with an authorization error
      for (const [name, result] of Object.entries(attempts)) {
        expect(isAuthorizationRefusal(result), `${who}: ${name} is refused with 401 or 403 (got ${result.status}: ${result.body.slice(0, 200)})`).toBe(true);
      }

      // Then: a read after shows every relation unchanged in count and content
      for (const relation of RELATIONS) {
        const after = expectRows(await readRelation(request, relation, token), `${who} reads ${relation} after the writes`);
        expect(after, `${who}: ${relation} is unchanged after the writes`).toEqual(before[relation]);
      }
    }
  },
);
