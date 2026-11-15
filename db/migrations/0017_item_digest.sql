-- The model's digest of the article, for the article page (priitkustala/ai-news-backend#55). The
-- ingestion job's step digest stores a short text the model wrote from the item's fields and its
-- page; the article's own text is never stored. digest_method names how the digest was written,
-- and digest_attempts counts the runs that tried an item without storing one (three stop it).
-- The feed is 0015's view with digest appended as its last column.

alter table public.items
  add column digest text,
  add column digest_method text check (digest_method in ('model')),
  add column digest_attempts integer not null default 0;

create or replace view public.feed with (security_invoker = true) as
  select i.id, i.title, i.summary, i.source_id, s.source_type, s.name as source_name,
         i.canonical_url, i.image_url, i.category, i.importance, i.published_at,
         coalesce(s.image_policy, 'placeholder') as image_policy,
         s.community, i.post_url, i.external_url, i.author_handle, i.digest
    from public.items i
    left join app_private.source_display s on s.id = i.source_id
   where i.status = 'processed' and i.is_representative and not i.arxiv_capped
   order by i.importance desc nulls last, i.published_at desc nulls last, i.id;
grant select on table public.feed to anon;
