// Duplicate clusters of the processing step (priitkustala/ai-news-backend#3, S-04; Locked
// B-07): items with the same canonical URL, or with near-identical normalised titles published
// within 48 hours of each other, form one cluster, and the cluster is shown by one
// representative: the item of the highest-weight source, then the earliest. The canonical URL
// is the http(s) link without its fragment and without `utm_*` parameters. Pure functions; the
// stored items are read and marked by src/process/apply.ts.

// Two titles are near-identical when their normalised word sets overlap by at least this share
// (Jaccard index: shared words over all words). Equal normalised titles score 1. At 0.85 a
// substituted word in titles under 13 words is not near-identical ("paper 1" and "paper 2" stay
// apart), and one added or substituted word in a long title is.
export const NEAR_TITLE_MIN_SIMILARITY = 0.85;
// The window of B-07: near-identical titles cluster only when published within 48 hours.
export const NEAR_TITLE_WINDOW_HOURS = 48;

export function canonicalUrl(link: string | null): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    for (const name of [...new Set(url.searchParams.keys())]) {
      if (name.toLowerCase().startsWith('utm_')) url.searchParams.delete(name);
    }
    if (url.searchParams.size === 0) url.search = '';
    return url.toString();
  } catch {
    return null;
  }
}

// Lower case, accents removed, every run of characters that is not a letter or a digit
// becomes one space: "Lab Releases New AI Model!" and "lab releases new AI model" are equal.
export function normaliseTitle(title: string): string {
  return title.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function titleSimilarity(a: string, b: string): number {
  const left = new Set(normaliseTitle(a).split(' ').filter(Boolean));
  const right = new Set(normaliseTitle(b).split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export type ClusterCandidate = {
  id: string;
  canonical_url: string;
  title: string;
  source_weight: number;
  // Publication time in milliseconds, or the fetch time when the feed gave none.
  time: number;
};

// The representative order of B-07: the highest source weight, then the earliest; the id
// keeps the choice deterministic.
export function representativeOrder(a: ClusterCandidate, b: ClusterCandidate): number {
  return b.source_weight - a.source_weight || a.time - b.time || a.id.localeCompare(b.id);
}

export type ClusterMark = { cluster_id: string; is_representative: boolean; cluster_size: number };

// Clusters the items (union-find over both rules) and marks each with its cluster's id, the id
// of the cluster's representative, and the cluster's size.
export function clusterItems(items: ClusterCandidate[]): Map<string, ClusterMark> {
  const parent = items.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) index = parent[index] = parent[parent[index]];
    return index;
  };
  const join = (a: number, b: number) => { parent[find(a)] = find(b); };

  const byUrl = new Map<string, number>();
  items.forEach((item, index) => {
    const key = canonicalUrl(item.canonical_url) ?? item.canonical_url;
    const first = byUrl.get(key);
    if (first === undefined) byUrl.set(key, index);
    else join(index, first);
  });

  // Near-identical titles: each item is compared with the items published after it within the window.
  const window = NEAR_TITLE_WINDOW_HOURS * 3600 * 1000;
  const byTime = items.map((_, index) => index).sort((a, b) => items[a].time - items[b].time);
  for (let i = 0; i < byTime.length; i += 1) {
    const a = items[byTime[i]];
    for (let j = i + 1; j < byTime.length && items[byTime[j]].time - a.time <= window; j += 1) {
      if (titleSimilarity(a.title, items[byTime[j]].title) >= NEAR_TITLE_MIN_SIMILARITY) join(byTime[i], byTime[j]);
    }
  }

  const clusters = new Map<number, ClusterCandidate[]>();
  items.forEach((item, index) => {
    const members = clusters.get(find(index));
    if (members) members.push(item);
    else clusters.set(find(index), [item]);
  });
  const marks = new Map<string, ClusterMark>();
  for (const members of clusters.values()) {
    const representative = [...members].sort(representativeOrder)[0];
    for (const member of members) {
      marks.set(member.id, { cluster_id: representative.id, is_representative: member === representative, cluster_size: members.length });
    }
  }
  return marks;
}
