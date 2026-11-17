// 191-AC-2a (scenario, @surface-job, project api): priitkustala/ai-news#191 (DC-1), criterion AC-2.
// The digest step takes items never tried before ahead of items tried before, newest first in each group.
// Given set 191-AC-2 (10 pending items on synthetic article pages, published 1 to 10 minutes ago;
// items 2, 4, 6, 8 and 10 with digest_attempts 1) and the stand-in model in mode valid, when the job
// runs digest, then the item ids of the stored lines of standard error are, in order, items 1, 3, 5, 7
// and 9, then 2, 4, 6, 8 and 10 of the manifest, and the stand-in's calls hold the titles in the same order.
import { test, expect } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { digest, seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

type Call = { n: number; body: { messages?: { role?: string; content?: string }[] } };

test(
  '191-AC-2a: digest takes never-tried items first, then tried items, newest first in each group',
  { tag: ['@journey-ingest', '@surface-job', '@bug-191'] },
  async ({ request }) => {
    // A job command plus the seed and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(60_000);
    // Given: five never-tried and five tried-before items
    const run = runMarker();
    const manifest = seed('191-AC-2', run);
    const ids = manifest.ids as string[];
    expect(ids.length, 'prerequisite: the set has 10 items').toBe(10);
    const owner = signIn('owner');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const all = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads the items');
    expect(all.length, 'prerequisite: the owner reads the set\'s items').toBe(10);
    const byId = new Map(all.map((row) => [String(row.id), row]));
    ids.forEach((id, index) => {
      expect(byId.get(id)?.digest_attempts, 'prerequisite: the even items were tried once').toBe(index % 2 === 1 ? 1 : 0);
    });
    const expected = [0, 2, 4, 6, 8, 1, 3, 5, 7, 9].map((index) => ids[index]);

    // When: the job runs digest
    const result = digest({ DIGEST_API_BASE: `${fixtures}/model/valid/${run}`, DIGEST_API_KEY: 'stub-key' });

    // Then: never-tried items first, then tried items, newest first in each group
    expect(result.exitCode, 'digest exits 0').toBe(0);
    const stored = result.stderr.split(/\r?\n/)
      .map((line) => line.trim().match(/^digest: item (\S+) stored/)?.[1])
      .filter((id): id is string => id !== undefined);
    expect(stored, 'the stored lines name items 1, 3, 5, 7, 9, then 2, 4, 6, 8, 10').toEqual(expected);
    const record = await request.get(`${fixtures}/model-calls/${run}`);
    expect(record.status(), 'the stand-in answers its record').toBe(200);
    const calls = ((await record.json()) as { calls: Call[] }).calls;
    const titles = calls.map((call) =>
      (JSON.parse(String(call.body.messages?.find((message) => message.role === 'user')?.content)) as { title?: string }).title);
    expect(titles, 'the calls hold the titles in the same order').toEqual(expected.map((id) => byId.get(id)?.title));
  },
);
