// 37-AC-01a (scenario, @surface-job, project api): priitkustala/ai-news-backend#37, criterion AC-1.
// The backend lists the items whose stored summary is null, empty or shorter than 40 characters after
// trimming, newest first, at most N (default 30), each with its stored canonical address as link; the
// listing writes nothing.
// Given the feed-summary source fixture-stored-summaries with items whose summaries are null, empty, 12
// characters and 200 characters (set 37-AC-01), when summaries-pending runs with no limit and with
// --limit 2, then the null, empty and 12-character items of this run are listed newest first with their
// links and feed texts, the 200-character one is not, --limit 2 prints two lines, and no row of items changed.
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { seed, summariesPending } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf, type Row } from '../../support/data';

// The rows' id, summary and summary_method, sorted by id, as one SHA-256.
function digest(rows: Row[]): string {
  const picked = rows.map((row) => ({ id: row.id, summary: row.summary ?? null, summary_method: row.summary_method ?? null }));
  picked.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return createHash('sha256').update(JSON.stringify(picked)).digest('hex');
}

test(
  '37-AC-01a: summaries-pending lists the items without a usable summary, newest first, and writes nothing',
  { tag: ['@journey-ingest', '@surface-job', '@story-37'] },
  async ({ request }) => {
    // Given: six stored items of the fixture source, with null, empty, 12-character and 200-character summaries
    const run = runMarker();
    const manifest = seed('37-AC-01', run);
    const ids = (manifest.ids ?? {}) as Record<string, string>;
    expect(Object.keys(ids).sort(), 'prerequisite: the manifest names the six items').toEqual(
      ['feed-wins', 'model-kept', 'sum-empty', 'sum-long', 'sum-null', 'sum-short']);
    const owner = signIn('owner');
    const before = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads items');
    const ours = before.filter((row) => titleOf(row).includes(run));
    expect(ours.length, 'prerequisite: the six items of this run are stored').toBe(6);
    const urlOf = new Map(before.map((row) => [String(row.id), row.canonical_url]));

    // When: summaries-pending runs with no limit, then with --limit 2
    const all = summariesPending();
    const two = summariesPending(2);

    // Then: the null, empty and 12-character items and the two without a summary are listed newest first, not the 200-character one
    expect(all.exitCode, 'summaries-pending exits 0').toBe(0);
    const listed = all.rows.filter((row) => String(row.title ?? '').includes(run));
    expect(listed.map((row) => row.id), 'the items of this run without a usable summary, newest first').toEqual(
      [ids['sum-null'], ids['sum-empty'], ids['sum-short'], ids['model-kept'], ids['feed-wins']]);
    expect(all.rows.some((row) => row.id === ids['sum-long']), 'the item with a 200-character summary is not listed').toBe(false);
    for (const row of listed) {
      expect(Object.keys(row), 'each line carries the six fields in order').toEqual(['id', 'title', 'link', 'source_name', 'category', 'feed_text']);
      expect(row.link, 'each line carries the stored canonical address').toBe(urlOf.get(String(row.id)));
      expect(row.source_name, 'each line names the source').toBe('Fixture feed of stored summaries');
    }
    expect(listed[0].feed_text, 'the null summary is listed as null').toBeNull();
    expect(listed[1].feed_text, 'the empty summary is listed as the empty string').toBe('');
    expect(listed[2].feed_text, 'the 12-character summary is listed as it is stored').toBe('Twelve chars');
    // and --limit 2 prints exactly two lines
    expect(two.exitCode, 'summaries-pending --limit 2 exits 0').toBe(0);
    expect(two.stdout.split(/\r?\n/).filter((line) => line.trim() !== '').length, '--limit 2 prints two lines').toBe(2);
    expect(two.rows.length).toBe(2);
    // and no row of items changed: the same count and the same hash of id, summary and summary_method
    const after = expectRows(await readRelation(request, 'items', owner), 'Then');
    expect(after.length, 'the row count of items is unchanged').toBe(before.length);
    expect(digest(after), 'the hash of the summary columns is unchanged').toBe(digest(before));
  },
);
