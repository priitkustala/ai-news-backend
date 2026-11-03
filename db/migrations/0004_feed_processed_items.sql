-- The feed serves processed items only (priitkustala/ai-news-backend#1, S-02; brief 02 step 2,
-- "the feed view of processed items"). The ingestion job stores an item as `collected` and
-- marks it `processed` once its processing step has run, so an item a run left part-way is
-- never shown. 0001 already created what S-02 records a run in: `ingestion_runs` (run date
-- unique, the five statuses, counts, per-source errors), `items` and `app_private.sources`,
-- with the owner-only policies and the job's scoped role; they are kept as they are.
-- CREATE OR REPLACE keeps the view's columns, grants, security_invoker and its read-only
-- trigger (0002).

create or replace view public.feed with (security_invoker = true) as
  select i.id, i.title, i.summary, i.source_id, s.source_type, s.name as source_name,
         i.canonical_url, i.image_url, i.category, i.importance, i.published_at
    from public.items i
    left join app_private.sources s on s.id = i.source_id
   where i.status = 'processed';
