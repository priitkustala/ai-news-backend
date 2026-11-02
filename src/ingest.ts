// `ingest <run-date> [--dry-run]`: the job's command (Locked, Architecture). In #40 it is the
// shell only: it connects with the job's scoped role, reads the source configuration and
// records the run for the date, but fetches and processes nothing yet; collection, processing
// and the run's completion arrive with S-02 (priitkustala/ai-news-backend#1). With --dry-run it
// writes nothing. The run report is the last line of standard output; the log names counts
// and ids only (Locked R-21).
import { UsageError } from './env.js';
import { withClient } from './db.js';

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

export function parseRunDate(value: string | undefined): string {
  const date = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : undefined;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new UsageError(`The run date must be a calendar date as YYYY-MM-DD (got ${JSON.stringify(value)}).`);
  }
  return value;
}

export async function ingest(runDate: string, dryRun: boolean, log: (line: string) => void): Promise<RunReport> {
  return withClient('DATABASE_URL', async (client) => {
    const sources = Number((await client.query<{ n: string }>('select count(*) as n from app_private.sources where enabled')).rows[0].n);
    const items = Number((await client.query<{ n: string }>('select count(*) as n from public.items')).rows[0].n);
    log(`ingest: run date ${runDate}, ${sources} enabled sources, ${items} stored items${dryRun ? ', dry run' : ''}`);
    let runId: string | null = null;
    // The shell never completes a run: nothing is fetched or processed until S-02.
    let status = 'running';
    if (!dryRun) {
      await client.query(
        "insert into public.ingestion_runs (run_date, status) values ($1, 'running') on conflict (run_date) do nothing",
        [runDate],
      );
      const row = (await client.query<{ id: string; status: string }>('select id, status from public.ingestion_runs where run_date = $1', [runDate])).rows[0];
      runId = row.id;
      status = row.status;
    }
    log('ingest: collection and processing are not built yet (S-02, priitkustala/ai-news-backend#1): nothing was fetched or processed'
      + (dryRun ? '; the dry run wrote nothing' : `; the run of ${runDate} is recorded as ${status}`));
    return {
      run_id: runId,
      run_date: runDate,
      status,
      dry_run: dryRun,
      fetched_count: 0,
      processed_count: 0,
      item_count: items,
      source_errors: [],
      rejected: [],
      requests: [],
    };
  });
}
