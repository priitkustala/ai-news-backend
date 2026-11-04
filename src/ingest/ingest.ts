// `ingest <run-date> [--dry-run]`: the job's command (priitkustala/ai-news-backend#1, S-02;
// Locked, Architecture, B-01 and B-02). One run per run date: a start on a date whose run
// completed returns that run without fetching; a start on a date whose run did not complete
// (running, partial, failed or abandoned) takes the same run over and completes it. A run of
// an earlier date left `running` by an interrupted job is marked `abandoned`. Every enabled
// source is collected on its own (module collect); the run ends `completed`, `partial` when
// some sources failed, or `failed` when every source failed, and stored items are never
// removed. In the same transaction as the run's new items, every stored item is clustered
// again with the earlier ones, scored, and the arXiv items beyond the daily cap marked (S-04,
// src/process/apply.ts), so the `feed` view shows one representative per cluster by score. With --dry-run it fetches and processes and writes nothing. A session advisory
// lock per run date keeps two starts of the same date from running at once. If the run's own
// writes fail after it started, they are rolled back and the run is recorded `failed` with a
// safe error (counts.run_error; the command exits 1); if even that record is refused, the
// command says so and exits 1 without a run report. A read that fails after the run's writes
// committed (the stored-item count of the report) changes nothing in the database: the run
// stays as committed, the report carries item_count null and report_error, and the command
// exits 3 (report incomplete). The run report
// is the last line of standard output; the log names counts and ids only (Locked R-21).
import { UsageError } from '../env.js';
import { inTransaction, withClient, type Client } from '../db.js';
import { collect, type CollectSource } from '../collect/collect.js';
import { processEntries, PROCESSING_VERSION, type ItemToStore } from './process.js';
import { representativeOrder } from '../process/dedupe.js';
import { applyProcessing, type ProcessingCounts } from '../process/apply.js';

export type RunReport = {
  run_id: string | null;
  run_date: string;
  status: string;
  dry_run: boolean;
  fetched_count: number;
  processed_count: number;
  // null when the count could not be read after the run's writes committed (see report_error).
  item_count: number | null;
  source_errors: { source_id: string; error: string }[];
  rejected: { source_id: string; reason: string }[];
  requests: { source_id: string; source_type: string; host: string }[];
  // Present only when the run could not finish its own writes (recorded as counts.run_error).
  error?: string;
  // Present only when a read for the report failed after the run's outcome was committed; the
  // persisted run is unaffected.
  report_error?: string;
};

// The run started but could not be recorded as failed either: nothing about this failure is
// persisted, so the command reports no run and exits non-zero.
export class RunNotRecorded extends Error {}

const sqlState = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
};

type Source = CollectSource & { display_policy: string; source_weight: number };
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

// The stored-item count for the report once the run's outcome is persisted. Nothing can be
// rolled back any more at that point, so a failed read is reported as such, never as a
// failure of the run.
async function reportedItemCount(client: Client, runId: string, runDate: string, log: (line: string) => void) {
  try {
    return { itemCount: await storedItemCount(client) };
  } catch (error) {
    const code = sqlState(error);
    const reportError = `report: the stored-item count could not be read after the run's outcome was committed (${code ? `SQLSTATE ${code}` : 'no SQLSTATE'}); the run's status and counts are as committed`;
    log(`ingest: run ${runId} of ${runDate}: reporting failure after the commit (${code ?? 'no SQLSTATE'}); the stored-item count is unknown, the run is recorded as committed`);
    return { itemCount: null, reportError };
  }
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
  // Of two new items with the same canonical address the insert keeps the first, so the items
  // are stored in the representative order of B-07: the highest source weight, then the earliest.
  const weightOf = new Map(sources.map((s) => [s.id, Number(s.source_weight)]));
  const candidate = (item: ItemToStore) => ({
    ...item, source_weight: weightOf.get(item.source_id) ?? 0, time: item.published_at ? Date.parse(item.published_at) : Date.now(),
  });
  items.sort((a, b) => representativeOrder(candidate(a), candidate(b)));
  for (const skip of collected.skipped) log(`ingest: source ${skip.source_id} skipped (not a feed source)`);
  const feeds = collected.results.length;
  const status = feeds > 0 && sourceErrors.length === feeds ? 'failed' : sourceErrors.length > 0 ? 'partial' : 'completed';
  return { status, items, sourceErrors, requests: collected.requests, fetched, dropped, feeds, skipped: collected.skipped.length };
}

function countsOf(work: Awaited<ReturnType<typeof collectAndProcess>>, added: number, processing?: ProcessingCounts) {
  return {
    sources: work.feeds, sources_failed: work.sourceErrors.length, sources_skipped: work.skipped,
    fetched: work.fetched, processed: work.items.length, dropped: work.dropped, added,
    ...(processing ? { clusters: processing.clusters, duplicates_not_shown: processing.hidden, arxiv_capped: processing.arxiv_capped } : {}),
  };
}

export async function ingest(runDate: string, dryRun: boolean, log: (line: string) => void): Promise<RunReport> {
  return withClient('DATABASE_URL', async (client) => {
    const sources = (await client.query<Source>(
      'select id, feed_url, source_type, display_policy, source_weight::float8 as source_weight from app_private.sources where enabled order by id',
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

      let work: Awaited<ReturnType<typeof collectAndProcess>> | undefined;
      let added: number;
      try {
        work = await collectAndProcess(sources, log);
        const done = work;
        added = await inTransaction(client, async () => {
          let inserted = 0;
          for (const item of done.items) {
            const result = await client.query(
              `insert into public.items (id, canonical_url, source_id, title, published_at, summary, summary_method, status, processing_version)
               values ($1, $2, $3, $4, $5, $6, $7, 'processed', $8)
               on conflict do nothing`,
              [item.id, item.canonical_url, item.source_id, item.title, item.published_at, item.summary,
                item.summary === null ? null : 'feed', PROCESSING_VERSION],
            );
            inserted += result.rowCount ?? 0;
          }
          const processing = await applyProcessing(client, log);
          await client.query(
            'update public.ingestion_runs set status = $2, ended_at = now(), counts = $3, source_errors = $4 where id = $1',
            [runId, done.status, JSON.stringify(countsOf(done, inserted, processing)), JSON.stringify(done.sourceErrors)],
          );
          return inserted;
        });
      } catch (error) {
        // The run started but its writes failed: the item writes were rolled back with their
        // transaction, so stored items are as before. The run is recorded `failed` with a safe
        // error (a SQLSTATE, never a message that could carry feed content; R-21).
        const code = sqlState(error);
        const runError = code
          ? `store: the database refused the run's writes (SQLSTATE ${code}); its item writes were rolled back`
          : 'unexpected: the run could not finish its writes; its item writes were rolled back';
        log(`ingest: run ${runId} of ${runDate} could not finish its writes (${code ?? 'no SQLSTATE'}); recording it failed`);
        try {
          await client.query(
            "update public.ingestion_runs set status = 'failed', ended_at = now(), counts = $2, source_errors = $3 where id = $1",
            [runId, JSON.stringify({ ...(work ? countsOf(work, 0) : {}), run_error: runError }), JSON.stringify(work?.sourceErrors ?? [])],
          );
        } catch (recordError) {
          const recordCode = sqlState(recordError);
          log(`ingest: run ${runId} of ${runDate} could not be recorded failed either (${recordCode ?? 'no SQLSTATE'}); `
            + 'its status in the database is unchanged');
          throw new RunNotRecorded(`the run ${runId} of ${runDate} failed and could not be recorded (${recordCode ?? code ?? 'no SQLSTATE'})`);
        }
        const { itemCount, reportError } = await reportedItemCount(client, runId, runDate, log);
        log(`ingest: run ${runId} of ${runDate} ended failed: stored items ${itemCount ?? 'unknown'}`);
        return {
          run_id: runId, run_date: runDate, status: 'failed', dry_run: false,
          fetched_count: work?.fetched ?? 0, processed_count: work?.items.length ?? 0, item_count: itemCount,
          source_errors: work?.sourceErrors ?? [], rejected: [], requests: work?.requests ?? [], error: runError,
          ...(reportError ? { report_error: reportError } : {}),
        };
      }

      // The items and the run's status and counts are committed: what follows only reads.
      const { itemCount, reportError } = await reportedItemCount(client, runId, runDate, log);
      log(`ingest: run ${runId} of ${runDate} ended ${work.status}: fetched ${work.fetched}, processed ${work.items.length}, added ${added}, `
        + `failed sources ${work.sourceErrors.length}, stored items ${itemCount ?? 'unknown'}`);
      return {
        run_id: runId, run_date: runDate, status: work.status, dry_run: false,
        fetched_count: work.fetched, processed_count: work.items.length, item_count: itemCount,
        source_errors: work.sourceErrors, rejected: [], requests: work.requests,
        ...(reportError ? { report_error: reportError } : {}),
      };
    } finally {
      // Closing the connection releases the lock as well, so a broken connection is not an error here.
      await client.query(`select pg_advisory_unlock(${LOCK_CLASS}, ${LOCK_KEY})`, [runDate]).catch(() => undefined);
    }
  });
}
