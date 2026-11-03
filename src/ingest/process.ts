// The processing step of the ingestion job in S-02 (priitkustala/ai-news-backend#1): each
// collected feed entry becomes an item row. An entry without a title or an http(s) link is
// counted and dropped; the canonical address is the link without its fragment, and the id is
// its SHA-256 (as in the seed); a source whose display policy is `title-link` keeps no
// summary. Relevance, categories, duplicates and ranking are later steps (S-03, S-04).
import { createHash } from 'node:crypto';
import type { FeedEntry } from '../collect/parse.js';

export const PROCESSING_VERSION = 's-02.1';
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

function canonical(link: string | null): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

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
  const seen = new Set<string>();
  let dropped = 0;
  for (const entry of entries) {
    const url = canonical(entry.link);
    if (!url || !entry.title || seen.has(url)) {
      dropped += 1;
      continue;
    }
    seen.add(url);
    const summary = source.display_policy === 'title-link' || !entry.summary ? null : plainText(entry.summary).slice(0, SUMMARY_MAX_CHARS) || null;
    items.push({
      id: createHash('sha256').update(url).digest('hex'),
      canonical_url: url,
      source_id: source.id,
      title: entry.title,
      published_at: timestamp(entry.published),
      summary,
    });
  }
  return { items, dropped };
}
