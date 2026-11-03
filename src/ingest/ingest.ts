// `ingest <run-date> [--dry-run]`: the job's command (priitkustala/ai-news-backend#1, S-02;
// Locked, Architecture, B-01 and B-02). One run per run date: a start on a date whose run
// completed returns that run without fetching; a start on a date whose run did not complete
// (running, partial, failed or abandoned) takes the same run over and completes it. A run of
// an earlier date left `running` by an interrupted job is marked `abandoned`. Every enabled
// source is collected on its own (module collect); the run ends `completed`, `partial` when
// some sources failed, or `failed` when every source failed, and stored items are never
// removed. With --dry-run it fetches and processes and writes nothing. A session advisory
// lock per run date keeps two starts of the same date from running at once. The run report
// is the last line of standard output; the log names counts and ids only (Locked R-21).
import { UsageError } from '../env.js';
import { inTransaction, withClient, type Client } from '../db.js';
import { collect, type CollectSource } from '../collect/collect.js';
import { processEntries, PROCESSING_VERSION, type ItemToStore } from './process.js';

export type RunReport = {
  run_id: string | null;
  run_date: string;
  status: string;
  dry_run: boolean;
  fetched_count: number;
  processed_count: number;
  item_count: number;
  source_errors: { source_id: string; error: string }[];
  rejected: { source_id: string; reason: string }[];
  requests: { source_id: string; source_type: string; host: string }[];
};

type Source = CollectSource & { display_policy: string };
type RunRow = { id: string; status: string; counts: Record<string, number>; source_errors: RunReport['source_errors'] };

// The advisory lock space of the job: (LOCK_CLASS, days since 1970-01-01 of the run date).
const LOCK_CLASS = 20_502;
const LOCK_KEY = "($1::date - date '1970-01-01')";

export function parseRunDate(value: string | undefined): string {
  const date = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : undefined;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new UsageError(`The run date must be a calendar date as YYYY-MM-DD (got ${JSON.stringify(value)}).`);
  }
  return value;
}

const errorKind = (error: string) => error.split(':', 1)[0];

async function storedItemCount(client: Client): Promise<number> {
  return Number((await client.query<{ n: string }>('select count(*) as n from public.items')).rows[0].n);
}

async function runOf(client: Client, runDate: string): Promise<RunRow | undefined> {
  return (await client.query<RunRow>('select id, status, counts, source_errors from public.ingestion_runs where run_date = $1', [runDate])).rows[0];
}

// Collects and processes every enabled source; writes nothing.
async function collectAndProcess(sources: Source[], log: (line: string) => void) {
  const collected = await collect(sources);
  const items: ItemToStore[] = [];
  const sourceErrors: RunReport['source_errors'] = [];
  let fetched = 0;
  let dropped = 0;
  for (const result of collected.results) {
    if (!result.ok) {
      sourceErrors.push({ source_id: result.source_id, error: result.error });
      log(`ingest: source ${result.source_id} failed (${errorKind(result.error)})`);
      continue;
    }
    fetched += result.entries.length;
    const source = sources.find((s) => s.id === result.source_id) as Source;
    const processed = processEntries(source, result.entries);
    items.push(...processed.items);
    dropped += processed.dropped;
  }
  for (const skip of collected.skipped) log(`ingest: source ${skip.source_id} skipped (not a feed source)`);
  const feeds = collected.results.length;
  const status = feeds > 0 && sourceErrors.length === feeds ? 'failed' : sourceErrors.length > 0 ? 'partial' : 'completed';
  return { status, items, sourceErrors, requests: collected.requests, fetched, dropped, feeds, skipped: collected.skipped.length };
}

export async function ingest(runDate: string, dryRun: boolean, log: (line: string) => void): Promise<RunReport> {
  return withClient('DATABASE_URL', async (client) => {
    const sources = (await client.query<Source>(
      'select id, feed_url, source_type, display_policy from app_private.sources where enabled order by id',
    )).rows;
    log(`ingest: run date ${runDate}, ${sources.length} enabled sources${dryRun ? ', dry run' : ''}`);

    if (dryRun) {
      const existing = await runOf(client, runDate);
      const work = await collectAndProcess(sources, log);
      const known = (await client.query<{ canonical_url: string }>(
        'select canonical_url from public.items where canonical_url = any($1::text[])', [work.items.map((i) => i.canonical_url)],
      )).rows.length;
      const itemCount = await storedItemCount(client);
      log(`ingest: dry run ${work.status}: fetched ${work.fetched}, processed ${work.items.length}, would add ${work.items.length - known}, `
        + `failed sources ${work.sourceErrors.length}, stored items ${itemCount}; nothing was written`);
      return {
        run_id: existing?.id ?? null, run_date: runDate, status: work.status, dry_run: true,
        fetched_count: work.fetched, processed_count: work.items.length, item_count: itemCount,
        source_errors: work.sourceErrors, rejected: [], requests: work.requests,
      };
    }

    const locked = (await client.query<{ ok: boolean }>(`select pg_try_advisory_lock(${LOCK_CLASS}, ${LOCK_KEY}) as ok`, [runDate])).rows[0].ok;
    if (!locked) {
      const current = await runOf(client, runDate);
      log(`ingest: another start of run date ${runDate} is running; this start does nothing`);
      return {
        run_id: current?.id ?? null, run_date: runDate, status: current?.status ?? 'running', dry_run: false,
        fetched_count: 0, processed_count: 0, item_count: await storedItemCount(client),
        source_errors: current?.source_errors ?? [], rejected: [], requests: [],
      };
    }
    try {
      const existing = await runOf(client, runDate);
      if (existing?.status === 'completed') {
        const itemCount = await storedItemCount(client);
        log(`ingest: run ${existing.id} of ${runDate} already completed; nothing fetched, stored items ${itemCount}`);
        return {
          run_id: existing.id, run_date: runDate, status: existing.status, dry_run: false,
          fetched_count: existing.counts.fetched ?? 0, processed_count: existing.counts.processed ?? 0, item_count: itemCount,
          source_errors: existing.source_errors, rejected: [], requests: [],
        };
      }

      const runId = await inTransaction(client, async () => {
        // A run of another date still `running` whose job holds no lock was interrupted.
        const abandoned = await client.query<{ run_date: string }>(
          `update public.ingestion_runs set status = 'abandoned', ended_at = now()
            where status = 'running' and run_date <> $1::date
              and pg_try_advisory_xact_lock(${LOCK_CLASS}, (run_date - date '1970-01-01'))
          returning run_date`, [runDate]);
        if (abandoned.rowCount) log(`ingest: marked ${abandoned.rowCount} interrupted run(s) of earlier dates abandoned`);
        return (await client.query<{ id: string }>(
          `insert into public.ingestion_runs (run_date, status) values ($1, 'running')
           on conflict (run_date) do update set status = 'running', ended_at = null
           returning id`, [runDate])).rows[0].id;
      });
      log(existing ? `ingest: run ${runId} of ${runDate} was ${existing.status}; taking it over` : `ingest: run ${runId} of ${runDate} started`);

      const work = await collectAndProcess(sources, log);
      const added = await inTransaction(client, async () => {
        let inserted = 0;
        for (const item of work.items) {
          const result = await client.query(
            `insert into public.items (id, canonical_url, source_id, title, published_at, summary, summary_method, status, processing_version)
             values ($1, $2, $3, $4, $5, $6, $7, 'processed', $8)
             on conflict do nothing`,
            [item.id, item.canonical_url, item.source_id, item.title, item.published_at, item.summary,
              item.summary === null ? null : 'feed', PROCESSING_VERSION],
          );
          inserted += result.rowCount ?? 0;
        }
        const counts = {
          sources: work.feeds, sources_failed: work.sourceErrors.length, sources_skipped: work.skipped,
          fetched: work.fetched, processed: work.items.length, dropped: work.dropped, added: inserted,
        };
        await client.query(
          'update public.ingestion_runs set status = $2, ended_at = now(), counts = $3, source_errors = $4 where id = $1',
          [runId, work.status, JSON.stringify(counts), JSON.stringify(work.sourceErrors)],
        );
        return inserted;
      });
      const itemCount = await storedItemCount(client);
      log(`ingest: run ${runId} of ${runDate} ended ${work.status}: fetched ${work.fetched}, processed ${work.items.length}, added ${added}, `
        + `failed sources ${work.sourceErrors.length}, stored items ${itemCount}`);
      return {
        run_id: runId, run_date: runDate, status: work.status, dry_run: false,
        fetched_count: work.fetched, processed_count: work.items.length, item_count: itemCount,
        source_errors: work.sourceErrors, rejected: [], requests: work.requests,
      };
    } finally {
      await client.query(`select pg_advisory_unlock(${LOCK_CLASS}, ${LOCK_KEY})`, [runDate]);
    }
  });
}
