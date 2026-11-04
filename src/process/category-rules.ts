// The category rules of the job module `process` (priitkustala/ai-news-backend#2, S-03;
// Locked B-05, D-05, D-06, W4 section 6 step 4). Source code, not configuration: a change to
// a rule is a code change reviewed in a pull request (brief 03, Configuration and tripwire
// files). The source default categories are the source configuration's own
// (`app_private.sources.default_categories`).
import type { Keyword } from './keywords.js';

export const CATEGORIES = ['releases', 'research', 'policy', 'business', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

const acronym = (term: string): Keyword => ({ term, caseSensitive: true });
const phrase = (term: string): Keyword => ({ term, caseSensitive: false });
const phrases = (...terms: string[]) => terms.map(phrase);

// The keyword rules, in the order they are tried: when a title matches more than one rule,
// the first matching rule that is also one of the source's default categories wins, and
// otherwise the first matching rule. Policy comes first because a regulation story about a
// release or a company is a policy story; research before releases, because a paper about a
// model is research; business last, because funding and pricing words also appear in
// release news. Other has no rule: it is what matches none.
export const CATEGORY_RULES: readonly { category: Exclude<Category, 'other'>; keywords: readonly Keyword[] }[] = [
  {
    category: 'policy',
    keywords: [
      acronym('AI Act'), acronym('FTC'), acronym('EU'),
      ...phrases('regulation', 'regulations', 'regulator', 'regulators', 'regulate', 'regulates', 'regulatory',
        'legislation', 'lawmakers', 'law', 'laws', 'bill', 'policy', 'policies', 'government', 'executive order',
        'ban', 'bans', 'compliance', 'guidance', 'rule', 'rules', 'rulemaking', 'senate', 'congress', 'parliament',
        'European Commission', 'court', 'lawsuit', 'copyright'),
    ],
  },
  {
    category: 'research',
    keywords: [
      ...phrases('research', 'researchers', 'paper', 'papers', 'study', 'studies', 'benchmark', 'benchmarks',
        'arXiv', 'preprint', 'dataset', 'datasets', 'peer-reviewed', 'scientists'),
    ],
  },
  {
    category: 'releases',
    keywords: [
      ...phrases('release', 'releases', 'released', 'launch', 'launches', 'launched', 'introduces', 'introducing',
        'unveils', 'ships', 'update', 'updates', 'rolls out', 'now available', 'model card', 'system card',
        'open-weights', 'open-weight', 'open weights', 'preview', 'beta'),
    ],
  },
  {
    category: 'business',
    keywords: [
      acronym('IPO'), acronym('CEO'), acronym('SDK'), acronym('API'),
      ...phrases('startup', 'startups', 'funding', 'raises', 'raised', 'acquisition', 'acquires', 'acquired',
        'merger', 'revenue', 'valuation', 'investment', 'invests', 'investors', 'partnership', 'enterprise',
        'pricing', 'layoffs', 'earnings', 'developer tools', 'developer tool'),
    ],
  },
];
