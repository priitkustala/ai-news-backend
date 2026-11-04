// The AI relevance rule of the job module `process` (priitkustala/ai-news-backend#2, S-03;
// Locked B-04): items of a source whose whole feed is AI-specific pass (`source`); items of a
// general source pass only when their title matches the AI keyword list (`keyword`); every
// other item is not kept. The title is what a headline is about; a summary is absent for
// many sources (title-link display, feeds without summaries), so matching it would make the
// rule differ by source. The method that kept an item is stored as `relevance_method`.
import { AI_KEYWORDS, AI_SOURCE_IDS, FIXTURE_AI_SOURCE_IDS, type Keyword } from './keywords.js';

export type RelevanceMethod = 'source' | 'keyword';

export type RelevanceSource = { id: string; source_type: string };

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One whole-word pattern per keyword: no letter or digit directly before or after it.
export function keywordPattern(keywords: readonly Keyword[], flags = ''): RegExp | null {
  if (keywords.length === 0) return null;
  const alternatives = [...keywords].sort((a, b) => b.term.length - a.term.length).map((k) => escape(k.term));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`, `u${flags}`);
}

// Matches when any keyword matches, each in its own case rule.
export function matcher(keywords: readonly Keyword[]): (text: string) => boolean {
  const sensitive = keywordPattern(keywords.filter((k) => k.caseSensitive));
  const insensitive = keywordPattern(keywords.filter((k) => !k.caseSensitive), 'i');
  return (text) => Boolean(sensitive?.test(text) || insensitive?.test(text));
}

const aiSources = new Set([...AI_SOURCE_IDS, ...FIXTURE_AI_SOURCE_IDS]);
const matchesAiKeyword = matcher(AI_KEYWORDS);

export function isAiSource(source: RelevanceSource): boolean {
  return source.source_type === 'reddit' || aiSources.has(source.id);
}

// The method that keeps the item, or null when the item is not AI-relevant.
export function relevance(source: RelevanceSource, title: string): RelevanceMethod | null {
  if (isAiSource(source)) return 'source';
  return matchesAiKeyword(title) ? 'keyword' : null;
}
