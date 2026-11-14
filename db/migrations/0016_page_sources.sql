-- A source can be a vendor's own news page, the source kind `page` (priitkustala/ai-news-backend#41):
-- the job reads the page's post links and dates when the vendor publishes no feed. The check on
-- app_private.sources.source_type is the unnamed column check of 0001, which PostgreSQL named
-- sources_source_type_check; it is replaced under the same name, so the kind's check keeps one name.
alter table app_private.sources
  drop constraint sources_source_type_check,
  add constraint sources_source_type_check check (source_type in ('feed', 'reddit', 'page'));
