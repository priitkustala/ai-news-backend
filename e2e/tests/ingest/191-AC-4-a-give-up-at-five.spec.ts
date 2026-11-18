// 191-AC-4a (scenario, @surface-job, project api): priitkustala/ai-news#191 (DC-1), criterion AC-4.
// An item gives up at 5 attempts: a rejected reply at 4 moves it to 5, and an item at 5 is never picked.
// Given set 191-AC-4 (two items on synthetic article pages; the first with digest_attempts 4, the
// second with digest_attempts 5) and the stand-in model in mode none, when the job runs digest, then
// pending is 1, invalid 1 and invalid_none 1, the stand-in recorded one call, the first item has
// digest_attempts 5, given_up is 2, no line of standard error names the second item, and both digests
// stay null; when the job runs digest again, pending is 0 and the stand-in records no new call.
import { test, expect } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { digest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  '191-AC-4a: digest gives an item up at 5 attempts and never picks it again',
  { tag: ['@journey-ingest', '@surface-job', '@bug-191'] },
  async ({ request }) => {
    // Two job commands plus the seed and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(60_000);
    // Given: an item at 4 attempts and an item at 5
    const run = runMarker();
    const manifest = seed('191-AC-4', run);
    const ids = manifest.ids as string[];
    expect(ids.length, 'prerequisite: the set has two items').toBe(2);
    const owner = signIn('owner');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const readRow = async (id: string) => {
      const rows = expectRows(await readRelation(request, 'items', owner, `id=eq.${id}`), 'Then');
      expect(rows.length).toBe(1);
      return rows[0];
    };
    expect((await readRow(ids[0])).digest_attempts, 'prerequisite: the first item has 4 attempts').toBe(4);
    expect((await readRow(ids[1])).digest_attempts, 'prerequisite: the second item has 5 attempts').toBe(5);
    const calls = async () => {
      const record = await request.get(`${fixtures}/model-calls/${run}`);
      expect(record.status(), 'the stand-in answers its record').toBe(200);
      return ((await record.json()) as { calls: unknown[] }).calls.length;
    };

    // When: the job runs digest and the model answers NONE
    const first = digest({ DIGEST_API_BASE: `${fixtures}/model/none/${run}`, DIGEST_API_KEY: 'stub-key' });

    // Then: only the item at 4 is taken; it moves to 5 and both are given up
    expect(first.exitCode, 'the first digest exits 0').toBe(0);
    expect(first.report?.pending, 'only the item at 4 attempts is pending').toBe(1);
    expect(first.report?.invalid, 'one reply is refused').toBe(1);
    expect(first.report?.invalid_none, 'the refusal is NONE').toBe(1);
    expect(await calls(), 'one stand-in call').toBe(1);
    expect((await readRow(ids[0])).digest_attempts, 'the first item moves to 5 attempts').toBe(5);
    expect(first.report?.given_up, 'both items are given up').toBe(2);
    expect(first.stderr.includes(ids[1]), 'no line of standard error names the item at 5').toBe(false);
    expect((await readRow(ids[0])).digest, 'the first item has no digest').toBeNull();
    expect((await readRow(ids[1])).digest, 'the second item has no digest').toBeNull();

    // When: the job runs digest again
    const second = digest({ DIGEST_API_BASE: `${fixtures}/model/none/${run}`, DIGEST_API_KEY: 'stub-key' });

    // Then: nothing is pending and the model is not called
    expect(second.exitCode, 'the second digest exits 0').toBe(0);
    expect(second.report?.pending, 'nothing is pending').toBe(0);
    expect(await calls(), 'no new stand-in call').toBe(1);
  },
);
