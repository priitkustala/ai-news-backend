// `ingest <run-date> [--dry-run]`: the job's command (priitkustala/ai-news-backend#1, S-02;
// Locked, Architecture, B-01 and B-02). One run per run date: a start on a date whose run
// completed returns that run without fetching; a start on a date whose run did not complete
// (running, partial, failed or abandoned) takes the same run over and completes it. A run of
// an earlier date left `running` by an interrupted job is marked `abandoned`. Every enabled
// source is collected on its own (module collect); the run ends `completed`, `partial` when
// some sources failed, or `failed` when every source failed. Stored items are removed only by
// retain (B-22): those of a source no longer configured and those older than the retention
// window, never a bookmarked one; it runs in the run's write transaction before the
// processing below, and not at a failed run (src/retain/retain.ts). A copy of a stored
// item's canonical address takes over that item's row (its id stays) only when it wins
// under B-07 (a higher source weight, or the same and an earlier time); otherwise it changes
// nothing. In the same transaction as the run's new items, every
// stored item is clustered again with the earlier ones, scored, and the arXiv items beyond the
// daily cap marked (S-04,
// src/process/apply.ts), so the `feed` view shows one representative per cluster by score.
// With --dry-run it fetches and processes and writes nothing. A session advisory lock per run
// date keeps two starts of the same date from running at once. If the run's own
// writes fail after it started, they are rolled back and the run is recorded `failed` with a
// safe error (counts.run_error; the command exits 1); if even that record is refused, the
// command says so and exits 1 without a run report. A read that fails after the run's writes
// committed (the stored-item count of the report) changes nothing in the database: the run
// stays as committed, the report carries item_count null and report_error, and the command
// exits 3 (report incomplete). An item rejected while it was collected (over the per-item
// limit, S-11) is counted in `fetched`, not in `processed`, never fails its source, and is
// recorded as counts.rejected (source_id and reason) and reported as `rejected` by every
// start, the dry run included. Reddit sources (S-07, priitkustala/ai-news#44,
// src/collect/reddit.ts) are collected with the run's Reddit credentials or skipped without
// them; an admitted post is stored with its Reddit fields, and is not stored when its
// canonical address is already that of a stored item of a feed source or of a feed entry of
// the same run (OD-41, the owner's answer "drop"; the feed source's item stays as it is). In
// the run's write transaction of a run that is not failed, the removal pass (removeRedditPosts)
// deletes the stored posts of each community whose listing was read in this run that the
// listing no longer carries and that the Data API marks removed or no longer returns; absence
// from a listing alone never deletes. A failed lookup is that source's error and deletes
// nothing (counts.deleted_reddit_removed, a number). The run report
// is the last line of standard output; the log names counts and ids only, and a Reddit
// source's id is written as `reddit` in every report entry and log line (Locked R-21).
import { UsageError } from '../env.js';
import { inTransaction, withClient, type Client } from '../db.js';
import { collect, type CollectSource } from '../collect/collect.js';
import { SourceFailure } from '../collect/fetch.js';
import { processEntries, PROCESSING_VERSION, type ItemToStore } from './process.js';
import { storeOtherShare } from './other-share.js';
import { representativeOrder } from '../process/dedupe.js';
import { applyProcessing, type ProcessingCounts } from '../process/apply.js';
import { retain, type RetentionCounts } from '../retain/retain.js';
import { RedditSession, redditCredentials, redditItems, reportedSourceId, type RedditFields } from '../collect/reddit.js';

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

type Source = CollectSource & { display_policy: string; default_categories: string[] | null; source_weight: number };
// An item of this run; `reddit` is present on an item of a Reddit source.
type RunItem = ItemToStore & { reddit?: RedditFields };
type RunCounts = { fetched?: number; processed?: number; rejected?: RunReport['rejected'] } & Record<string, unknown>;
type RunRow = { id: string; status: string; counts: RunCounts; source_errors: RunReport['source_errors'] };

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

// Collects and processes every enabled source; writes nothing (it reads the stored items'
// addresses for OD-41).
async function collectAndProcess(client: Client, sources: Source[], reddit: RedditSession | null, log: (line: string) => void) {
  const collected = await collect(sources, reddit);
  let items: RunItem[] = [];
  // The post ids of each Reddit listing read in this run, by source id (the removal pass).
  const listed = new Map<string, Set<string>>();
  const sourceErrors: RunReport['source_errors'] = [];
  const rejected: RunReport['rejected'] = [];
  let fetched = 0;
  let dropped = 0;
  let notRelevant = 0;
  for (const result of collected.results) {
    const source = sources.find((s) => s.id === result.source_id) as Source;
    const reported = reportedSourceId(source);
    if (!result.ok) {
      sourceErrors.push({ source_id: reported, error: result.error });
      log(`ingest: source ${reported} failed (${errorKind(result.error)})`);
      continue;
    }
    if (result.reddit) {
      fetched += result.reddit.posts.length;
      listed.set(source.id, new Set(result.reddit.posts.map((post) => post.id)));
      const admitted = redditItems(source, result.reddit.posts);
      items.push(...admitted.items);
      dropped += admitted.dropped;
      notRelevant += admitted.notRelevant;
      continue;
    }
    fetched += result.entries.length + result.rejected.length;
    if (result.rejected.length) {
      rejected.push(...result.rejected.map((reason) => ({ source_id: reported, reason })));
      log(`ingest: source ${reported}: ${result.rejected.length} item(s) rejected (${[...new Set(result.rejected.map(errorKind))].join(', ')})`);
    }
    const processed = processEntries(source, result.entries);
    items.push(...processed.items);
    dropped += processed.dropped;
    notRelevant += processed.notRelevant;
  }
  // OD-41: a Reddit post whose canonical address is a feed entry's of this run, or a stored
  // item's of a feed source, is dropped.
  const posts = items.filter((item) => item.reddit);
  if (posts.length > 0) {
    const feedUrls = new Set(items.filter((item) => !item.reddit).map((item) => item.canonical_url));
    const stored = (await client.query<{ canonical_url: string }>(
      `select i.canonical_url from public.items i left join app_private.sources s on s.id = i.source_id
        where i.canonical_url = any($1::text[]) and s.source_type is distinct from 'reddit'`,
      [posts.map((item) => item.canonical_url)],
    )).rows;
    for (const row of stored) feedUrls.add(row.canonical_url);
    const kept = items.filter((item) => !item.reddit || !feedUrls.has(item.canonical_url));
    dropped += items.length - kept.length;
    if (items.length > kept.length) log(`ingest: ${items.length - kept.length} Reddit post(s) dropped as copies of feed items (OD-41)`);
    items = kept;
  }
  // The items are stored in the representative order of B-07 (the highest source weight, then
  // the earliest), so of two copies of one canonical address in this run the first is the winner
  // and the later one changes nothing (see the insert below).
  const weightOf = new Map(sources.map((s) => [s.id, Number(s.source_weight)]));
  const candidate = (item: RunItem) => ({
    ...item, source_weight: weightOf.get(item.source_id) ?? 0, time: item.published_at ? Date.parse(item.published_at) : Date.now(),
  });
  items.sort((a, b) => representativeOrder(candidate(a), candidate(b)));
  for (const skip of collected.skipped) log(`ingest: source ${skip.source_id} skipped (${skip.reason})`);
  const feeds = collected.results.length;
  const status = feeds > 0 && sourceErrors.length === feeds ? 'failed' : sourceErrors.length > 0 ? 'partial' : 'completed';
  return {
    status, items, weightOf, sourceErrors, rejected, requests: collected.requests, fetched, dropped, notRelevant, feeds,
    skipped: collected.skipped.length, listed,
  };
}

// The removal pass (W7 RD-3): for each Reddit source whose listing was read in this run, its
// stored posts that the listing does not carry are looked up at the info endpoint, and those
// marked removed or not returned are deleted. A failed lookup becomes that source's error (the
// run then ends partial) and deletes nothing of that source. Returns the deleted count.
async function removeRedditPosts(
  client: Client, sources: Source[], reddit: RedditSession, work: Awaited<ReturnType<typeof collectAndProcess>>, log: (line: string) => void,
): Promise<number> {
  let deleted = 0;
  for (const [sourceId, listed] of work.listed) {
    const source = sources.find((s) => s.id === sourceId) as Source;
    const stored = (await client.query<{ reddit_id: string }>(
      `select raw->>'reddit_id' as reddit_id from public.items where source_id = $1 and raw->>'reddit_id' is not null`, [sourceId],
    )).rows.map((row) => row.reddit_id).filter((id) => !listed.has(id));
    if (stored.length === 0) continue;
    let removed: string[];
    try {
      removed = await reddit.removedIds(source, stored);
    } catch (error) {
      const message = error instanceof SourceFailure ? error.message : 'unexpected: the removal lookup failed';
      work.sourceErrors.push({ source_id: reportedSourceId(source), error: message });
      if (work.status === 'completed') work.status = 'partial';
      log(`ingest: source ${reportedSourceId(source)}: the removal lookup failed (${errorKind(message)}); nothing deleted`);
      continue;
    }
    if (removed.length === 0) continue;
    const result = await client.query(
      `delete from public.items where source_id = $1 and raw->>'reddit_id' = any($2::text[])`, [sourceId, removed],
    );
    deleted += result.rowCount ?? 0;
  }
  if (deleted) log(`ingest: ${deleted} stored Reddit post(s) removed on Reddit deleted`);
  return deleted;
}

function countsOf(
  work: Awaited<ReturnType<typeof collectAndProcess>>, added: number, processing?: ProcessingCounts, replaced?: number, retention?: RetentionCounts,
  redditRemoved?: number,
) {
  return {
    sources: work.feeds, sources_failed: work.sourceErrors.length, sources_skipped: work.skipped,
    fetched: work.fetched, processed: work.items.length, dropped: work.dropped, not_relevant: work.notRelevant, added,
    rejected: work.rejected,
    ...(replaced === undefined ? {} : { replaced }),
    ...(processing ? { clusters: processing.clusters, duplicates_not_shown: processing.hidden, arxiv_capped: processing.arxiv_capped } : {}),
    ...(retention ? { deleted_removed_source: retention.deleted_removed_source, deleted_old: retention.deleted_old } : {}),
    ...(redditRemoved === undefined ? {} : { deleted_reddit_removed: redditRemoved }),
  };
}

export async function ingest(runDate: string, dryRun: boolean, log: (line: string) => void): Promise<RunReport> {
  return withClient('DATABASE_URL', async (client) => {
    const sources = (await client.query<Source>(
      'select id, feed_url, source_type, display_policy, default_categories, source_weight::float8 as source_weight from app_private.sources where enabled order by id',
    )).rows;
    log(`ingest: run date ${runDate}, ${sources.length} enabled sources${dryRun ? ', dry run' : ''}`);
    const credentials = sources.some((s) => s.source_type === 'reddit') ? await redditCredentials(client) : null;
    const reddit = credentials ? new RedditSession(credentials) : null;

    if (dryRun) {
      const existing = await runOf(client, runDate);
      const work = await collectAndProcess(client, sources, reddit, log);
      const known = (await client.query<{ canonical_url: string }>(
        'select canonical_url from public.items where canonical_url = any($1::text[])', [work.items.map((i) => i.canonical_url)],
      )).rows.length;
      const itemCount = await storedItemCount(client);
      log(`ingest: dry run ${work.status}: fetched ${work.fetched}, processed ${work.items.length}, not AI-relevant ${work.notRelevant}, `
        + `would add ${work.items.length - known}, `
        + `failed sources ${work.sourceErrors.length}, rejected items ${work.rejected.length}, stored items ${itemCount}; nothing was written`);
      return {
        run_id: existing?.id ?? null, run_date: runDate, status: work.status, dry_run: true,
        fetched_count: work.fetched, processed_count: work.items.length, item_count: itemCount,
        source_errors: work.sourceErrors, rejected: work.rejected, requests: work.requests,
      };
    }

    const locked = (await client.query<{ ok: boolean }>(`select pg_try_advisory_lock(${LOCK_CLASS}, ${LOCK_KEY}) as ok`, [runDate])).rows[0].ok;
    if (!locked) {
      const current = await runOf(client, runDate);
      log(`ingest: another start of run date ${runDate} is running; this start does nothing`);
      return {
        run_id: current?.id ?? null, run_date: runDate, status: current?.status ?? 'running', dry_run: false,
        fetched_count: 0, processed_count: 0, item_count: await storedItemCount(client),
        source_errors: current?.source_errors ?? [], rejected: current?.counts.rejected ?? [], requests: [],
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
          source_errors: existing.source_errors, rejected: existing.counts.rejected ?? [], requests: [],
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
      let retention: RetentionCounts | undefined;
      let redditRemoved: number | undefined;
      try {
        work = await collectAndProcess(client, sources, reddit, log);
        const done = work;
        ({ added, retention } = await inTransaction(client, async () => {
          let inserted = 0;
          let replaced = 0;
          for (const item of done.items) {
            // A copy of a stored canonical address (B-07, review finding F-S04-1): the stored row
            // keeps its id and takes the copy's source-bound fields only when the copy wins in the
            // representative order (src/process/dedupe.ts: the higher source weight, then the
            // earlier publication or else fetch time; an equal copy changes nothing); a losing
            // copy updates no row. Relevance and the category are decided on the copy's source and
            // title (B-04, B-05), so a winning copy brings its own. Cluster, score and cap marks
            // follow in applyProcessing. The Reddit fields (S-07) are source-bound too: a feed
            // copy that wins clears them.
            const result = await client.query<{ inserted: boolean }>(
              `insert into public.items as i (id, canonical_url, source_id, title, published_at, summary, summary_method,
                                              ai_relevant, relevance_method, category, category_method, status, processing_version,
                                              raw, post_url, external_url, author_handle)
               values ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, 'processed', $11, $13, $14, $15, $16)
               on conflict (canonical_url) do update
                  set source_id = excluded.source_id, title = excluded.title, published_at = excluded.published_at,
                      fetched_at = excluded.fetched_at, image_url = excluded.image_url, summary = excluded.summary,
                      summary_method = excluded.summary_method, relevance_method = excluded.relevance_method,
                      category = excluded.category, category_method = excluded.category_method,
                      processing_version = excluded.processing_version, raw = excluded.raw, post_url = excluded.post_url,
                      external_url = excluded.external_url, author_handle = excluded.author_handle
                where $12::float8 > coalesce((select s.source_weight::float8 from app_private.sources s where s.id = i.source_id), 0)
                   or ($12::float8 = coalesce((select s.source_weight::float8 from app_private.sources s where s.id = i.source_id), 0)
                       and coalesce(excluded.published_at, excluded.fetched_at) < coalesce(i.published_at, i.fetched_at))
               returning (xmax = 0) as inserted`,
              [item.id, item.canonical_url, item.source_id, item.title, item.published_at, item.summary,
                item.summary === null ? null : 'feed', item.relevance_method, item.category, item.category_method, PROCESSING_VERSION,
                done.weightOf.get(item.source_id) ?? 0, item.reddit ? JSON.stringify(item.reddit.raw) : null,
                item.reddit?.post_url ?? null, item.reddit?.external_url ?? null, item.reddit?.author_handle ?? null],
            );
            for (const row of result.rows) {
              if (row.inserted) inserted += 1;
              else replaced += 1;
            }
          }
          // The removal pass of Reddit posts (S-07), not at a failed run; before retention, so
          // the counts do not overlap.
          if (done.status !== 'failed' && reddit) redditRemoved = await removeRedditPosts(client, sources, reddit, done, log);
          // B-22: retention before applyProcessing, so clusters, scores and the Other share are
          // computed on the items that remain; a failed run keeps the stored items (B-02).
          const deleted = done.status === 'failed' ? undefined : await retain(client);
          const processing = await applyProcessing(client, log);
          if (replaced) log(`ingest: ${replaced} stored item(s) taken over by a copy that represents them under B-07`);
          // B-06: the Other share over the 7 days up to this write, stored with the run; after
          // applyProcessing, so the window counts the representatives of this run's clusters.
          await storeOtherShare(client, runId, null);
          await client.query(
            'update public.ingestion_runs set status = $2, ended_at = now(), counts = $3, source_errors = $4 where id = $1',
            [runId, done.status, JSON.stringify(countsOf(done, inserted, processing, replaced, deleted, redditRemoved)), JSON.stringify(done.sourceErrors)],
          );
          return { added: inserted, retention: deleted };
        }));
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
          source_errors: work?.sourceErrors ?? [], rejected: work?.rejected ?? [], requests: work?.requests ?? [], error: runError,
          ...(reportError ? { report_error: reportError } : {}),
        };
      }

      // The items and the run's status and counts are committed: what follows only reads.
      const { itemCount, reportError } = await reportedItemCount(client, runId, runDate, log);
      log(`ingest: run ${runId} of ${runDate} ended ${work.status}: fetched ${work.fetched}, processed ${work.items.length}, `
        + `not AI-relevant ${work.notRelevant}, added ${added}, `
        + (retention ? `deleted of removed sources ${retention.deleted_removed_source}, deleted past the window ${retention.deleted_old}, ` : '')
        + (redditRemoved === undefined ? '' : `deleted removed on Reddit ${redditRemoved}, `)
        + `failed sources ${work.sourceErrors.length}, rejected items ${work.rejected.length}, stored items ${itemCount ?? 'unknown'}`);
      return {
        run_id: runId, run_date: runDate, status: work.status, dry_run: false,
        fetched_count: work.fetched, processed_count: work.items.length, item_count: itemCount,
        source_errors: work.sourceErrors, rejected: work.rejected, requests: work.requests,
        ...(reportError ? { report_error: reportError } : {}),
      };
    } finally {
      // Closing the connection releases the lock as well, so a broken connection is not an error here.
      await client.query(`select pg_advisory_unlock(${LOCK_CLASS}, ${LOCK_KEY})`, [runDate]).catch(() => undefined);
    }
  });
}
