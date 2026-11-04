// The ranking weights and the per-day arXiv cap (priitkustala/ai-news-backend#3, S-04; Locked
// B-08). These are the values this build and its scenarios use; the starting values for real
// runs are the owner's decision OD-26 (open), set after the first scored sample of S-06. A
// change of a value is a code change reviewed in a pull request. The cap is the one the fixture
// manifest of AC-08 names (src/seed-data.ts reads it from here); the other weights are neutral
// starting points: every source and every category weighs the same until OD-26 says otherwise.

export type RankCategory = 'releases' | 'research' | 'policy' | 'business' | 'other';

export type RankWeights = {
  // Weight of recency, a value from 1 (just published) halving every recencyHalfLifeHours.
  recency: number;
  recencyHalfLifeHours: number;
  // Weight of the source's configured source_weight (app_private.sources, default 1).
  source: number;
  // Weight of log2 of the cluster's size: a story several sources carry ranks higher.
  clusterSize: number;
  // Weight of the category's weight below; an item without a category (before S-03) takes `uncategorised`.
  category: number;
  categories: Record<RankCategory | 'uncategorised', number>;
};

export const RANK_WEIGHTS: RankWeights = {
  recency: 1,
  recencyHalfLifeHours: 24,
  source: 1,
  clusterSize: 0.5,
  category: 1,
  categories: { releases: 1, research: 1, policy: 1, business: 1, other: 1, uncategorised: 1 },
};

// At most this many arXiv items per day (UTC date of publication) are shown in the feed.
export const ARXIV_DAILY_CAP = 10;

// An item is an arXiv item when its canonical address is on one of these hosts or below them.
export const ARXIV_HOSTS = ['arxiv.org'];

// Stored with each score as importance_method, so a score can be traced to the rule that made it.
export const RANK_METHOD = 'rank:s-04.1';
