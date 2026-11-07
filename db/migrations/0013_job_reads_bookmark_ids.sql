-- The ingestion job reads the ids of the owner's bookmarks, and nothing else of them, so that
-- retention keeps every bookmarked item (priitkustala/ai-news-backend#5, S-17; B-15, B-22).
-- 0003 took the job's read of bookmarks away because the job did not use it; retention does.
grant select (item_id) on table public.bookmarks to ingest_job;
create policy bookmarks_job_read on public.bookmarks for select to ingest_job using (true);
