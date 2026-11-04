-- Owner-only access for every later relation of the exposed schema (priitkustala/ai-news#43,
-- S-05, plan step 2). The five relations of 0001 to 0007 already admit only the owner: row-level
-- security with app_private.is_owner() on items, ingestion_runs and bookmarks, and
-- security_invoker on the feed and categories views, which therefore return only the rows the
-- policies of the tables beneath them admit (residual risk L8). What was missing is the
-- "every later table" of the story: Supabase's default privileges give anon and authenticated
-- every privilege on a new table, sequence or function in public, and a new table starts
-- without row-level security, so a later migration that forgot either would expose its rows.

-- 1. Later objects that the migration role creates in public start closed; each migration
--    grants what the client needs, as 0001 does.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- 2. The owner-only check of the exposed schema, one row per finding (empty: owner-only).
--    `migrate` runs it inside every migration's transaction, so a migration that leaves a
--    relation open is rolled back, and once more at the end for its report.
create function app_private.exposed_schema_findings()
  returns table (relation text, finding text)
  language sql stable set search_path = ''
  as $$
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
       -- the publishable key without a session gets nothing
       union all
       select 'privilege granted to anon'
        where pg_catalog.has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       -- every policy a client role can reach admits the owner only
       union all
       select 'policy ' || p.policyname || ' for a client role does not require the owner'
         from pg_catalog.pg_policies p
        where p.schemaname = n.nspname and p.tablename = c.relname
          and p.roles && array['public', 'anon', 'authenticated']::name[]
          and not (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) like '%app_private.is_owner()%'
     ) f
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     order by 1, 2
  $$;
revoke all on function app_private.exposed_schema_findings() from public, anon, authenticated;
