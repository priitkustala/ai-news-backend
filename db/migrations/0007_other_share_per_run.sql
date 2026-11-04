-- The Other share computed and stored per run (priitkustala/ai-news-backend#2, S-03, repair
-- round 2; Locked B-06; OD-15; owner decision of 2026-11-04 on Astra's finding F-S03-3:
-- "Follow the spec: job computes and stores per run").
--
-- 0006 computed the share when the categories view was read; B-06 says the job computes it.
-- Each run now stores, with its own record, the share over the window of OD-15 ending at the
-- run: representative processed items whose publication time (or, without one, fetch time)
-- lies in (window end - 7 days, window end]. The upper bound keeps future-dated items (such
-- as Federal Register entries dated ahead) out of the window (F-S03-1). over_threshold
-- compares the exact counts, other / items > 0.30 as other * 10 > items * 3, so no rounding
-- comes before the comparison (F-S03-2); other_share is stored unrounded, and the view
-- rounds it to 4 places for display only. The job writes these columns in its write
-- transaction (src/ingest/other-share.ts); the seed stores them for a seeded window the way a
-- run would, on the set's latest completed run with the seed time as the window end.
--
-- The view exposes the values of the latest completed or partial run (by run date) that
-- stored them: the same on every read, changed only by the next run (F-S03-3). Without such
-- a run the share is null and the notice false. The view keeps its columns, security_invoker,
-- the owner predicate, its grants and its read-only trigger (0002); ingestion_runs keeps its
-- owner-only read policy and the job's grants, which cover the new columns.
--
-- A new migration, not an amended 0006: 0006 (numbered 0005 then) was already applied by this
-- branch's instance before the repair, and the runner applies each file once. Both were
-- renumbered at the merge of main (S-04's 0005_feed_one_per_cluster.sql; owner, 2026-11-04);
-- they replace only the categories view and leave S-04's feed view as 0005 defines it.

alter table public.ingestion_runs
  add column other_share_window_end timestamptz,
  add column other_share_items integer,
  add column other_share_other integer,
  add column other_share numeric,
  add column over_threshold boolean;

comment on column public.ingestion_runs.other_share_window_end is
  'End of the run''s Other-share window (OD-15): the run''s write time, or the seed time for a seeded window. The window is the 7 days up to and including it.';
comment on column public.ingestion_runs.other_share_items is
  'Representative processed items in the window (the denominator, OD-15).';
comment on column public.ingestion_runs.other_share_other is
  'Of them, the items in Other.';
comment on column public.ingestion_runs.other_share is
  'other_share_other / other_share_items, unrounded; null when the window holds no representative item.';
comment on column public.ingestion_runs.over_threshold is
  'True when the share is strictly above 0.30, compared on the exact counts (B-06; the five categories never change).';

create or replace view public.categories with (security_invoker = true) as
  with latest as (
    select r.other_share, r.over_threshold
      from public.ingestion_runs r
     where r.status in ('completed', 'partial')
       and r.other_share_window_end is not null
     order by r.run_date desc
     limit 1
  )
  select c.id, c.name, count(i.id)::integer as item_count,
         round(s.other_share, 4) as other_share,
         coalesce(s.over_threshold, false) as over_threshold
    from (values (1, 'releases', 'Model and product releases'),
                 (2, 'research', 'Research'),
                 (3, 'policy', 'Regulation and policy'),
                 (4, 'business', 'Business and developer tools'),
                 (5, 'other', 'Other')) as c (position, id, name)
    left join latest s on true
    left join public.items i on i.category = c.id
   where (select app_private.is_owner())
   group by c.position, c.id, c.name, s.other_share, s.over_threshold
   order by c.position;
