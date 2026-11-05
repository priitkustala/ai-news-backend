-- The feed row carries its source's image policy (priitkustala/ai-news#46, S-09, plan step 2;
-- Locked B-10, Images; Data model, Source: image_policy licensed, owner-accepted hotlink or
-- placeholder, default placeholder). The client decides each item's image slot from the row:
-- a licensed image with its text alternative, an owner-accepted hotlink picture, or the owned
-- placeholder, and writes the policy into data-image-policy. 0001 keeps the policy on
-- app_private.sources, which the client does not read directly, so the feed exposes it beside
-- image_url, taken from the item's source as source_type and source_name already are. An item
-- whose source is gone from configuration reads placeholder, the policy's default.
-- CREATE OR REPLACE keeps 0005's columns in their order (the new column is appended), the
-- view's grants, security_invoker and its read-only trigger (0002); the filter and the order
-- are 0005's.

create or replace view public.feed with (security_invoker = true) as
  select i.id, i.title, i.summary, i.source_id, s.source_type, s.name as source_name,
         i.canonical_url, i.image_url, i.category, i.importance, i.published_at,
         coalesce(s.image_policy, 'placeholder') as image_policy
    from public.items i
    left join app_private.sources s on s.id = i.source_id
   where i.status = 'processed' and i.is_representative and not i.arxiv_capped
   order by i.importance desc nulls last, i.published_at desc nulls last, i.id;
