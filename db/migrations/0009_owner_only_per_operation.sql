-- The owner-only check per operation (priitkustala/ai-news#43, S-05, repair round 2, finding
-- F-S05-1). 0008's check accepted a client policy whose USING and WITH CHECK, joined into one
-- text, mentioned app_private.is_owner() anywhere, so a policy with using (true) and the owner
-- only in WITH CHECK admitted every signed-in reader and still passed. This replaces the policy
-- predicate of app_private.exposed_schema_findings(); its other predicates stay as 0008 wrote
-- them (row-level security on every table, security_invoker on every view, no materialized view
-- or foreign table, no privilege for anon).
--
-- The rule, for every policy of public whose roles include public, anon or authenticated:
--   * the expression that governs reading, USING (qual), must require the owner when the policy
--     applies to SELECT, UPDATE, DELETE or ALL;
--   * the expression that governs writing, WITH CHECK, or USING where WITH CHECK is absent (as
--     PostgreSQL applies it), must require the owner when the policy applies to INSERT, UPDATE
--     or ALL;
--   * an expression requires the owner only when, as PostgreSQL stores it (pg_policies), it is
--     the owner call alone, app_private.is_owner() or (select app_private.is_owner()), or an AND
--     conjunction with such a call as one of its top-level conjuncts (conjuncts are read the same
--     way, so a nested AND counts). Anything else is a finding: a missing expression, an OR or a
--     negation at the top level, CASE or BETWEEN at the top level, a quoted literal or identifier
--     anywhere (it could hide a parenthesis or a keyword), and unbalanced parentheses.

-- Does expr, a policy expression as pg_policies prints it, require the owner (the rule above)?
create function app_private.expression_requires_owner(expr text)
  returns boolean
  language plpgsql immutable set search_path = ''
  as $$
    declare
      e text := btrim(expr);
      depth integer;
      closes_at_end boolean;
      conjunct_start integer := 1;
      conjuncts text[] := '{}';
      ch text;
    begin
      if e is null or e = '' then return false; end if;
      if position('''' in e) > 0 or position('"' in e) > 0 then return false; end if;
      -- strip the parentheses that enclose the whole expression
      loop
        exit when left(e, 1) <> '(' or right(e, 1) <> ')';
        depth := 0;
        closes_at_end := false;
        for i in 1 .. length(e) loop
          ch := substr(e, i, 1);
          if ch = '(' then depth := depth + 1;
          elsif ch = ')' then depth := depth - 1;
          end if;
          if depth = 0 then
            closes_at_end := (i = length(e));
            exit;
          end if;
        end loop;
        exit when not closes_at_end;
        e := btrim(substr(e, 2, length(e) - 2));
      end loop;
      if e in ('app_private.is_owner()', 'SELECT app_private.is_owner() AS is_owner') then return true; end if;
      -- split at the AND of the top level; an OR, a NOT, CASE or BETWEEN there is not a requirement
      depth := 0;
      for i in 1 .. length(e) loop
        ch := substr(e, i, 1);
        if ch = '(' then depth := depth + 1;
        elsif ch = ')' then
          depth := depth - 1;
          if depth < 0 then return false; end if;
        elsif depth = 0 then
          if upper(substr(e, i, 4)) = ' OR ' or upper(substr(e, i, 6)) in (' CASE ', ' WHEN ') or upper(substr(e, i, 9)) = ' BETWEEN ' then
            return false;
          end if;
          if upper(substr(e, i, 5)) = ' AND ' then
            conjuncts := conjuncts || substr(e, conjunct_start, i - conjunct_start);
            conjunct_start := i + 5;
          end if;
        end if;
      end loop;
      if depth <> 0 then return false; end if;
      if upper(left(e, 4)) in ('NOT ', 'NOT(') or upper(left(e, 5)) = 'CASE ' then return false; end if;
      if cardinality(conjuncts) = 0 then return false; end if;
      conjuncts := conjuncts || substr(e, conjunct_start);
      for i in 1 .. cardinality(conjuncts) loop
        if app_private.expression_requires_owner(conjuncts[i]) then return true; end if;
      end loop;
      return false;
    end
  $$;
revoke all on function app_private.expression_requires_owner(text) from public, anon, authenticated;

-- 0008's check with the policy predicate per operation.
create or replace function app_private.exposed_schema_findings()
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
       -- every policy a client role can reach requires the owner for reading where it reads
       union all
       select 'policy ' || p.policyname || ' (for ' || lower(p.cmd) || ') for a client role does not require the owner for reading'
         from pg_catalog.pg_policies p
        where p.schemaname = n.nspname and p.tablename = c.relname
          and p.roles && array['public', 'anon', 'authenticated']::name[]
          and p.cmd in ('ALL', 'SELECT', 'UPDATE', 'DELETE')
          and not app_private.expression_requires_owner(p.qual)
       -- and for writing where it writes
       union all
       select 'policy ' || p.policyname || ' (for ' || lower(p.cmd) || ') for a client role does not require the owner for writing'
         from pg_catalog.pg_policies p
        where p.schemaname = n.nspname and p.tablename = c.relname
          and p.roles && array['public', 'anon', 'authenticated']::name[]
          and p.cmd in ('ALL', 'INSERT', 'UPDATE')
          and not app_private.expression_requires_owner(coalesce(p.with_check, p.qual))
     ) f
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     order by 1, 2
  $$;
revoke all on function app_private.exposed_schema_findings() from public, anon, authenticated;
