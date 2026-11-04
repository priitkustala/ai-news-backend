// The processing step over the stored items (priitkustala/ai-news-backend#3, S-04): after a
// run has stored its new items, every processed item is clustered again with the items stored
// by earlier runs (a duplicate can arrive a day later), and each item's cluster_id and
// is_representative are written where they changed. Runs inside the run's write transaction,
// so a run whose writes fail leaves the marks as they were. Logs counts only (Locked R-21).
import type { Client } from '../db.js';
import { clusterItems, type ClusterCandidate } from './dedupe.js';

type StoredRow = {
  id: string;
  canonical_url: string;
  title: string;
  published_at: Date | null;
  fetched_at: Date;
  source_weight: number;
};

export async function applyProcessing(client: Client, log: (line: string) => void): Promise<{ items: number; clusters: number; hidden: number }> {
  // An item whose source is no longer configured weighs 0, so a configured source's copy represents the cluster.
  const rows = (await client.query<StoredRow>(
    `select i.id, i.canonical_url, i.title, i.published_at, i.fetched_at, coalesce(s.source_weight, 0)::float8 as source_weight
       from public.items i
       left join app_private.sources s on s.id = i.source_id
      where i.status = 'processed'`,
  )).rows;
  const candidates: ClusterCandidate[] = rows.map((row) => ({
    id: row.id,
    canonical_url: row.canonical_url,
    title: row.title,
    source_weight: Number(row.source_weight),
    time: (row.published_at ?? row.fetched_at).getTime(),
  }));
  const marks = clusterItems(candidates);
  const ids = candidates.map((item) => item.id);
  await client.query(
    `update public.items i
        set cluster_id = u.cluster_id, is_representative = u.is_representative
       from unnest($1::text[], $2::text[], $3::boolean[]) as u (id, cluster_id, is_representative)
      where i.id = u.id
        and (i.cluster_id is distinct from u.cluster_id or i.is_representative is distinct from u.is_representative)`,
    [ids, ids.map((id) => marks.get(id)?.cluster_id), ids.map((id) => marks.get(id)?.is_representative)],
  );
  const clusters = new Set([...marks.values()].map((mark) => mark.cluster_id)).size;
  const hidden = candidates.length - clusters;
  log(`ingest: processing: ${candidates.length} stored items in ${clusters} clusters, ${hidden} duplicates not shown`);
  return { items: candidates.length, clusters, hidden };
}
