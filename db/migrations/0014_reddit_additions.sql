-- The Reddit additions (priitkustala/ai-news#44, S-07; Locked, Data model, Reddit additions;
-- B-26). An item collected from a Reddit community keeps the address of its Reddit post, the
-- address of the external page it links to and its author's handle; the feed row carries
-- them, with the community of the item's source, so the client can show a Reddit item with
-- its attribution. CREATE OR REPLACE keeps 0011's columns in their order (the new columns are
-- appended), the view's grants, security_invoker and its read-only trigger (0002); the joins,
-- the filter and the order are 0011's.

alter table public.items
  add column post_url text,
  add column external_url text,
  add column author_handle text;

create or replace view public.feed with (security_invoker = true) as
  select i.id, i.title, i.summary, i.source_id, s.source_type, s.name as source_name,
         i.canonical_url, i.image_url, i.category, i.importance, i.published_at,
         coalesce(s.image_policy, 'placeholder') as image_policy,
         s.community, i.post_url, i.external_url, i.author_handle
    from public.items i
    left join app_private.sources s on s.id = i.source_id
   where i.status = 'processed' and i.is_representative and not i.arxiv_capped
   order by i.importance desc nulls last, i.published_at desc nulls last, i.id;

-- For the local test environment only: a one-row flag that marks the Reddit credentials
-- withheld, so a seeded set can state "no Reddit credentials" while the stack's environment
-- carries the local test values (the command relay passes arguments only). Written only by
-- the seed, never present in the hosted database (the seed never runs there); when it holds
-- a row, the job treats the credentials as unset. It holds no credential.
create table app_private.reddit_credentials_withheld (
  withheld boolean primary key default true check (withheld)
);
revoke all on table app_private.reddit_credentials_withheld from public, anon, authenticated;
grant select on table app_private.reddit_credentials_withheld to ingest_job;
alter table app_private.reddit_credentials_withheld enable row level security;
create policy reddit_credentials_withheld_job_read on app_private.reddit_credentials_withheld
  for select to ingest_job using (true);
