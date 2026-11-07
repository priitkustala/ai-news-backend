// B-14 (@surface-job, project api): story 50 (S-15, priitkustala/ai-news#50, backend part).
// Source: Locked B-14, one push notification per run date after the owner subscribes; OD-08
// decided push (owner, 2026-11-07); the runs that notify are completed and partial (owner,
// 2026-11-07). Given the owner's subscription written through the data interface and a
// finished run in the base seed, when the notify command runs twice for its run date, then the
// push service receives one encrypted, signed request and the rerun sends none; a date without
// a finished run sends none. The push service is a local receiver in this test process, so the
// command is started asynchronously (runBackend's spawnSync would block the receiver).
import { test, expect } from '@playwright/test';
import { exec } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { lastJsonObject } from '../../support/backend';
import { requireEnv, runMarker } from '../../support/env';
import { seed } from '../../support/job';
import { expectRows, readRelation, signIn, writeRelation } from '../../support/data';

type Received = { path: string; contentEncoding: string; authorization: string; bodyLength: number };
type NotifyResult = { exitCode: number; stdout: string; stderr: string; report: Record<string, unknown> | undefined };

const execLine = promisify(exec);

async function notify(runDate: string): Promise<NotifyResult> {
  const prefix = requireEnv('E2E_BACKEND_COMMAND', "the command line of the backend's command-line entry");
  const line = `${prefix} notify ${runDate}`;
  let exitCode = 0;
  let stdout = '';
  let stderr = '';
  try {
    ({ stdout, stderr } = await execLine(line, { encoding: 'utf8', timeout: 2 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 }));
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string; stderr?: string };
    if (typeof failed.code !== 'number') throw new Error(`Could not start "${line}": ${String(error)}`);
    exitCode = failed.code;
    stdout = failed.stdout ?? '';
    stderr = failed.stderr ?? '';
  }
  return { exitCode, stdout, stderr, report: lastJsonObject(stdout) };
}

test(
  'B-14: a run date sends one notification and a rerun sends none',
  { tag: ['@journey-push', '@surface-job', '@story-50'] },
  async ({ request }) => {
    // Given: the AC-14a set (no subscription) with a finished run in the base seed, the owner
    // signed in, a local push service and the owner's subscription pointing at it
    const run = runMarker();
    seed('AC-14a', run);
    const owner = signIn('owner');
    const runs = expectRows(await readRelation(request, 'ingestion_runs', owner), 'ingestion_runs answers the owner');
    const finished = runs.find((row) => row.status === 'completed');
    expect(finished, 'prerequisite: the base seed holds a completed run').toBeDefined();
    const runDate = String(finished?.run_date);

    const received: Received[] = [];
    const server = http.createServer((req, res) => {
      let length = 0;
      req.on('data', (chunk: Buffer) => {
        length += chunk.length;
      });
      req.on('end', () => {
        if (req.method === 'POST') {
          received.push({
            path: req.url ?? '',
            contentEncoding: String(req.headers['content-encoding'] ?? ''),
            authorization: String(req.headers.authorization ?? ''),
            bodyLength: length,
          });
        }
        res.writeHead(201);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const path = `/push/${run}`;
      const ecdh = createECDH('prime256v1');
      ecdh.generateKeys();
      const subscription = {
        endpoint: `http://127.0.0.1:${port}${path}`,
        keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
      };
      const written = await writeRelation(request, 'push_subscriptions', 'POST', subscription, owner);
      expect(written.status, 'prerequisite: the owner writes a subscription').toBe(201);

      // When: the notify command runs twice for the run date, one after the other
      const first = await notify(runDate);
      const firstPosts = received.length;
      const second = await notify(runDate);
      const secondPosts = received.length;

      // Then: the first sends one encrypted, signed notification to the owner's endpoint
      expect(first.exitCode, 'first unmet step (50): the notify command').toBe(0);
      expect(first.report?.status, 'the first command reports sent').toBe('sent');
      expect(first.report?.sent, 'the first command sent one').toBe(1);
      expect(first.report?.failed, 'the first command failed none').toEqual([]);
      expect(firstPosts, 'the push service received one request').toBe(1);
      expect(received[0].path, 'the request went to the owner\'s endpoint').toBe(path);
      expect(received[0].contentEncoding, 'the payload is encrypted (aes128gcm)').toBe('aes128gcm');
      expect(received[0].authorization, 'the request is signed (VAPID)').toMatch(/^vapid\s/);
      expect(received[0].bodyLength, 'the request carries a body').toBeGreaterThan(0);
      const firstOutput = `${first.stdout}\n${first.stderr}`;
      expect(firstOutput, 'the output holds no endpoint path (personal data)').not.toContain('/push/');
      expect(firstOutput, 'the output holds no endpoint host (personal data)').not.toContain('127.0.0.1');

      // and the rerun for the same date sends none
      expect(second.exitCode, 'the second command exits 0').toBe(0);
      expect(second.report?.status, 'the second command reports already-notified').toBe('already-notified');
      expect(second.report?.sent, 'the second command sent none').toBe(0);
      expect(secondPosts, 'the push service still holds one request after the rerun').toBe(1);

      // and a date without a finished run sends none
      const none = await notify('2099-01-01');
      expect(none.exitCode, 'the command for a date without a run exits 0').toBe(0);
      expect(none.report?.status, 'the command reports no-finished-run').toBe('no-finished-run');
      expect(none.report?.sent, 'the command for a date without a run sent none').toBe(0);
      expect(received.length, 'the push service still holds one request').toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
