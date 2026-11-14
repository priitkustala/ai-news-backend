// 55-AC-06a (scenario, @surface-job, project api): priitkustala/ai-news-backend#55, criterion AC-6.
// An item that has used its three attempts is neither read nor sent again.
// Given set 55-AC-06 (two items on synthetic article pages; the second, older one already has
// digest_attempts 3) and the stand-in model in mode valid, when the job runs digest, then pending is 1
// and stored 1, the stand-in recorded 1 call whose user content's title is the first item's, the second
// item keeps digest_attempts 3 and no digest, and the fixture server logged no read of its page.
import { test, expect } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { digest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

type Call = { n: number; body: { messages?: { role?: string; content?: string }[] } };

test(
  '55-AC-06a: digest neither reads nor sends an item with three attempts',
  { tag: ['@journey-ingest', '@surface-job', '@story-55'] },
  async ({ request }) => {
    // A job command plus the seed and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(60_000);
    // Given: a pending item and an item with three attempts
    const run = runMarker();
    const manifest = seed('55-AC-06', run);
    const ids = manifest.ids as string[];
    const links = manifest.links as string[];
    expect(ids.length, 'prerequisite: the set has two items').toBe(2);
    const owner = signIn('owner');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const all = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads the items');
    expect(all.length, 'prerequisite: the owner reads items').toBeGreaterThan(0);
    for (const row of all) {
      expect(String(row.canonical_url).startsWith(`${fixtures}/`), 'prerequisite: every stored item links to the fixture server').toBe(true);
    }
    const first = all.find((row) => row.id === ids[0]);
    const secondPath = new URL(links[1]).pathname;
    const readsOfSecond = (entries: string[]) => entries.filter((entry) => entry.startsWith(secondPath)).length;
    const logBefore = await request.get(`${fixtures}/requests`);
    expect(logBefore.status(), 'prerequisite: the fixture server answers its request log').toBe(200);
    const before = readsOfSecond(((await logBefore.json()) as { requests?: string[] }).requests ?? []);

    // When: the job runs digest
    const result = digest({ DIGEST_API_BASE: `${fixtures}/model/valid/${run}`, DIGEST_API_KEY: 'stub-key' });

    // Then: only the first item is read, sent and stored
    expect(result.exitCode, 'digest exits 0').toBe(0);
    expect(result.report, 'the last line is the digest report').toEqual({
      status: 'done', reason: null, pending: 1, stored: 1, article_skipped: 0, invalid: 0,
    });
    const record = await request.get(`${fixtures}/model-calls/${run}`);
    expect(record.status(), 'the stand-in answers its record').toBe(200);
    const calls = ((await record.json()) as { calls: Call[] }).calls;
    expect(calls.length, 'one model call').toBe(1);
    const user = calls[0].body.messages?.find((message) => message.role === 'user');
    expect((JSON.parse(String(user?.content)) as { title?: string }).title, 'the call is the first item\'s').toBe(first?.title);
    const rows = expectRows(await readRelation(request, 'items', owner, `id=eq.${ids[1]}`), 'Then');
    expect(rows.length).toBe(1);
    expect(rows[0].digest_attempts, 'the second item keeps three attempts').toBe(3);
    expect(rows[0].digest, 'the second item has no digest').toBeNull();
    const logAfter = await request.get(`${fixtures}/requests`);
    expect(logAfter.status(), 'the fixture server answers its request log').toBe(200);
    expect(readsOfSecond(((await logAfter.json()) as { requests?: string[] }).requests ?? []) - before, 'the second item\'s page was not read')
      .toBe(0);
  },
);
