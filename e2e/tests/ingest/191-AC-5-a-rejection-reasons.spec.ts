// 191-AC-5a (scenario, @surface-job, project api): priitkustala/ai-news#191 (DC-1), criterion AC-5.
// Each refused reply names its reason on standard error and in the report, and the summary line's
// counts match the report; a vendor failure reads stopped (http-429); no reply text and no title is logged.
// Given set 191-AC-5 (one item on a synthetic article page), when the job runs digest five times
// against the stand-in model in modes three, none, link, nocontent and none (the page path while
// under 3 attempts, then the feed path), then the runs log invalid (sentences), invalid (none),
// invalid (link), invalid (no content) and invalid (none), one per run, each run's report holds its
// matching key at 1 and its summary line's counts equal the report, and after the fifth run given_up
// is 1. Given set 191-AC-5 again, when the job runs digest in mode len599, then the run logs invalid
// (length) once, its report holds invalid_length 1, its summary line's counts equal the report, and
// the item holds 5 attempts. Changed by priitkustala/ai-news#218: a reply refused for length is no
// longer tried again on a later run (cut, asked once more or given up in the same run), so the length
// case runs on its own item and the chain's fifth refusal is none. Given set 191-AC-5 again, when the
// job runs digest in mode http429, then the status is stopped,
// the reason http-429, and the last line of standard error starts with digest: stopped (http-429)
// followed by a comma. Standard error of every run holds none of the stand-in's reply texts and not
// the item's title.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { digest, seed, type DigestResult } from '../../support/job';
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

const SUMMARY = /^digest: (done|budget|stopped \([^)]*\)), pending (\d+), stored (\d+) \(page (\d+), feed (\d+)\), article_skipped (\d+), invalid (\d+) \(none (\d+), link (\d+), length (\d+), sentences (\d+), no content (\d+)\), given_up (\d+), left (\d+)$/;
const SUMMARY_KEYS = ['pending', 'stored', 'stored_page', 'stored_feed', 'article_skipped', 'invalid', 'invalid_none',
  'invalid_link', 'invalid_length', 'invalid_sentences', 'invalid_no_content', 'given_up', 'left'];

function stderrLines(result: DigestResult): string[] {
  return result.stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

test(
  '191-AC-5a: digest names the reason of each refused reply and a vendor failure, and logs no reply or title',
  { tag: ['@journey-ingest', '@surface-job', '@bug-191'] },
  async ({ request }) => {
    // Six job commands plus two seeds and the reads; two job commands near the 30 second default timed out under load (backend#37, backend#54).
    test.setTimeout(120_000);
    // Given: one pending item
    const run = runMarker();
    const manifest = seed('191-AC-5', run);
    const ids = manifest.ids as string[];
    expect(ids.length, 'prerequisite: the set has one item').toBe(1);
    const owner = signIn('owner');
    const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
    const readRow = async (id: string) => {
      const rows = expectRows(await readRelation(request, 'items', owner, `id=eq.${id}`), 'Then');
      expect(rows.length).toBe(1);
      return rows[0];
    };
    const title = String((await readRow(ids[0])).title);
    expect(title.length, 'prerequisite: the item has a title').toBeGreaterThan(0);
    const replies: string[] = [];
    for (const mode of ['valid', 'len599', 'three', 'none', 'link']) {
      replies.push(await stubReply(request, fixtures, mode, `${run}-probe-${mode}`));
    }
    const results: DigestResult[] = [];
    const cases = [
      { mode: 'three', reason: 'sentences', key: 'invalid_sentences' },
      { mode: 'none', reason: 'none', key: 'invalid_none' },
      { mode: 'link', reason: 'link', key: 'invalid_link' },
      { mode: 'nocontent', reason: 'no content', key: 'invalid_no_content' },
      { mode: 'none', reason: 'none', key: 'invalid_none' },
    ];

    for (const [index, { mode, reason, key }] of cases.entries()) {
      // When: the job runs digest and the model answers in this mode
      const result = digest({ DIGEST_API_BASE: `${fixtures}/model/${mode}/${run}-${index + 1}`, DIGEST_API_KEY: 'stub-key' });
      results.push(result);

      // Then: one line names the reason, the report's key is 1, the summary line matches the report
      expect(result.exitCode, `the digest in mode ${mode} exits 0`).toBe(0);
      const lines = stderrLines(result);
      expect(lines.filter((line) => line === `digest: item ${ids[0]} invalid (${reason})`).length, `the run in mode ${mode} logs invalid (${reason}) once`).toBe(1);
      expect(lines.filter((line) => / invalid \(/.test(line)).length, `the run in mode ${mode} logs one invalid line`).toBe(1);
      expect(result.report?.[key], `the report of mode ${mode} holds ${key} 1`).toBe(1);
      const summary = lines[lines.length - 1].match(SUMMARY);
      expect(summary, `the run in mode ${mode} ends on the summary line`).not.toBeNull();
      expect(summary?.[1], 'the summary line names the status').toBe(result.report?.status);
      expect(summary?.slice(2).map(Number), 'the summary line\'s counts equal the report').toEqual(SUMMARY_KEYS.map((name) => result.report?.[name]));
    }

    // Then: after the fifth run the item is given up
    expect(results[4].report?.given_up, 'the item is given up after five refusals').toBe(1);
    expect((await readRow(ids[0])).digest_attempts, 'the item holds 5 attempts').toBe(5);

    // Given: the set again; When: the model answers a reply of 599 characters (priitkustala/ai-news#218)
    const short = runMarker();
    const shortIds = seed('191-AC-5', short).ids as string[];
    expect(shortIds.length, 'prerequisite: the set has one item for the length case').toBe(1);
    const shortTitle = String((await readRow(shortIds[0])).title);
    const { mode, reason, key } = { mode: 'len599', reason: 'length', key: 'invalid_length' };
    const result = digest({ DIGEST_API_BASE: `${fixtures}/model/${mode}/${short}-1`, DIGEST_API_KEY: 'stub-key' });
    results.push(result);

    // Then: one line names the reason, the report's key is 1, the summary line matches the report, and the item is given up
    expect(result.exitCode, `the digest in mode ${mode} exits 0`).toBe(0);
    const shortLines = stderrLines(result);
    expect(shortLines.filter((line) => line === `digest: item ${shortIds[0]} invalid (${reason})`).length, `the run in mode ${mode} logs invalid (${reason}) once`).toBe(1);
    expect(shortLines.filter((line) => / invalid \(/.test(line)).length, `the run in mode ${mode} logs one invalid line`).toBe(1);
    expect(result.report?.[key], `the report of mode ${mode} holds ${key} 1`).toBe(1);
    const summary = shortLines[shortLines.length - 1].match(SUMMARY);
    expect(summary, `the run in mode ${mode} ends on the summary line`).not.toBeNull();
    expect(summary?.[1], 'the summary line names the status').toBe(result.report?.status);
    expect(summary?.slice(2).map(Number), 'the summary line\'s counts equal the report').toEqual(SUMMARY_KEYS.map((name) => result.report?.[name]));
    expect((await readRow(shortIds[0])).digest_attempts, 'the item refused for length holds 5 attempts').toBe(5);

    // Given: the set again; When: the model's interface answers HTTP 429
    const again = runMarker();
    const againIds = seed('191-AC-5', again).ids as string[];
    expect(againIds.length, 'prerequisite: the set has one item again').toBe(1);
    const againTitle = String((await readRow(againIds[0])).title);
    const stopped = digest({ DIGEST_API_BASE: `${fixtures}/model/http429/${again}`, DIGEST_API_KEY: 'stub-key' });
    results.push(stopped);

    // Then: the run stops on the vendor failure and says so
    expect(stopped.exitCode, 'the stopped digest exits 0').toBe(0);
    expect(stopped.report?.status, 'the run reports stopped').toBe('stopped');
    expect(stopped.report?.reason, 'the reason is http-429').toBe('http-429');
    const lines = stderrLines(stopped);
    expect(lines[lines.length - 1].startsWith('digest: stopped (http-429),'), 'the last line starts with digest: stopped (http-429),').toBe(true);

    // Then: no run logs a reply text or the item's title
    const stderr = results.map((result) => result.stderr).join('\n');
    expect([...replies, title, shortTitle, againTitle].filter((text) => stderr.includes(text)).length, 'standard error holds no reply text and no title').toBe(0);
  },
);
