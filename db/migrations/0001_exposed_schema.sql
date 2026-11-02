-- The exposed schema of ai-news (priitkustala/ai-news#40; Locked, Architecture and Data
-- model): five relations in `public` (the schema PostgREST exposes), each readable only by
-- the owner's Supabase user through auth.uid(); the client writes only bookmarks. Job-side
-- configuration lives in `app_private`, which PostgREST does not expose. The same file runs
-- on the local stack and, at Release and run, on the hosted project.

-- Job-side schema: not exposed by the Data API.
create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

-- The owner: the one Supabase user the policies admit. The local seed registers the
-- synthetic test owner; the hosted project registers the owner's own account.
create table app_private.owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique
);
revoke all on table app_private.owner from public, anon, authenticated;

create function app_private.is_owner() returns boolean
  language sql stable security definer set search_path = ''
  as $$ select exists (select 1 from app_private.owner o where o.user_id = (select auth.uid())) $$;
revoke all on function app_private.is_owner() from public, anon;
grant execute on function app_private.is_owner() to authenticated;

-- Sources (Data model, Source; Reddit additions of OD-37 A): the job's configuration.
create table app_private.sources (
  id text primary key,
  name text not null,
  feed_url text not null,
  source_type text not null default 'feed' check (source_type in ('feed', 'reddit')),
  community text,
  default_categories text[] not null default '{}',
  source_weight real not null default 1,
  image_policy text not null default 'placeholder'
    check (image_policy in ('licensed', 'owner-accepted hotlink', 'placeholder')),
  display_policy text not null default 'title-link' check (display_policy in ('title-link', 'feed-summary')),
  enabled boolean not null default true
);
revoke all on table app_private.sources from public, anon, authenticated;
grant select on table app_private.sources to authenticated;
alter table app_private.sources enable row level security;
create policy sources_owner_read on app_private.sources for select to authenticated
  using ((select app_private.is_owner()));

-- Items (Data model, Item). source_id carries no foreign key: an item can outlive its
-- source's removal from configuration until retention purges it (B-22).
create table public.items (
  id text primary key check (id ~ '^[0-9a-f]{64}$'),
  canonical_url text not null unique,
  source_id text not null,
  title text not null,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  image_url text,
  raw jsonb,
  summary text,
  summary_method text,
  ai_relevant boolean,
  relevance_method text,
  category text check (category in ('releases', 'research', 'policy', 'business', 'other')),
  category_method text,
  category_confidence real,
  importance real,
  importance_method text,
  cluster_id text,
  is_representative boolean not null default true,
  processing_version text,
  errors jsonb not null default '[]'::jsonb,
  status text not null default 'collected' check (status in ('collected', 'processed')),
  created_at timestamptz not null default now()
);

-- Ingestion runs (Data model, Ingestion run): one per run date.
create table public.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null unique,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null check (status in ('running', 'completed', 'partial', 'failed', 'abandoned')),
  counts jsonb not null default '{}'::jsonb,
  source_errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Bookmarks (Data model, Bookmark): written by the client under the owner's sign-in; one
-- row per item, kept through retention (no foreign key to items).
create table public.bookmarks (
  item_id text primary key,
  created_at timestamptz not null default now(),
  title text not null,
  link text not null,
  summary text
);

-- The feed (the client's headline list) and the categories with their counts (first
-- shape, AD-04). security_invoker: the reader's own grants and policies apply.
create view public.feed with (security_invoker = true) as
  select i.id, i.title, i.summary, i.source_id, s.source_type, s.name as source_name,
         i.canonical_url, i.image_url, i.category, i.importance, i.published_at
    from public.items i
    left join app_private.sources s on s.id = i.source_id;

create view public.categories with (security_invoker = true) as
  select c.id, c.name, count(i.id)::integer as item_count
    from (values (1, 'releases', 'Model and product releases'),
                 (2, 'research', 'Research'),
                 (3, 'policy', 'Regulation and policy'),
                 (4, 'business', 'Business and developer tools'),
                 (5, 'other', 'Other')) as c (position, id, name)
    left join public.items i on i.category = c.id
   where (select app_private.is_owner())
   group by c.position, c.id, c.name
   order by c.position;

-- Grants: Supabase's default privileges give anon and authenticated every privilege on a
-- new table in public, so each relation is first closed and then opened to what the client
-- needs. anon (the publishable key without a session) gets nothing.
revoke all on table public.items, public.ingestion_runs, public.bookmarks, public.feed, public.categories
  from public, anon, authenticated;
grant select on table public.items, public.ingestion_runs, public.feed, public.categories to authenticated;
grant select, insert, delete on table public.bookmarks to authenticated;

-- Row-level security on every table of the exposed schema: only the owner's user.
alter table public.items enable row level security;
alter table public.ingestion_runs enable row level security;
alter table public.bookmarks enable row level security;
create policy items_owner_read on public.items for select to authenticated
  using ((select app_private.is_owner()));
create policy ingestion_runs_owner_read on public.ingestion_runs for select to authenticated
  using ((select app_private.is_owner()));
create policy bookmarks_owner_read on public.bookmarks for select to authenticated
  using ((select app_private.is_owner()));
create policy bookmarks_owner_insert on public.bookmarks for insert to authenticated
  with check ((select app_private.is_owner()));
create policy bookmarks_owner_delete on public.bookmarks for delete to authenticated
  using ((select app_private.is_owner()));

-- The ingestion job's scoped database role (OD-36: limited to the ingestion tables). Its
-- password is set by the migration command from the environment, never here.
do $$
begin
  if not exists (select from pg_roles where rolname = 'ingest_job') then
    create role ingest_job nologin noinherit;
  end if;
end
$$;
grant usage on schema public, app_private to ingest_job;
grant select on table app_private.sources to ingest_job;
grant select, insert, update, delete on table public.items, public.ingestion_runs to ingest_job;
grant select on table public.bookmarks to ingest_job;
create policy sources_job_read on app_private.sources for select to ingest_job using (true);
create policy items_job_all on public.items for all to ingest_job using (true) with check (true);
create policy ingestion_runs_job_all on public.ingestion_runs for all to ingest_job using (true) with check (true);
create policy bookmarks_job_read on public.bookmarks for select to ingest_job using (true);
