// 218-AC-1a to 218-AC-4a (scenarios, @surface-job, project api): priitkustala/ai-news#218 (DL-1),
// criteria AC-1 to AC-4, under the owner's rule settled on 2026-11-26 (settlement 161): a story whose
// digest is the wrong length gets the closest suitable match that meets the limits, and no story stays
// in the loop. Given set 191-AC-5 (one item on a synthetic article page, 0 attempts, the page path),
// when the job runs digest against the stand-in model: in mode len1201 the reply is cut after its last
// sentence end inside 1200 characters and stored in the same run (AC-1); in mode len599thenvalid the
// model is asked once more, with both limits named, and the second reply is stored (AC-2); in mode
// len599 nothing fits and the item is given up at once with 5 attempts, never picked again (AC-3); in
// modes none and three a refusal still counts one attempt and the item is tried again (AC-4).
import { test, expect, type APIRequestContext } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { digest, seed, type DigestResult } from '../../support/job';
import { expectRows, readRelation, signIn, type Row } from '../../support/data';

type Call = { n: number; body: { messages?: { role?: string; content?: unknown }[] } };

// One seeded pending item of set 191-AC-5 and the reads the scenarios need.
function given(request: APIRequestContext) {
  const run = runMarker();
  const ids = seed('191-AC-5', run).ids as string[];
  expect(ids.length, 'prerequisite: the set has one item').toBe(1);
  const owner = signIn('owner');
  const fixtures = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a canned feed on the fixture feed server')).origin;
  const readItem = async (): Promise<Row> => {
    const rows = expectRows(await readRelation(request, 'items', owner, `id=eq.${ids[0]}`), 'Then');
    expect(rows.length, 'the item is read as one row').toBe(1);
    return rows[0];
  };
  // The job's digest command against the stand-in in this mode, under the model key `${run}-<n>`.
  const runDigest = (mode: string, n: number): Record<string, unknown> => {
    const result: DigestResult = digest({ DIGEST_API_BASE: `${fixtures}/model/${mode}/${run}-${n}`, DIGEST_API_KEY: 'stub-key' });
    expect(result.exitCode, `the digest in mode ${mode} exits 0`).toBe(0);
    expect(result.report, `the digest in mode ${mode} prints its report`).not.toBeUndefined();
    return { ...result.report, stderr: result.stderr };
  };
  // The stand-in's calls under the model key `${run}-<n>`, on a connection of its own: a socket kept
  // alive across a job command of several seconds is closed by the server and hangs up.
  const calls = async (n: number): Promise<Call[]> => {
    const response = await request.get(`${fixtures}/model-calls/${run}-${n}`, { headers: { Connection: 'close' } });
    expect(response.status(), 'the stand-in answers its call record').toBe(200);
    const record = (await response.json()) as { calls?: unknown };
    expect(Array.isArray(record.calls), 'the call record holds a list of calls').toBe(true);
    return record.calls as Call[];
  };
  return { run, id: ids[0], fixtures, readItem, runDigest, calls };
}

// The system message of a recorded call; a call without one fails the scenario.
function systemMessage(call: Call): string {
  const content = call.body.messages?.find((message) => message.role === 'system')?.content;
  expect(typeof content, `call ${call.n} carries a system message`).toBe('string');
  return content as string;
}

// The stand-in's reply of a mode, asked once under a key of its own (as stubReply of 191-AC-5a).
async function stubReply(request: APIRequestContext, fixtures: string, mode: string, key: string): Promise<string> {
  const response = await request.post(`${fixtures}/model/${mode}/${key}/chat/completions`, {
    headers: { Authorization: 'Bearer stub-key', 'Content-Type': 'application/json', Connection: 'close' },
    data: { model: 'gpt-6-luna', messages: [] },
  });
  expect(response.status(), 'prerequisite: the stand-in answers').toBe(200);
  const content = ((await response.json()) as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
  expect(typeof content, 'prerequisite: the stand-in answers a text').toBe('string');
  return content as string;
}

test(
  '218-AC-1a: a reply over 1200 characters is cut after its last sentence end and stored in the same run',
  { tag: ['@journey-ingest', '@surface-job', '@bug-218'] },
  async ({ request }) => {
    // Given: one pending item on the page path, and the stand-in's reply of mode len1201
    const { run, fixtures, readItem, runDigest, calls } = given(request);
    const reply = await stubReply(request, fixtures, 'len1201', `${run}-probe-len1201`);
    expect(Array.from(reply.trim()).length, 'prerequisite: the reply of len1201 is over 1200 characters').toBeGreaterThan(1200);

    // When: the job runs digest once and the model answers 1201 characters
    const report = runDigest('len1201', 1);

    // Then: the item is stored from the page in this run, with the cut reply
    expect(report.stored, 'the report holds stored 1').toBe(1);
    expect(report.stored_page, 'the report holds stored_page 1').toBe(1);
    expect(report.invalid, 'the report holds invalid 0').toBe(0);
    expect(report.given_up, 'the report holds given_up 0').toBe(0);
    expect(report.left, 'the report holds left 0').toBe(0);
    const item = await readItem();
    expect(item.digest, 'the item holds a digest').not.toBeNull();
    expect(typeof item.digest, 'the digest is a text').toBe('string');
    const stored = item.digest as string;
    const length = Array.from(stored).length;
    expect(length, 'the digest holds at least 600 characters').toBeGreaterThanOrEqual(600);
    expect(length, 'the digest holds at most 1200 characters').toBeLessThanOrEqual(1200);
    expect(stored.endsWith('.'), 'the digest ends in a full stop').toBe(true);
    expect(reply.startsWith(stored), 'the digest is a prefix of the stand-in\'s reply').toBe(true);
    expect(reply.charAt(stored.length), 'a space follows the digest in the stand-in\'s reply').toBe(' ');
    expect(item.digest_attempts, 'the item holds 0 attempts').toBe(0);
    expect((await calls(1)).length, 'the stand-in was called once').toBe(1);
  },
);

test(
  '218-AC-2a: a reply under 600 characters is asked once more, with both limits named, and the fitting reply is stored',
  { tag: ['@journey-ingest', '@surface-job', '@bug-218'] },
  async ({ request }) => {
    // Given: one pending item on the page path, and the stand-in's valid reply
    const { run, fixtures, readItem, runDigest, calls } = given(request);
    const valid = await stubReply(request, fixtures, 'valid', `${run}-probe-valid`);

    // When: the job runs digest once; the model answers 599 characters, then the valid reply
    const report = runDigest('len599thenvalid', 1);

    // Then: the second reply is stored in this run, and the second ask names both limits
    expect(report.stored, 'the report holds stored 1').toBe(1);
    expect(report.invalid, 'the report holds invalid 0').toBe(0);
    expect(report.left, 'the report holds left 0').toBe(0);
    const recorded = await calls(1);
    expect(recorded.length, 'the stand-in was called twice').toBe(2);
    expect(systemMessage(recorded[0]).includes('600'), 'the first ask does not name 600').toBe(false);
    const second = systemMessage(recorded[1]);
    expect(second.includes('600'), 'the second ask names 600').toBe(true);
    expect(second.includes('1200'), 'the second ask names 1200').toBe(true);
    const item = await readItem();
    expect(item.digest, 'the digest equals the stand-in\'s valid reply, trimmed').toBe(valid.trim());
    expect(item.digest_attempts, 'the item holds 0 attempts').toBe(0);
  },
);

test(
  '218-AC-3a: when no reply fits, the item is given up in the run that found it and never picked again',
  { tag: ['@journey-ingest', '@surface-job', '@bug-218'] },
  async ({ request }) => {
    // Two job commands, a seed and the reads (191-AC-5a's budget for job commands under load).
    test.setTimeout(120_000);
    // Given: one pending item on the page path
    const { id, readItem, runDigest, calls } = given(request);

    // When: the job runs digest and the model answers 599 characters to both asks
    const first = runDigest('len599', 1);

    // Then: the item is refused for length once and given up at once
    const lines = String(first.stderr).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    expect(lines.filter((line) => line === `digest: item ${id} invalid (length)`).length, 'the run logs invalid (length) once').toBe(1);
    expect(first.invalid_length, 'the report holds invalid_length 1').toBe(1);
    expect(first.stored, 'the report holds stored 0').toBe(0);
    expect(first.given_up, 'the report holds given_up 1').toBe(1);
    expect(first.left, 'the report holds left 0').toBe(0);
    expect((await calls(1)).length, 'the stand-in was called twice').toBe(2);
    const item = await readItem();
    expect(item.digest_attempts, 'the item holds 5 attempts').toBe(5);
    expect(item.digest, 'the item holds no digest').toBeNull();

    // When: the job runs digest again
    const second = runDigest('len599', 2);

    // Then: the item is not picked and the model is not asked again
    expect(second.pending, 'the second run reports pending 0').toBe(0);
    expect((await calls(1)).length, 'the first key still holds 2 calls').toBe(2);
    expect((await calls(2)).length, 'the second run made no call').toBe(0);
  },
);

test(
  '218-AC-4a: a reply refused for another reason counts one attempt and the item is tried again',
  { tag: ['@journey-ingest', '@surface-job', '@bug-218'] },
  async ({ request }) => {
    // Four job commands, two seeds and the reads (191-AC-5a's budget for job commands under load).
    test.setTimeout(120_000);
    for (const mode of ['none', 'three']) {
      // Given: one freshly seeded pending item on the page path
      const { readItem, runDigest, calls } = given(request);

      // When: the job runs digest and the model answers in this mode
      const first = runDigest(mode, 1);

      // Then: one attempt is counted and the item stays pending
      expect((await readItem()).digest_attempts, `mode ${mode}: the item holds 1 attempt`).toBe(1);
      expect(first.left, `mode ${mode}: the report holds left 1`).toBe(1);
      expect(first.given_up, `mode ${mode}: the report holds given_up 0`).toBe(0);
      expect((await calls(1)).length, `mode ${mode}: the stand-in was called once`).toBe(1);

      // When: the job runs digest again; Then: the item is picked once more and asked once more
      const second = runDigest(mode, 2);
      expect(second.pending, `mode ${mode}: the second run reports pending 1`).toBe(1);
      expect((await calls(1)).length + (await calls(2)).length, `mode ${mode}: the stand-in was called twice in all`).toBe(2);
    }
  },
);
