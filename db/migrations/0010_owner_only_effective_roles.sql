-- The owner-only check over the roles a client holds (priitkustala/ai-news#43, S-05, repair
-- round 3, finding F-S05-3). 0009's check read only the policies whose roles array names public,
-- anon or authenticated literally. PostgreSQL applies a policy to every role that has the
-- privileges of a role the policy names (has_privs_of_role in check_role_for_policy), so a later
-- migration could grant a new role to authenticated, or to a role anon is granted, write an open
-- policy for that role, and pass the check while the clients inherit the policy. This replaces
-- app_private.exposed_schema_findings() once more; only the choice of the policies it reads
-- changes. The per-operation rule of 0009 (app_private.expression_requires_owner) and the other
-- predicates of 0008 (row-level security on every table, security_invoker on every view, no
-- materialized view or foreign table, no privilege for anon) stay as they were.
--
-- The rule: a policy of public applies to a client, and is checked per operation as 0009 says,
-- when any role in its roles (pg_policy.polroles) is
--   * public (oid 0), or
--   * a role that anon or authenticated is a member of, directly or through any chain of grants,
--     as pg_catalog.pg_has_role('anon' or 'authenticated', role, 'MEMBER') reports it. MEMBER
--     counts every membership, with or without INHERIT and with or without SET, so it covers
--     has_privs_of_role (the inherited privileges PostgreSQL applies policies by) and also the
--     roles a client could SET ROLE to; anon and authenticated are each a member of themselves,
--     so the direct case is the same test, or
--   * a role the membership test cannot resolve: an oid with no row in pg_roles (pg_has_role
--     answers false for it, not null) or a null answer of pg_has_role; treated as applying,
--     never as not applying.
-- A policy only for roles that neither anon nor authenticated reaches (the ingest job's own
-- policies) is a server-only policy and is not checked. If anon or authenticated does not exist,
-- pg_has_role raises an error, so the check, and the migration that runs it, fails.

-- Does a policy with these roles (pg_policy.polroles) apply to a client (the rule above)?
create function app_private.policy_reaches_client(roles oid[])
  returns boolean
  language sql stable set search_path = ''
  as $$
    select exists (
      select 1
        from unnest(roles) as r(role)
       where r.role = 0
          or not exists (select 1 from pg_catalog.pg_roles a where a.oid = r.role)
          or coalesce(pg_catalog.pg_has_role('anon', r.role, 'MEMBER'), true)
          or coalesce(pg_catalog.pg_has_role('authenticated', r.role, 'MEMBER'), true)
    )
  $$;
revoke all on function app_private.policy_reaches_client(oid[]) from public, anon, authenticated;

-- 0009's check with the policies chosen by the roles a client holds through membership.
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
             pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check
        from pg_catalog.pg_policy pol
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
       -- the publishable key without a session gets nothing
       union all
       select 'privilege granted to anon'
        where pg_catalog.has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       -- every policy a client role reaches requires the owner for reading where it reads
       union all
       select 'policy ' || p.policyname || ' (for ' || lower(p.cmd) || ') for a client role does not require the owner for reading'
         from client_policies p
        where p.polrelid = c.oid
          and p.cmd in ('ALL', 'SELECT', 'UPDATE', 'DELETE')
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
