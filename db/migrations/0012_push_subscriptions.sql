-- The owner's push subscriptions and the run's notification mark (priitkustala/ai-news#50,
-- S-15; Locked B-14: one notification per run date after the owner subscribes; OD-08: push).
-- The client writes the owner's browser subscription (its endpoint and its keys) under the
-- owner's session, as it writes bookmarks; the job reads them to send. The run date's
-- notification is claimed on its ingestion run (notified_at), so a column on the run and not
-- a table of sends: one run date, one row, one claim, and a rerun finds it set.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz not null default now()
);

-- Grants as 0001 gives bookmarks: closed first, then opened to what the client needs.
revoke all on table public.push_subscriptions from public, anon, authenticated;
grant select, insert, delete on table public.push_subscriptions to authenticated;

-- Row-level security: only the owner's user, written as the bookmarks policies are.
alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_owner_read on public.push_subscriptions for select to authenticated
  using ((select app_private.is_owner()));
create policy push_subscriptions_owner_insert on public.push_subscriptions for insert to authenticated
  with check ((select app_private.is_owner()));
create policy push_subscriptions_owner_delete on public.push_subscriptions for delete to authenticated
  using ((select app_private.is_owner()));

-- The job sends, so it reads the subscriptions; it writes none.
grant select on table public.push_subscriptions to ingest_job;
create policy push_subscriptions_job_read on public.push_subscriptions for select to ingest_job using (true);

-- The run date's notification claim: set once, by the notify command, before it sends.
alter table public.ingestion_runs add column notified_at timestamptz;
