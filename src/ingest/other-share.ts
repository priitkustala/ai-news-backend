// The Other share of a run (priitkustala/ai-news-backend#2, S-03; Locked B-06, OD-15;
// db/migrations/0007_other_share_per_run.sql). The job computes it at the end of each run and
// stores it with the run; the seed stores it the same way for a seeded window. The window is
// the 7 days up to and including its end, by an item's publication time or, without one, its
// fetch time, over representative processed items. The notice compares the exact counts
// (strictly above 30 percent); the share is stored unrounded.
import type { Client } from '../db.js';

// windowEnd null: the database's current time (the run's write transaction).
export async function storeOtherShare(client: Client, runId: string, windowEnd: Date | null): Promise<void> {
  await client.query(
    `with bound as (
       select coalesce($2::timestamptz, now()) as window_end
     ), counted as (
       select b.window_end,
              count(i.id)::integer as items,
              (count(i.id) filter (where i.category = 'other'))::integer as other
         from bound b
         left join public.items i
           on i.status = 'processed'
          and i.is_representative
          and coalesce(i.published_at, i.fetched_at) > b.window_end - interval '7 days'
          and coalesce(i.published_at, i.fetched_at) <= b.window_end
        group by b.window_end
     )
     update public.ingestion_runs r
        set other_share_window_end = c.window_end,
            other_share_items = c.items,
            other_share_other = c.other,
            other_share = c.other::numeric / nullif(c.items, 0),
            over_threshold = c.other * 10 > c.items * 3
       from counted c
      where r.id = $1`,
    [runId, windowEnd?.toISOString() ?? null],
  );
}

// The run the categories view reads the share of: the latest completed or partial run.
export async function latestRunId(client: Client): Promise<string | undefined> {
  return (await client.query<{ id: string }>(
    "select id from public.ingestion_runs where status in ('completed', 'partial') order by run_date desc limit 1",
  )).rows[0]?.id;
}
