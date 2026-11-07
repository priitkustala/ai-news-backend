// The retention step of a run (priitkustala/ai-news-backend#5, S-17; Locked B-22, B-15, OD-20):
// the stored items of a source that is no longer configured (no row in app_private.sources; a
// source with enabled false is still configured) and the stored items older than the retention
// window are deleted, and a bookmarked item never is (B-15). An item's age is
// coalesce(published_at, fetched_at), as the feed window counts it. Bookmarks have no foreign
// key to items, so no bookmark row is touched; the job reads bookmarks.item_id only
// (db/migrations/0013). Runs inside the run's write transaction, so a run whose writes fail
// deletes nothing. Returns counts only (Locked R-21).
import type { Client } from '../db.js';

// OD-20, the retention window of unbookmarked items: 30 days (owner decision of 2026-11-07,
// owner question 1, answered A: 30 days).
export const RETENTION_DAYS = 30;

export type RetentionCounts = { deleted_removed_source: number; deleted_old: number };

export async function retain(client: Client): Promise<RetentionCounts> {
  // An item that matches both is deleted, and counted, by the first statement.
  const removedSource = await client.query(
    `delete from public.items i
      where not exists (select 1 from app_private.sources s where s.id = i.source_id)
        and not exists (select 1 from public.bookmarks b where b.item_id = i.id)`,
  );
  const old = await client.query(
    `delete from public.items i
      where coalesce(i.published_at, i.fetched_at) < now() - make_interval(days => $1)
        and not exists (select 1 from public.bookmarks b where b.item_id = i.id)`,
    [RETENTION_DAYS],
  );
  return { deleted_removed_source: removedSource.rowCount ?? 0, deleted_old: old.rowCount ?? 0 };
}
