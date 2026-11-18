// 191-AC-3a (scenario, @surface-job, project api): priitkustala/ai-news#191 (DC-1), criterion AC-3.
// The digest step starts no item once its time budget is used, keeps what it stored, and the next run continues.
// Given set 191-AC-3 (6 pending items on synthetic article pages) and the stand-in model in mode slow
// (the valid reply after 1000 milliseconds), when the job runs digest with the test-only
// DIGEST_TIME_BUDGET_MS set to 2500, then it exits 0 with status budget, stored at least 1, left equal
// to pending minus stored and at least 1, as many stand-in calls as stored, every call starting less
// than 2500 milliseconds after the first, and the stored digests present; when the job then runs digest
// in mode valid without the variable, it reports done with left 0 and the first run's digests are unchanged.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { digest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

type Call = { n: number; at: number };

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
  '191-AC-3a: digest stops starting items when its time budget is used and the next run continues',
  { tag: ['@journey-ingest', '@surface-job', '@bug-191'] },
  async ({ request }) => {
    // Two job commands plus the seed and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(90_000);
    // Given: six pending items and a slow model
    const run = runMarker();
    const manifest = seed('191-AC-3', run);
    const ids = manifest.ids as string[];
    expect(ids.length, 'prerequisite: the set has 6 items').toBe(6);
    const owner = signIn('owner');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const all = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads the items');
    expect(all.length, 'prerequisite: the owner reads the set\'s items').toBe(6);
    const reply = await stubReply(request, fixtures, 'valid', `${run}-probe`);
    const readDigests = async () => {
      const rows = expectRows(await readRelation(request, 'items', owner), 'Then');
      return new Map(rows.map((row) => [String(row.id), row.digest as string | null]));
    };

    // When: the job runs digest with a budget of 2500 milliseconds
    const first = digest({ DIGEST_API_BASE: `${fixtures}/model/slow/${run}`, DIGEST_API_KEY: 'stub-key', DIGEST_TIME_BUDGET_MS: '2500' });

    // Then: the run ends on its budget and keeps what it stored
    expect(first.exitCode, 'the first digest exits 0').toBe(0);
    expect(first.report?.status, 'the first run reports budget').toBe('budget');
    const pending = Number(first.report?.pending);
    const stored = Number(first.report?.stored);
    expect(pending, 'the first run finds the 6 items pending').toBe(6);
    expect(stored, 'the first run stores at least one digest').toBeGreaterThanOrEqual(1);
    expect(first.report?.left, 'left is pending minus stored').toBe(pending - stored);
    expect(Number(first.report?.left), 'at least one item is left').toBeGreaterThanOrEqual(1);
    const record = await request.get(`${fixtures}/model-calls/${run}`);
    expect(record.status(), 'the stand-in answers its record').toBe(200);
    const calls = ((await record.json()) as { calls: Call[] }).calls;
    expect(calls.length, 'one stand-in call per stored digest').toBe(stored);
    for (const call of calls) {
      expect(call.at - calls[0].at, 'no item is started after the budget').toBeLessThan(2500);
    }
    const afterFirst = await readDigests();
    const kept = ids.filter((id) => afterFirst.get(id) !== null);
    expect(kept.length, 'the stored digests are present').toBe(stored);
    for (const id of kept) expect(afterFirst.get(id), 'a stored digest is the reply').toBe(reply);

    // When: the job runs digest again without the budget variable
    const second = digest({ DIGEST_API_BASE: `${fixtures}/model/valid/${run}-2`, DIGEST_API_KEY: 'stub-key' });

    // Then: the next run continues and nothing is left; the first run's digests are unchanged
    expect(second.exitCode, 'the second digest exits 0').toBe(0);
    expect(second.report?.status, 'the second run reports done').toBe('done');
    expect(second.report?.left, 'nothing is left pending').toBe(0);
    const afterSecond = await readDigests();
    for (const id of kept) expect(afterSecond.get(id), 'the first run\'s digest is unchanged').toBe(afterFirst.get(id));
    expect(ids.filter((id) => afterSecond.get(id) === null).length, 'every item holds a digest').toBe(0);
  },
);
