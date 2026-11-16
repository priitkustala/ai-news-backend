// 88-AC-04a (scenario, @surface-job, project api): priitkustala/ai-news-backend#88 (DA-1), criterion AC-4.
// A story on the feed path is tried again on every run until a digest is stored, and the mark is not doubled.
// Given set 55-AC-06 (two items on synthetic article pages; the second, older one already has
// digest_attempts 3), when the job runs digest three times against the stand-in model in modes none,
// valid and valid, then after the first run the older item has digest_attempts 4 and no digest; after
// the second its digest is the valid reply followed by one space and [...], the mark once, and the newer
// item's digest is the reply with no mark; the third run reports pending 0 and stored 0 and leaves both
// digests unchanged.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { digest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

// The stand-in's reply of a mode, asked once under a key of its own (the calls of `run` stay untouched).
async function stubReply(request: APIRequestContext, fixtures: string, mode: string, key: string): Promise<string> {
  const response = await request.post(`${fixtures}/model/${mode}/${key}/chat/completions`, {
    headers: { Authorization: 'Bearer stub-key', 'Content-Type': 'application/json' },
    data: { model: 'gpt-6-luna', messages: [] },
  });
  expect(response.status(), 'prerequisite: the stand-in answers').toBe(200);
  const content = ((await response.json()) as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
  expect(typeof content, 'prerequisite: the stand-in answers a text').toBe('string');
  return content as string;
}

test(
  '88-AC-04a: digest tries a feed-path story again on every run until it is stored, with the mark once',
  { tag: ['@journey-ingest', '@surface-job', '@story-88'] },
  async ({ request }) => {
    // Three job commands plus the seed and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(90_000);
    // Given: a pending item and an item with three attempts
    const run = runMarker();
    const manifest = seed('55-AC-06', run);
    const ids = manifest.ids as string[];
    expect(ids.length, 'prerequisite: the set has two items').toBe(2);
    const owner = signIn('owner');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const all = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads the items');
    expect(all.length, 'prerequisite: the owner reads items').toBeGreaterThan(0);
    for (const row of all) {
      expect(String(row.canonical_url).startsWith(`${fixtures}/`), 'prerequisite: every stored item links to the fixture server').toBe(true);
    }
    const reply = await stubReply(request, fixtures, 'valid', `${run}-probe`);
    const readRow = async (id: string) => {
      const rows = expectRows(await readRelation(request, 'items', owner, `id=eq.${id}`), 'Then');
      expect(rows.length).toBe(1);
      return rows[0];
    };

    // When: the job runs digest and the model answers NONE
    const first = digest({ DIGEST_API_BASE: `${fixtures}/model/none/${run}-1`, DIGEST_API_KEY: 'stub-key' });

    // Then: the older item counts its fourth attempt and has no digest
    expect(first.exitCode, 'the first digest exits 0').toBe(0);
    const olderAfterFirst = await readRow(ids[1]);
    expect(olderAfterFirst.digest_attempts, 'the refused feed-path reply counts a fourth attempt').toBe(4);
    expect(olderAfterFirst.digest, 'the older item has no digest after the first run').toBeNull();

    // When: the job runs digest again and the model answers a valid digest
    const second = digest({ DIGEST_API_BASE: `${fixtures}/model/valid/${run}-2`, DIGEST_API_KEY: 'stub-key' });

    // Then: the older item holds the reply and the mark once, the newer one the reply with no mark
    expect(second.exitCode, 'the second digest exits 0').toBe(0);
    const olderAfterSecond = await readRow(ids[1]);
    expect(olderAfterSecond.digest, 'the older item holds the reply and the mark').toBe(`${reply} [...]`);
    expect(String(olderAfterSecond.digest).split('[...]').length - 1, 'the mark stands once').toBe(1);
    const newerAfterSecond = await readRow(ids[0]);
    expect(newerAfterSecond.digest, 'the newer item holds the reply with no mark').toBe(reply);

    // When: the job runs digest a third time
    const third = digest({ DIGEST_API_BASE: `${fixtures}/model/valid/${run}-3`, DIGEST_API_KEY: 'stub-key' });

    // Then: nothing is pending and both digests stay as they are
    expect(third.exitCode, 'the third digest exits 0').toBe(0);
    expect(third.report?.pending, 'the third run finds nothing pending').toBe(0);
    expect(third.report?.stored, 'the third run stores nothing').toBe(0);
    expect((await readRow(ids[1])).digest, 'the older item\'s digest is unchanged').toBe(`${reply} [...]`);
    expect((await readRow(ids[0])).digest, 'the newer item\'s digest is unchanged').toBe(reply);
  },
);
