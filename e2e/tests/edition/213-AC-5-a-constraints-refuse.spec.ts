// 213-AC-5a (@surface-api, project api): priitkustala/ai-news#213 (ED-1), criterion AC-5.
// The approved settlement 159 of 2026-11-24: every story of an edition links its original article and
// carries one of the five category ids of the app; the database refuses any other story by a named
// constraint. Probes in the form of 86-AC-01a, applied with `check-migration` as the migration role
// (the same step as `migrate`, then rolled back, so nothing is kept). Names are unique to the run.
// Given the seed radarnik-edition, when a probe inserts a valid approved edition and then a story
// without original_url, then the insert is refused naming original_url and not-null; when a probe
// inserts a valid approved edition and then a story with the category sport, then the insert is refused
// naming edition_stories_category_check; after each, the published rows are unchanged.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test, expect, type TestInfo } from '@playwright/test';
import { runMarker } from '../../support/env';
import { runBackend, type CommandResult } from '../../support/backend';
import { seed } from '../../support/job';
import { expectRows, readRelation, type Row } from '../../support/data';

function checkMigration(testInfo: TestInfo, name: string, sql: string): CommandResult {
  const file = testInfo.outputPath(`9999_${name}.sql`);
  fs.mkdirSync(testInfo.outputDir, { recursive: true });
  fs.writeFileSync(file, sql);
  return runBackend(['check-migration', file]);
}

// A valid approved edition, then one story of it with the given columns and values.
function probe(run: string, columns: string, values: string): string {
  const id = randomUUID();
  return `insert into public.editions (id, edition_date, status, ticker_lines)\n`
    + `  values ('${id}', '2099-12-31', 'approved', array['${run} probe ticker line']);\n`
    + `insert into public.edition_stories (edition_id, position, title, what_happened, why_it_matters, your_move,\n`
    + `  source_name, published_on, reading_minutes, ${columns})\n`
    + `  values ('${id}', 1, '${run} probe story', 'Synthetic.', 'Synthetic.', 'Synthetic.',\n`
    + `  'Fixture Edition Source', '2099-12-30', 1, ${values});\n`;
}

const RELATIONS = ['edition_published', 'editions', 'edition_stories'];

test(
  '213-AC-5a: a story without original_url or with a category outside the five is refused by its named constraint',
  { tag: ['@journey-edition', '@surface-api', '@story-213'] },
  async ({ request }, testInfo) => {
    // The seed and the probes run as commands and take tens of seconds on the local stack
    test.setTimeout(120_000);
    // Given: the seed radarnik-edition, marked with this run, and the rows the guest reads
    const run = runMarker();
    seed('radarnik-edition', run);
    const before: Record<string, Row[]> = {};
    for (const relation of RELATIONS) {
      before[relation] = expectRows(await readRelation(request, relation), `the guest reads ${relation} before the probes`);
      expect(before[relation].length, `${relation} holds rows before the probes`).toBeGreaterThan(0);
    }
    const name = run.replace(/-/g, '_');

    // When: the migration role inserts a valid edition and a story without original_url
    const noUrl = checkMigration(testInfo, `e213_5u_${name}`, probe(run, 'category', `'research'`));
    // Then: the insert is refused, naming the column original_url and the not-null constraint
    expect(noUrl.stderr, 'the refusal names the column original_url').toContain('"original_url"');
    expect(noUrl.stderr, 'the refusal names the not-null constraint').toContain('not-null');
    expect(noUrl.exitCode, 'check-migration fails on the refused probe').toBe(1);
    for (const relation of RELATIONS) {
      const after = expectRows(await readRelation(request, relation), `the guest reads ${relation} after the first probe`);
      expect(after, `${relation} is unchanged after the first probe`).toEqual(before[relation]);
    }

    // When: the migration role inserts a valid edition and a story with the category sport
    const sport = checkMigration(testInfo, `e213_5c_${name}`,
      probe(run, 'category, original_url', `'sport', 'https://edition.example.test/${run}/probe'`));
    // Then: the insert is refused, naming the constraint edition_stories_category_check
    expect(sport.stderr, 'the refusal names edition_stories_category_check').toContain('edition_stories_category_check');
    expect(sport.exitCode, 'check-migration fails on the refused probe').toBe(1);
    for (const relation of RELATIONS) {
      const after = expectRows(await readRelation(request, relation), `the guest reads ${relation} after the second probe`);
      expect(after, `${relation} is unchanged after the second probe`).toEqual(before[relation]);
    }
  },
);
