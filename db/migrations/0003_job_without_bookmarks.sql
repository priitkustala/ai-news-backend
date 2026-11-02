-- The ingestion role reads and writes the ingestion tables only (priitkustala/ai-news#40,
-- repair round 2, finding F40-2; OD-36): 0001 also gave it a read of every bookmark, which
-- the job does not use. Bookmarks are written by the client under the owner's session.

drop policy bookmarks_job_read on public.bookmarks;
revoke all on table public.bookmarks from ingest_job;
