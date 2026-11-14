// 55-AC-03a (scenario, @surface-job, project api): priitkustala/ai-news-backend#55, criterion AC-3.
// Without a key the digest command reads nothing and changes nothing.
// Given set 55-AC-03 (two pending items on synthetic article pages) and DIGEST_API_KEY set to the empty
// string, when the job runs digest, then it exits 0 with status skipped and reason no key, the stand-in
// model recorded 0 calls for this run, the fixture server logged no read of this run's article pages,
// and the owner's read of every item's id, digest, digest_method and digest_attempts is unchanged.
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { digest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, type Row } from '../../support/data';

// The rows' digest columns as one SHA-256 of their JSON, sorted by id.
function fingerprint(rows: Row[]): string {
  const projected = rows
    .map((row) => ({ id: row.id, digest: row.digest ?? null, digest_method: row.digest_method ?? null, digest_attempts: row.digest_attempts ?? null }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return createHash('sha256').update(JSON.stringify(projected)).digest('hex');
}

test(
  '55-AC-03a: digest without a key is skipped and changes nothing',
  { tag: ['@journey-ingest', '@surface-job', '@story-55'] },
  async ({ request }) => {
    // A job command plus the seed and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(60_000);
    // Given: two pending items on the fixture server's article pages
    const run = runMarker();
    seed('55-AC-03', run);
    const owner = signIn('owner');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const before = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads the items');
    expect(before.length, 'prerequisite: the owner reads the set\'s items').toBe(2);
    for (const row of before) {
      expect(String(row.canonical_url).startsWith(`${fixtures}/`), 'prerequisite: every stored item links to the fixture server').toBe(true);
    }
    const ourPages = (entries: string[]) => entries.filter((entry) => entry.startsWith('/digest-pages/') && entry.includes(run));
    const logBefore = await request.get(`${fixtures}/requests`);
    expect(logBefore.status(), 'prerequisite: the fixture server answers its request log').toBe(200);
    const pagesBefore = ourPages(((await logBefore.json()) as { requests?: string[] }).requests ?? []).length;

    // When: the job runs digest with an empty key
    const result = digest({ DIGEST_API_BASE: `${fixtures}/model/valid/${run}`, DIGEST_API_KEY: '' });

    // Then: skipped, no call, no page read, no row changed
    expect(result.exitCode, 'digest exits 0').toBe(0);
    expect(result.report, 'the last line is the skipped report').toEqual({
      status: 'skipped', reason: 'no key', pending: 0, stored: 0, article_skipped: 0, invalid: 0,
    });
    const calls = await request.get(`${fixtures}/model-calls/${run}`);
    expect(calls.status(), 'the stand-in answers its record').toBe(200);
    expect(((await calls.json()) as { calls: unknown[] }).calls.length, 'the stand-in received no call').toBe(0);
    const logAfter = await request.get(`${fixtures}/requests`);
    expect(logAfter.status(), 'the fixture server answers its request log').toBe(200);
    expect(ourPages(((await logAfter.json()) as { requests?: string[] }).requests ?? []).length - pagesBefore, 'no article page was read')
      .toBe(0);
    const after = expectRows(await readRelation(request, 'items', owner), 'Then');
    expect(after.length, 'the item count is unchanged').toBe(before.length);
    expect(fingerprint(after), 'no digest column of any row changed').toBe(fingerprint(before));
  },
);
