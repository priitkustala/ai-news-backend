-- Relevance and category methods, and the Other share of the categories view
-- (priitkustala/ai-news-backend#2, S-03; Locked B-04 to B-06; brief 03 step 2).
--
-- `items.relevance_method` and `items.category_method` were already created by 0001 with the
-- rest of the Item entity, so this migration only documents what the job writes there
-- (src/process/relevance.ts and src/process/category.ts).
--
-- The categories view gains `other_share` and `over_threshold` by the rule of OD-15
-- (owner, 2026-11-03; Decisions table row of 2026-11-04): the share of representative items
-- (after deduplication; until S-04 every kept item is its own representative) that are in
-- Other, over a 7-day rolling window ending at the run date; `over_threshold` is true when
-- the share exceeds 0.30. The window is the 7 x 24 hours before the view is read (on a run
-- date, after its run), by an item's publication time or, without one, its fetch time; a
-- span in hours keeps the rule independent of the run time zone (OD-09, open). The share is
-- null, and the notice false, when the window holds no representative item. Crossing the
-- threshold only sets the notice: the five categories never change (B-06, D-06). Both
-- columns are the window's and carry the same value on every row.
--
-- CREATE OR REPLACE appends the two columns and keeps the view's grants, security_invoker
-- and its read-only trigger (0002).

comment on column public.items.relevance_method is
  'Which rule kept the item (B-04): source (a whole-feed AI source), keyword (a general source, an AI keyword matched) or seed (local fixtures).';
comment on column public.items.category_method is
  'Which rule gave the category (B-05): keyword (a keyword rule), source-default (the source''s first default category), none (no rule matched: Other) or seed (local fixtures).';

create or replace view public.categories with (security_invoker = true) as
  with window_items as (
    select i.category
      from public.items i
     where i.status = 'processed'
       and i.is_representative
       and coalesce(i.published_at, i.fetched_at) > now() - interval '7 days'
  ), share as (
    select round(count(*) filter (where category = 'other')::numeric / nullif(count(*), 0), 4) as other_share
      from window_items
  )
  select c.id, c.name, count(i.id)::integer as item_count,
         s.other_share,
         coalesce(s.other_share > 0.30, false) as over_threshold
    from (values (1, 'releases', 'Model and product releases'),
                 (2, 'research', 'Research'),
                 (3, 'policy', 'Regulation and policy'),
                 (4, 'business', 'Business and developer tools'),
                 (5, 'other', 'Other')) as c (position, id, name)
    cross join share s
    left join public.items i on i.category = c.id
   where (select app_private.is_owner())
   group by c.position, c.id, c.name, s.other_share
   order by c.position;
