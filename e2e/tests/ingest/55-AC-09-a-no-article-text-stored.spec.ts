// 55-AC-09a (scenario, @surface-job, project api): priitkustala/ai-news-backend#55, criterion AC-9.
// Nothing of the article's own text is stored or logged; only the model's text is.
// Given set 55-AC-09 (one pending item whose synthetic article page holds the string <run>-1-marker once)
// and the stand-in model in mode valid, when the job runs digest, then it stores 1 digest, the marker
// is in no row of the owner's read of all items with all columns, and in neither the command's standard
// output nor its standard error.
import { test, expect } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { digest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

const occurrences = (text: string, marker: string) => text.split(marker).length - 1;

test(
  '55-AC-09a: digest stores no text of the article and logs none',
  { tag: ['@journey-ingest', '@surface-job', '@story-55'] },
  async ({ request }) => {
    // A job command plus the seed and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(60_000);
    // Given: one pending item whose page carries the marker
    const run = runMarker();
    const manifest = seed('55-AC-09', run);
    const links = manifest.links as string[];
    expect(links.length, 'prerequisite: the set has one item').toBe(1);
    const owner = signIn('owner');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const all = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads the items');
    expect(all.length, 'prerequisite: the owner reads items').toBeGreaterThan(0);
    for (const row of all) {
      expect(String(row.canonical_url).startsWith(`${fixtures}/`), 'prerequisite: every stored item links to the fixture server').toBe(true);
    }
    const marker = `${run}-1-marker`;
    const page = await request.get(links[0]);
    expect(page.status(), 'prerequisite: the article page answers').toBe(200);
    expect(occurrences(await page.text(), marker), 'prerequisite: the article page holds the marker once').toBe(1);

    // When: the job runs digest
    const result = digest({ DIGEST_API_BASE: `${fixtures}/model/valid/${run}`, DIGEST_API_KEY: 'stub-key' });

    // Then: one digest stored, the marker nowhere
    expect(result.exitCode, 'digest exits 0').toBe(0);
    expect(result.report?.stored, 'one digest is stored').toBe(1);
    const rows = expectRows(await readRelation(request, 'items', owner), 'Then');
    expect(rows.length, 'the owner reads every item').toBeGreaterThan(0);
    for (const row of rows) {
      expect(occurrences(JSON.stringify(row), marker), 'no column of the row holds the marker').toBe(0);
    }
    expect(occurrences(result.stdout, marker), 'standard output does not hold the marker').toBe(0);
    expect(occurrences(result.stderr, marker), 'standard error does not hold the marker').toBe(0);
  },
);
