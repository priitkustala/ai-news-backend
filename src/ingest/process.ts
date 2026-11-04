// The processing step of the ingestion job in S-02 (priitkustala/ai-news-backend#1): each
// collected feed entry becomes an item row. An entry without a title or an http(s) link is
// counted and dropped; the canonical address is the link without its fragment and without
// `utm_*` parameters (S-04, src/process/dedupe.ts), and the id is its SHA-256 (as in the seed);
// of two entries of one feed with the same canonical address the earlier is kept; a source
// whose display policy is `title-link` keeps no summary. Relevance and categories are S-03's;
// duplicate clusters and the ranking across sources run over the stored items
// (src/process/apply.ts).
import { createHash } from 'node:crypto';
import type { FeedEntry } from '../collect/parse.js';
import { canonicalUrl } from '../process/dedupe.js';

export const PROCESSING_VERSION = 's-04.1';
export const SUMMARY_MAX_CHARS = 1000;

export type ProcessSource = { id: string; display_policy: string };

export type ItemToStore = {
  id: string;
  canonical_url: string;
  source_id: string;
  title: string;
  published_at: string | null;
  summary: string | null;
};

function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function timestamp(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function processEntries(source: ProcessSource, entries: FeedEntry[]): { items: ItemToStore[]; dropped: number } {
  const items: ItemToStore[] = [];
  const seen = new Map<string, number>();
  let dropped = 0;
  for (const entry of entries) {
    const url = canonicalUrl(entry.link);
    if (!url || !entry.title) {
      dropped += 1;
      continue;
    }
    const published_at = timestamp(entry.published);
    const earlier = seen.get(url);
    if (earlier !== undefined) {
      dropped += 1;
      const kept = items[earlier].published_at;
      if (published_at === null || (kept !== null && kept <= published_at)) continue;
    }
    const summary = source.display_policy === 'title-link' || !entry.summary ? null : plainText(entry.summary).slice(0, SUMMARY_MAX_CHARS) || null;
    const item: ItemToStore = {
      id: createHash('sha256').update(url).digest('hex'),
      canonical_url: url,
      source_id: source.id,
      title: entry.title,
      published_at,
      summary,
    };
    // The earlier entry of the same address replaces the later one in its place.
    if (earlier !== undefined) items[earlier] = item;
    else {
      seen.set(url, items.length);
      items.push(item);
    }
  }
  return { items, dropped };
}
