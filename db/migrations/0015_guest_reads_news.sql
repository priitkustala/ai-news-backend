-- A visitor without a sign-in reads the news (priitkustala/ai-news-backend#47, S-21a). The owner's
-- decision of 2026-11-09: the guest reading is built now, for staging; whether the public site
-- opens to guests is decided again before the production release. The feed, the categories, the
-- items and the last-updated columns of the runs open to anon (and the news to every signed-in
-- user); bookmarks, push_subscriptions, app_private.owner, app_private.sources and every write stay
-- the owner's, and the owner-only check is amended to allow exactly that and nothing more.
--
-- D1: feed and categories are views and PostgreSQL refuses a policy on a view, so they get a
--     select grant to anon only, keep security_invoker = true, and the policies go on the tables.
-- D2: the feed view's join to app_private.sources (which anon cannot read) becomes a join to
--     app_private.source_display, an owner-rights view of five display columns; the sources
--     table, its grants and its policies are unchanged.
-- D7: authenticated has held a table select on ingestion_runs since 0001, so the open policy on
--     ingestion_runs is to anon only: a second signed-in user still reads no run row, and the
--     per-source error text stays the owner's alone.
-- D8: has_table_privilege does not see a privilege granted on columns only, so the check reads
--     has_any_column_privilege too.

-- (1) The display columns of the sources, read with the view owner's rights.
create view app_private.source_display as
  select id, name, source_type, image_policy, community
    from app_private.sources;
revoke all on table app_private.source_display from public, anon, authenticated;
grant select on table app_private.source_display to anon, authenticated;
grant usage on schema app_private to anon;

-- (2) The feed: 0014's view with only the join changed to the display columns.
create or replace view public.feed with (security_invoker = true) as
  select i.id, i.title, i.summary, i.source_id, s.source_type, s.name as source_name,
         i.canonical_url, i.image_url, i.category, i.importance, i.published_at,
         coalesce(s.image_policy, 'placeholder') as image_policy,
         s.community, i.post_url, i.external_url, i.author_handle
    from public.items i
    left join app_private.source_display s on s.id = i.source_id
   where i.status = 'processed' and i.is_representative and not i.arxiv_capped
   order by i.importance desc nulls last, i.published_at desc nulls last, i.id;
grant select on table public.feed to anon;

-- (3) The categories: 0007's view without the owner filter.
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
   group by c.position, c.id, c.name, s.other_share, s.over_threshold
   order by c.position;
grant select on table public.categories to anon;

-- (4) The items: read by anon and every signed-in user.
grant select on table public.items to anon;
create policy items_news_read on public.items for select to anon, authenticated using (true);

-- (5) The runs: anon reads the columns of the last-updated line and of the categories view only.
grant select (run_date, ended_at, status, other_share, over_threshold, other_share_window_end)
  on table public.ingestion_runs to anon;
create policy ingestion_runs_news_read on public.ingestion_runs for select to anon using (true);

-- (6) The owner-only check of 0010 with the news allowed. The news relations feed, categories,
-- items and ingestion_runs may be read by anon; on ingestion_runs only the six columns above.
--   * A relation off the list: any privilege of anon, on the table or on any column, is a finding.
--   * A relation on the list: any write privilege of anon, on the table or on any column, is a
--     finding; on ingestion_runs, a select of anon on any live column outside the six is one.
--   * A client policy is exempt only when its relation is items or ingestion_runs, it is for
--     select, its USING as pg_get_expr prints it is exactly true and every role it names is anon
--     or authenticated (by oid, through pg_roles). Every other policy is read as 0009 and 0010
--     read it; the writing rule is unchanged.
-- Everything else of 0010 stays: row-level security on every table, security_invoker on every
-- view of public, no materialized view or foreign table, the membership rule.
create or replace function app_private.exposed_schema_findings()
  returns table (relation text, finding text)
  language sql stable set search_path = ''
  as $$
    with client_policies as (
      -- every policy of public that reaches a client; cmd and the expressions as pg_policies prints them
      select pol.polrelid,
             pol.polname::text as policyname,
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
