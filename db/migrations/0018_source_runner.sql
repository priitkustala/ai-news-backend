-- The runner of each source and each ingestion run (priitkustala/ai-news-backend#86, LI-1; the
-- owner's decision of 2026-11-16, workspace Decisions rows 768 and 772). Two sources refuse the
-- cloud runner, so a laptop run of the same ingest command fetches them: a source row and a run row
-- name their runner, cloud (the scheduled cloud job, the default) or laptop. The cloud run skips the
-- laptop sources and keeps their stored items (their rows stay, so retention keeps the items); a
-- laptop run fetches only them and writes its own run row of the same date. The app reads cloud runs
-- only, so a laptop row never makes the feed look fresh when the cloud run failed.
--
-- R1: a restrictive read rule on the runs for the guest and every signed-in user: it only narrows
--     the rows the existing read rules admit (0001 owner read, 0015 guest read), which stay as they
--     are; no grant changes.
-- R2: the owner-only check of 0015 with one change, by the owner's answer on backend#86: it reads
--     only permissive policies for reading. A restrictive policy is combined with AND and can only
--     hide rows a permissive policy admits, so it cannot open a read; the writing rule still reads
--     every policy. Everything else of 0015 stays.
set local lock_timeout = '5s';

-- (1) Sources: the runner that fetches each source.
alter table app_private.sources
  add column runner text not null default 'cloud',
  add constraint sources_runner_check check (runner in ('cloud', 'laptop'));

-- (2) Runs: one run per run date and runner.
alter table public.ingestion_runs
  add column runner text not null default 'cloud',
  add constraint ingestion_runs_runner_check check (runner in ('cloud', 'laptop'));
alter table public.ingestion_runs drop constraint ingestion_runs_run_date_key;
alter table public.ingestion_runs
  add constraint ingestion_runs_run_date_runner_key unique (run_date, runner);

-- (3) R1: the app reads cloud runs only.
create policy ingestion_runs_cloud_read on public.ingestion_runs as restrictive for select
  to anon, authenticated using (runner = 'cloud');

-- (4) R2: the owner-only check of 0015, reading only permissive policies for reading.
create or replace function app_private.exposed_schema_findings()
  returns table (relation text, finding text)
  language sql stable set search_path = ''
  as $$
    with client_policies as (
      -- every policy of public that reaches a client; cmd and the expressions as pg_policies prints them
      select pol.polrelid,
             pol.polname::text as policyname,
             pol.polpermissive as permissive,
             case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
                             when 'd' then 'DELETE' when '*' then 'ALL' end as cmd,
             pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) as qual,
             pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check,
             -- the news read: an open select policy for anon or authenticated on items or ingestion_runs
             (rel.relname in ('items', 'ingestion_runs')
              and relns.nspname = 'public'
              and pol.polcmd = 'r'
              and pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) = 'true'
              and not exists (
                select 1
                  from unnest(pol.polroles) as r(role)
                 where r.role not in (select a.oid from pg_catalog.pg_roles a where a.rolname in ('anon', 'authenticated'))
              )) as news_read
        from pg_catalog.pg_policy pol
        join pg_catalog.pg_class rel on rel.oid = pol.polrelid
        join pg_catalog.pg_namespace relns on relns.oid = rel.relnamespace
       where app_private.policy_reaches_client(pol.polroles)
    )
    select c.relname::text, f.finding
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     cross join lateral (
       -- a table without row-level security
       select 'table without row-level security' as finding
        where c.relkind in ('r', 'p') and not c.relrowsecurity
       -- a view that reads with its owner's rights instead of the reader's policies
       union all
       select 'view without security_invoker'
        where c.relkind = 'v' and not coalesce('security_invoker=true' = any (c.reloptions), false)
       -- a materialized view or foreign table cannot carry row-level security
       union all
       select 'relation kind without row-level security'
        where c.relkind in ('m', 'f')
       -- the publishable key without a session gets nothing off the news list, on the table or a column
       union all
       select 'privilege granted to anon'
        where c.relname not in ('feed', 'categories', 'items', 'ingestion_runs')
          and (pg_catalog.has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
               or pg_catalog.has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
       -- and on the news list it only reads
       union all
       select 'write privilege granted to anon'
        where c.relname in ('feed', 'categories', 'items', 'ingestion_runs')
          and (pg_catalog.has_table_privilege('anon', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
               or pg_catalog.has_any_column_privilege('anon', c.oid, 'INSERT, UPDATE, REFERENCES'))
       -- of the runs, only the columns of the last-updated line and of the categories view
       union all
       select 'anon reads a column outside the last-updated columns'
        where c.relname = 'ingestion_runs'
          and exists (
            select 1
              from pg_catalog.pg_attribute a
             where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
               and a.attname not in ('run_date', 'ended_at', 'status', 'other_share', 'over_threshold', 'other_share_window_end')
               and pg_catalog.has_column_privilege('anon', c.oid, a.attnum, 'SELECT')
          )
       -- every policy a client role reaches requires the owner for reading where it reads, but the news read
       union all
       select 'policy ' || p.policyname || ' (for ' || lower(p.cmd) || ') for a client role does not require the owner for reading'
         from client_policies p
        where p.polrelid = c.oid
          and p.cmd in ('ALL', 'SELECT', 'UPDATE', 'DELETE')
          and not p.news_read
          and p.permissive
          and not app_private.expression_requires_owner(p.qual)
       -- and for writing where it writes
       union all
       select 'policy ' || p.policyname || ' (for ' || lower(p.cmd) || ') for a client role does not require the owner for writing'
         from client_policies p
        where p.polrelid = c.oid
          and p.cmd in ('ALL', 'INSERT', 'UPDATE')
          and not app_private.expression_requires_owner(coalesce(p.with_check, p.qual))
     ) f
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     order by 1, 2
  $$;
revoke all on function app_private.exposed_schema_findings() from public, anon, authenticated;
