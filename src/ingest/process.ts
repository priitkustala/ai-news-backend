// The processing step of the ingestion job (S-02, priitkustala/ai-news-backend#1; S-03,
// priitkustala/ai-news-backend#2; S-04, priitkustala/ai-news-backend#3): each collected feed
// entry becomes an item row. Markup is stripped from the title before it is judged (S-11,
// priitkustala/ai-news#47; B-03), so a stored title is plain text and is the text that was
// judged. An entry without a title (after stripping) or an http(s) link is counted and
// dropped; the canonical address is the link without its fragment and without `utm_*`
// parameters (S-04, src/process/dedupe.ts), and the id is its SHA-256 (as in the seed); of two
// entries of one feed with the same canonical address the earlier is kept; a source whose
// display policy is `title-link` keeps no summary; a summary longer than SUMMARY_MAX_CHARS is
// cut after its last sentence end within it, or at its last space with an ellipsis (B-09,
// priitkustala/ai-news#109). Only AI-relevant entries are kept (B-04,
// src/process/relevance.ts); the others are counted as not relevant. Each kept item gets one
// of the five categories (B-05, src/process/category.ts). Duplicate clusters and the ranking
// across sources run over the stored items (src/process/apply.ts).
import { createHash } from 'node:crypto';
import type { FeedEntry } from '../collect/parse.js';
import { canonicalUrl } from '../process/dedupe.js';
import { relevance, type RelevanceMethod } from '../process/relevance.js';
import { categorise, type CategoryMethod } from '../process/category.js';
import type { Category } from '../process/category-rules.js';

export const PROCESSING_VERSION = 's-11.1';
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

// The summary bound: text of at most SUMMARY_MAX_CHARS stays; a longer text is cut after its
// last full stop, exclamation mark or question mark followed by a space within the bound, else
// at its last space with one ellipsis, else after SUMMARY_MAX_CHARS - 1 characters with the ellipsis.
export function cutSummary(text: string): string {
  if (text.length <= SUMMARY_MAX_CHARS) return text;
  for (let i = SUMMARY_MAX_CHARS - 1; i >= 0; i -= 1) {
    if ('.!?'.includes(text[i]) && text[i + 1] === ' ') return text.slice(0, i + 1);
  }
  const space = text.slice(0, SUMMARY_MAX_CHARS).lastIndexOf(' ');
  if (space > 0) return `${text.slice(0, space)}\u2026`;
  return `${text.slice(0, SUMMARY_MAX_CHARS - 1)}\u2026`;
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
    const title = plainText(entry.title);
    if (!url || !title) {
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
    const summary = source.display_policy === 'title-link' || !entry.summary ? null : cutSummary(plainText(entry.summary)) || null;
    const item: Kept = {
      id: createHash('sha256').update(url).digest('hex'),
      canonical_url: url,
      source_id: source.id,
      title,
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
