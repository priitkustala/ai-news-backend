// The category step of the job module `process` (priitkustala/ai-news-backend#2, S-03;
// Locked B-05): each kept item gets exactly one of the five categories. Source default
// categories first, keyword rules may change them, an item matching none goes to Other:
// a title that matches a keyword rule takes that rule's category (`keyword`, see the order in
// src/process/category-rules.ts); otherwise the source's first default category
// (`source-default`); otherwise Other (`none`). The method is stored as `category_method`.
import { CATEGORIES, CATEGORY_RULES, type Category } from './category-rules.js';
import { matcher } from './relevance.js';

export type CategoryMethod = 'keyword' | 'source-default' | 'none';

export type CategorySource = { default_categories: readonly string[] | null };

const rules = CATEGORY_RULES.map((rule) => ({ category: rule.category, matches: matcher(rule.keywords) }));

const isCategory = (value: string): value is Category => (CATEGORIES as readonly string[]).includes(value);

export function categorise(source: CategorySource, title: string): { category: Category; method: CategoryMethod } {
  const defaults = (source.default_categories ?? []).filter(isCategory).filter((c) => c !== 'other');
  const matched = rules.filter((rule) => rule.matches(title)).map((rule) => rule.category);
  if (matched.length > 0) return { category: matched.find((c) => defaults.includes(c)) ?? matched[0], method: 'keyword' };
  if (defaults.length > 0) return { category: defaults[0], method: 'source-default' };
  return { category: 'other', method: 'none' };
}
