// The processing step over the stored items (priitkustala/ai-news-backend#3, S-04): after a
// run has stored its new items, every processed item is clustered again with the items stored
// by earlier runs (a duplicate can arrive a day later), scored at the run's time, and the arXiv
// items beyond the daily cap are marked. Each item's cluster_id, is_representative,
// importance, importance_method and arxiv_capped are written. Runs inside the run's write
// transaction, so a run whose writes fail leaves the marks as they were. Logs counts only
// (Locked R-21).
import type { Client } from '../db.js';
import { clusterItems, type ClusterCandidate } from './dedupe.js';
import { rankItems } from './rank.js';
import { RANK_METHOD } from './rank-weights.js';

type StoredRow = {
  id: string;
  canonical_url: string;
  title: string;
  category: string | null;
  published_at: Date | null;
  fetched_at: Date;
  source_weight: number;
};

export type ProcessingCounts = { items: number; clusters: number; hidden: number; arxiv_capped: number };

export async function applyProcessing(client: Client, log: (line: string) => void, now: number = Date.now()): Promise<ProcessingCounts> {
  // An item whose source is no longer configured weighs 0, so a configured source's copy represents the cluster.
  const rows = (await client.query<StoredRow>(
    `select i.id, i.canonical_url, i.title, i.category, i.published_at, i.fetched_at,
            coalesce(s.source_weight, 0)::float8 as source_weight
       from public.items i
       left join app_private.sources s on s.id = i.source_id
      where i.status = 'processed'`,
  )).rows;
  const candidates: (ClusterCandidate & { category: string | null })[] = rows.map((row) => ({
    id: row.id,
    canonical_url: row.canonical_url,
    title: row.title,
    category: row.category,
    source_weight: Number(row.source_weight),
    time: (row.published_at ?? row.fetched_at).getTime(),
  }));
  const marks = clusterItems(candidates);
  const ranked = rankItems(candidates.map((item) => {
    const mark = marks.get(item.id)!;
    return { ...item, cluster_size: mark.cluster_size, is_representative: mark.is_representative };
  }), now);

  const ids = candidates.map((item) => item.id);
  await client.query(
    `update public.items i
        set cluster_id = u.cluster_id, is_representative = u.is_representative,
            importance = u.importance, importance_method = $6, arxiv_capped = u.arxiv_capped
       from unnest($1::text[], $2::text[], $3::boolean[], $4::real[], $5::boolean[])
            as u (id, cluster_id, is_representative, importance, arxiv_capped)
      where i.id = u.id`,
    [ids, ids.map((id) => marks.get(id)!.cluster_id), ids.map((id) => marks.get(id)!.is_representative),
      ids.map((id) => ranked.get(id)!.importance), ids.map((id) => ranked.get(id)!.arxiv_capped), RANK_METHOD],
  );
  const clusters = new Set([...marks.values()].map((mark) => mark.cluster_id)).size;
  const counts = {
    items: candidates.length,
    clusters,
    hidden: candidates.length - clusters,
    arxiv_capped: [...ranked.values()].filter((rank) => rank.arxiv_capped).length,
  };
  log(`ingest: processing: ${counts.items} stored items in ${counts.clusters} clusters, ${counts.hidden} duplicates not shown, `
    + `${counts.arxiv_capped} arXiv items over the daily cap not shown`);
  return counts;
}
