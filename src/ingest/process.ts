// The processing step of the ingestion job (S-02, priitkustala/ai-news-backend#1; S-03,
// priitkustala/ai-news-backend#2; S-04, priitkustala/ai-news-backend#3): each collected feed
// entry becomes an item row. An entry without a title or an http(s) link is counted and
// dropped; the canonical address is the link without its fragment and without `utm_*`
// parameters (S-04, src/process/dedupe.ts), and the id is its SHA-256 (as in the seed); of two
// entries of one feed with the same canonical address the earlier is kept; a source whose
// display policy is `title-link` keeps no summary. Only AI-relevant entries are kept (B-04,
// src/process/relevance.ts); the others are counted as not relevant. Each kept item gets one
// of the five categories (B-05, src/process/category.ts). Duplicate clusters and the ranking
// across sources run over the stored items (src/process/apply.ts).
import { createHash } from 'node:crypto';
import type { FeedEntry } from '../collect/parse.js';
import { canonicalUrl } from '../process/dedupe.js';
import { relevance, type RelevanceMethod } from '../process/relevance.js';
import { categorise, type CategoryMethod } from '../process/category.js';
import type { Category } from '../process/category-rules.js';

export const PROCESSING_VERSION = 's-04.1';
export const SUMMARY_MAX_CHARS = 1000;

export type ProcessSource = { id: string; source_type: string; display_policy: string; default_categories: string[] | null };

export type ItemToStore = {
  id: string;
  canonical_url: string;
  source_id: string;
  title: string;
  published_at: string | null;
  summary: string | null;
  relevance_method: RelevanceMethod;
  category: Category;
  category_method: CategoryMethod;
};

function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function timestamp(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function processEntries(source: ProcessSource, entries: FeedEntry[]): { items: ItemToStore[]; dropped: number; notRelevant: number } {
  type Kept = Omit<ItemToStore, 'relevance_method' | 'category' | 'category_method'>;
  const kept: Kept[] = [];
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
      const first = kept[earlier].published_at;
      if (published_at === null || (first !== null && first <= published_at)) continue;
    }
    const summary = source.display_policy === 'title-link' || !entry.summary ? null : plainText(entry.summary).slice(0, SUMMARY_MAX_CHARS) || null;
    const item: Kept = {
      id: createHash('sha256').update(url).digest('hex'),
      canonical_url: url,
      source_id: source.id,
      title: entry.title,
      published_at,
      summary,
    };
    // The earlier entry of the same address replaces the later one in its place.
    if (earlier !== undefined) kept[earlier] = item;
    else {
      seen.set(url, kept.length);
      kept.push(item);
    }
  }
  // Relevance and the category are decided on the entry that represents its address in the feed.
  const items: ItemToStore[] = [];
  let notRelevant = 0;
  for (const item of kept) {
    const relevanceMethod = relevance(source, item.title);
    if (!relevanceMethod) {
      notRelevant += 1;
      continue;
    }
    const { category, method: categoryMethod } = categorise(source, item.title);
    items.push({ ...item, relevance_method: relevanceMethod, category, category_method: categoryMethod });
  }
  return { items, dropped, notRelevant };
}
