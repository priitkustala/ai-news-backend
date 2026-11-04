// The score and the per-day arXiv cap of the processing step (priitkustala/ai-news-backend#3,
// S-04; Locked B-08). The score of an item is
//   recency weight x 0.5^(age in hours / half-life) + source weight x the source's weight
//   + cluster-size weight x log2(cluster size) + category weight x the category's weight,
// with the weights of src/process/rank-weights.ts; the `feed` view is ordered by it. Of the
// representatives that are arXiv items, at most the cap per UTC publication day stay in the
// feed: the highest-scored, then the newest; the rest are marked capped. Pure functions; the
// stored items are read and marked by src/process/apply.ts.
import { ARXIV_DAILY_CAP, ARXIV_HOSTS, RANK_WEIGHTS, type RankCategory, type RankWeights } from './rank-weights.js';

export type RankCandidate = {
  id: string;
  canonical_url: string;
  // Publication time in milliseconds, or the fetch time when the feed gave none.
  time: number;
  source_weight: number;
  cluster_size: number;
  category: string | null;
  is_representative: boolean;
};

const HOUR = 3600 * 1000;

export function score(item: RankCandidate, now: number, weights: RankWeights = RANK_WEIGHTS): number {
  const ageHours = Math.max(0, now - item.time) / HOUR;
  const recency = 0.5 ** (ageHours / weights.recencyHalfLifeHours);
  const category = weights.categories[(item.category ?? 'uncategorised') as RankCategory | 'uncategorised'] ?? weights.categories.uncategorised;
  return weights.recency * recency
    + weights.source * item.source_weight
    + weights.clusterSize * Math.log2(Math.max(1, item.cluster_size))
    + weights.category * category;
}

export function isArxiv(canonicalUrl: string): boolean {
  try {
    const host = new URL(canonicalUrl).hostname.toLowerCase();
    return ARXIV_HOSTS.some((arxiv) => host === arxiv || host.endsWith(`.${arxiv}`));
  } catch {
    return false;
  }
}

export type Ranked = { importance: number; arxiv_capped: boolean };

export function rankItems(items: RankCandidate[], now: number, cap: number = ARXIV_DAILY_CAP): Map<string, Ranked> {
  const ranked = new Map<string, Ranked>(items.map((item) => [item.id, { importance: score(item, now), arxiv_capped: false }]));
  const byDay = new Map<string, RankCandidate[]>();
  for (const item of items) {
    if (!item.is_representative || !isArxiv(item.canonical_url)) continue;
    const day = new Date(item.time).toISOString().slice(0, 10);
    const list = byDay.get(day);
    if (list) list.push(item);
    else byDay.set(day, [item]);
  }
  const importance = (item: RankCandidate) => (ranked.get(item.id) as Ranked).importance;
  for (const list of byDay.values()) {
    list.sort((a, b) => importance(b) - importance(a) || b.time - a.time || a.id.localeCompare(b.id));
    for (const item of list.slice(Math.max(0, cap))) (ranked.get(item.id) as Ranked).arxiv_capped = true;
  }
  return ranked;
}
