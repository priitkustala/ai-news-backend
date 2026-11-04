-- The feed serves one row per duplicate cluster, ordered by the stored score
-- (priitkustala/ai-news-backend#3, S-04; Locked B-07, B-08; Data model, Item: cluster_id,
-- is_representative, importance). The job's processing step marks every stored item with its
-- cluster (cluster_id, the id of the cluster's representative) and whether it is that
-- representative, stores its score in importance, and marks the arXiv items of a day beyond
-- the configured daily cap with arxiv_capped (src/process/dedupe.ts, src/process/rank.ts).
-- An item no run has ranked yet (a seeded row) keeps the defaults: its own representative,
-- not capped, no score, so it is listed after the scored items, newest first.
-- CREATE OR REPLACE keeps the view's columns, grants, security_invoker and its read-only
-- trigger (0002). The client pages the ordered view with PostgREST's limit and offset (or a
-- Range header), or orders explicitly by importance.

alter table public.items add column arxiv_capped boolean not null default false;

create or replace view public.feed with (security_invoker = true) as
  select i.id, i.title, i.summary, i.source_id, s.source_type, s.name as source_name,
         i.canonical_url, i.image_url, i.category, i.importance, i.published_at
    from public.items i
    left join app_private.sources s on s.id = i.source_id
   where i.status = 'processed' and i.is_representative and not i.arxiv_capped
   order by i.importance desc nulls last, i.published_at desc nulls last, i.id;
