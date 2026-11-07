// `notify <run-date>` (priitkustala/ai-news#50, S-15; Locked B-14): sends one push notification
// per run date to the owner's subscriptions once the run has finished, and none on a rerun.
// Runs with the job's scoped role. The date is claimed on its ingestion run (notified_at) in
// one statement before anything is sent, and a failed send is not retried: B-14's invariant is
// no second notification, so a lost one is preferred to a duplicate.
//
// The request is built by web-push's generateRequestDetails (the payload encrypted as aes128gcm,
// the VAPID signature in the authorization header) and sent with fetch: sendNotification sends
// through https.request only, which cannot reach a local http push service in the scenarios.
// An endpoint, a key or a token is the owner's personal data or a secret: none is printed or
// logged; the report holds counts and reasons only.
import webpush from 'web-push';
import { withClient } from '../db.js';
import { requireEnv } from '../env.js';

// The run statuses after which the owner is notified (owner decision of 2026-11-07).
export const NOTIFYING_STATUSES = ['completed', 'partial'];

const PAYLOAD = JSON.stringify({ title: 'AI news', body: 'The daily feed is ready.' });
const TTL_SECONDS = 86_400;
const SEND_TIMEOUT_MS = 10_000;

export type NotifyStatus = 'sent' | 'already-notified' | 'no-finished-run' | 'no-subscriptions' | 'failed';
export type NotifyReport = { run_date: string; status: NotifyStatus; sent: number; failed: { reason: string }[] };

type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };

async function send(subscription: Subscription, vapidDetails: { subject: string; publicKey: string; privateKey: string }): Promise<string | undefined> {
  let details;
  try {
    details = webpush.generateRequestDetails(subscription, PAYLOAD, { vapidDetails, TTL: TTL_SECONDS });
  } catch {
    return 'invalid-subscription';
  }
  try {
    const response = await fetch(details.endpoint, {
      method: details.method,
      headers: details.headers,
      body: details.body ? new Uint8Array(details.body) : null,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.ok ? undefined : `http-${response.status}`;
  } catch {
    return 'network';
  }
}

export async function notify(runDate: string, log: (line: string) => void): Promise<NotifyReport> {
  const report = (status: NotifyStatus, sent = 0, failed: { reason: string }[] = []): NotifyReport => ({ run_date: runDate, status, sent, failed });
  return withClient('DATABASE_URL', async (client) => {
    const run = (await client.query<{ status: string; notified_at: Date | null }>(
      'select status, notified_at from public.ingestion_runs where run_date = $1',
      [runDate],
    )).rows[0];
    if (!run || !NOTIFYING_STATUSES.includes(run.status)) return report('no-finished-run');
    if (run.notified_at) return report('already-notified');

    const subscriptions = (await client.query<Subscription>('select endpoint, keys from public.push_subscriptions')).rows;
    if (subscriptions.length === 0) return report('no-subscriptions');

    // The signing key is read before the claim, so a missing one never spends the date.
    const vapidDetails = {
      subject: requireEnv('PUSH_VAPID_SUBJECT'),
      publicKey: requireEnv('PUSH_VAPID_PUBLIC_KEY'),
      privateKey: requireEnv('PUSH_VAPID_PRIVATE_KEY'),
    };
    // The claim: of two commands for one date, only one gets the row back and sends.
    const claimed = await client.query(
      'update public.ingestion_runs set notified_at = now() where run_date = $1 and status = any($2) and notified_at is null returning run_date',
      [runDate, NOTIFYING_STATUSES],
    );
    if (claimed.rows.length === 0) return report('already-notified');

    let sent = 0;
    const failed: { reason: string }[] = [];
    for (const subscription of subscriptions) {
      const reason = await send(subscription, vapidDetails);
      if (reason) failed.push({ reason });
      else sent += 1;
    }
    log(`notify: ${runDate}: ${sent} sent, ${failed.length} failed of ${subscriptions.length} subscriptions`);
    return report(sent > 0 ? 'sent' : 'failed', sent, failed);
  });
}
