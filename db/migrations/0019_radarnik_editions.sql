-- One dated Radarnik edition a day, shown from 07:00 Tallinn time (priitkustala/ai-news#213, ED-1;
-- the owner's approval of 2026-11-24, workspace Decisions row 1124: an edition publishes at 07:00
-- Europe/Tallinn on its date; one editor writes and approves each edition, by a later item).
-- A new exposure, named for the owner: the tables editions and edition_stories and the view
-- edition_published, read (select only) by the guest role and the signed-in role, and only the rows of
-- an approved edition whose publish time has passed. No role of the app inserts, updates or deletes;
-- the seed and, later, the editor write path fill them as the migration role.
--
-- E1: publication is a time rule, not a job: app_private.edition_is_published reads the status and the
--     edition date against now(), and both read policies and the view use it.
-- E2: the owner-only check of 0018 with two changes: the three relations join the news relations anon
--     may read (a write privilege stays a finding), and the open news read is extended to exactly the two
--     published-read policies below (their USING as pg_get_expr prints it). Everything else of 0018 stays.
set local lock_timeout = '5s';

-- (1) The editions: one per date.
create table public.editions (
  id uuid constraint editions_pkey primary key default gen_random_uuid(),
  edition_date date not null constraint editions_edition_date_key unique,
  status text not null constraint editions_status_check check (status in ('draft', 'approved')),
  ticker_lines text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- (2) The stories of an edition in order; position 1 is the lead story.
create table public.edition_stories (
  id uuid constraint edition_stories_pkey primary key default gen_random_uuid(),
  edition_id uuid not null constraint edition_stories_edition_id_fkey references public.editions(id) on delete cascade,
  position integer not null constraint edition_stories_position_check check (position >= 1),
  title text not null,
  category text not null
    constraint edition_stories_category_check check (category in ('releases', 'research', 'policy', 'business', 'other')),
  what_happened text not null,
  why_it_matters text not null,
  your_move text not null,
  source_name text not null,
  original_url text not null constraint edition_stories_original_url_check check (original_url ~ '^https?://'),
  published_on date not null,
  reading_minutes integer not null constraint edition_stories_reading_minutes_check check (reading_minutes >= 1),
  constraint edition_stories_edition_position_key unique (edition_id, position)
);

-- (3) E1: an edition is published once it is approved and 07:00 Europe/Tallinn of its date has passed.
create function app_private.edition_is_published(status text, edition_date date)
  returns boolean
  language sql stable
  as $$
    select status = 'approved' and now() >= (edition_date + time '07:00') at time zone 'Europe/Tallinn'
  $$;
revoke all on function app_private.edition_is_published(text, date) from public;
grant execute on function app_private.edition_is_published(text, date) to anon, authenticated;

-- (4) Grants closed, then select only for the guest role and the signed-in role.
revoke all on table public.editions from public, anon, authenticated;
revoke all on table public.edition_stories from public, anon, authenticated;
grant select on table public.editions to anon, authenticated;
grant select on table public.edition_stories to anon, authenticated;

-- (5) Row-level security: only the rows of a published edition.
alter table public.editions enable row level security;
alter table public.edition_stories enable row level security;
create policy editions_published_read on public.editions for select to anon, authenticated
  using (app_private.edition_is_published(status, edition_date));
create policy edition_stories_published_read on public.edition_stories for select to anon, authenticated
  using (exists (select 1 from public.editions e where e.id = edition_id));

-- (6) The published editions, one row per story, newest edition first and its stories in position order.
create view public.edition_published with (security_invoker = true) as
  select e.id as edition_id, e.edition_date, e.ticker_lines, s.position, s.title, s.category,
         s.what_happened, s.why_it_matters, s.your_move, s.source_name, s.original_url,
         s.published_on, s.reading_minutes
    from public.editions e
    join public.edition_stories s on s.edition_id = e.id
   where app_private.edition_is_published(e.status, e.edition_date)
   order by e.edition_date desc, s.position;
revoke all on table public.edition_published from public, anon, authenticated;
grant select on table public.edition_published to anon, authenticated;

-- (7) E2: the owner-only check of 0018 with the editions allowed.
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
             -- the news read: an open select policy for anon or authenticated on items or ingestion_runs,
             -- or the published read of editions or edition_stories (0019)
             (((rel.relname in ('items', 'ingestion_runs')
                and pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) = 'true')
               or (rel.relname = 'editions'
                   and pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) = 'app_private.edition_is_published(status, edition_date)')
               or (rel.relname = 'edition_stories'
                   and pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) = E'(EXISTS ( SELECT 1\n   FROM public.editions e\n  WHERE (e.id = edition_stories.edition_id)))'))
              and relns.nspname = 'public'
              and pol.polcmd = 'r'
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
        where c.relname not in ('feed', 'categories', 'items', 'ingestion_runs', 'editions', 'edition_stories', 'edition_published')
          and (pg_catalog.has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
               or pg_catalog.has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
       -- and on the news list it only reads
       union all
       select 'write privilege granted to anon'
        where c.relname in ('feed', 'categories', 'items', 'ingestion_runs', 'editions', 'edition_stories', 'edition_published')
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
