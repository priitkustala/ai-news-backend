// The base seed and the fixture sets of the local test environment (priitkustala/ai-news#40;
// Locked, Local test environment, row PostgreSQL; both repositories' tests/README-testids.md,
// section Fixture sets). Every value is synthetic. A fixture set is a complete Given: the seed
// resets the run records, the source configuration, the stored items and the bookmarks to the
// base seed plus that set. Feeds a later run reads are served by the fixture feed server
// (fixtures/server.mjs), addressed with the run marker so their content carries it.
import { createHash } from 'node:crypto';
import { ARXIV_DAILY_CAP } from './process/rank-weights.js';

export type Category = 'releases' | 'research' | 'policy' | 'business' | 'other';
export const CATEGORY_NAMES: Record<Category, string> = {
  releases: 'Model and product releases',
  research: 'Research',
  policy: 'Regulation and policy',
  business: 'Business and developer tools',
  other: 'Other',
};

export type SourceRow = {
  id: string;
  name: string;
  feed_url: string;
  source_type?: 'feed' | 'reddit';
  community?: string | null;
  default_categories?: Category[];
  image_policy?: 'licensed' | 'owner-accepted hotlink' | 'placeholder';
  display_policy?: 'title-link' | 'feed-summary';
  // The configured source weight (B-07, B-08); the column's default 1 when absent.
  source_weight?: number;
};

export type ItemRow = {
  id: string;
  canonical_url: string;
  source_id: string;
  title: string;
  published_at: string;
  image_url: string | null;
  summary: string | null;
  category: Category;
  status: 'collected' | 'processed';
};

export type RunRow = { run_date: string; status: string; started_at: string; ended_at: string | null };

export type FixtureSet = {
  sources: SourceRow[];
  items: ItemRow[];
  runs: RunRow[];
  manifest: Record<string, unknown>;
};

export type SeedContext = { run: string; fixtures: string; now: Date };

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function ago(ctx: SeedContext, ms: number): string {
  return new Date(ctx.now.getTime() - ms).toISOString();
}

export function itemId(canonicalUrl: string): string {
  return createHash('sha256').update(canonicalUrl).digest('hex');
}

function item(
  source: SourceRow,
  slug: string,
  title: string,
  category: Category,
  publishedAt: string,
  extra: Partial<Pick<ItemRow, 'image_url' | 'summary' | 'status'>> = {},
): ItemRow {
  const host = new URL(source.source_type === 'reddit' ? 'https://www.reddit.com' : HOSTS[source.id] ?? 'https://example.com').origin;
  const canonical = `${host}/ai-news-fixture/${slug}`;
  const summary = source.display_policy === 'title-link' ? null : `Synthetic summary of ${title}.`;
  return {
    id: itemId(canonical),
    canonical_url: canonical,
    source_id: source.id,
    title,
    published_at: publishedAt,
    image_url: null,
    summary,
    category,
    status: 'processed',
    ...extra,
  };
}

// The original hosts of the fixed sources (Locked, News sources); fixture items link there.
const HOSTS: Record<string, string> = {
  'openai-news': 'https://openai.com',
  'federal-register-ai': 'https://www.federalregister.gov',
  'techcrunch-ai': 'https://techcrunch.com',
  'simon-willison': 'https://simonwillison.net',
  'anthropic-news-mirror': 'https://www.anthropic.com',
  'arxiv-cs-ai': 'https://arxiv.org',
  'mit-news-ai': 'https://news.mit.edu',
  'fixture-general': 'https://general.example.com',
};

// The fixed sources of the base seed; each feed address is on the fixture feed server.
function baseSources(ctx: SeedContext): SourceRow[] {
  const feed = (id: string) => `${ctx.fixtures}/feeds/${id}.xml`;
  return [
    { id: 'openai-news', name: 'OpenAI News', feed_url: feed('openai-news'), default_categories: ['releases'], display_policy: 'feed-summary' },
    { id: 'federal-register-ai', name: 'US Federal Register', feed_url: feed('federal-register-ai'), default_categories: ['policy'], image_policy: 'licensed', display_policy: 'feed-summary' },
    { id: 'techcrunch-ai', name: 'TechCrunch AI', feed_url: feed('techcrunch-ai'), default_categories: ['business', 'releases'], display_policy: 'feed-summary' },
    { id: 'simon-willison', name: "Simon Willison's Weblog", feed_url: feed('simon-willison'), default_categories: ['releases', 'business'], image_policy: 'owner-accepted hotlink', display_policy: 'feed-summary' },
    { id: 'anthropic-news-mirror', name: 'Anthropic News', feed_url: feed('anthropic-news-mirror'), default_categories: ['releases', 'research'], display_policy: 'title-link' },
  ];
}

// The base seed: items in every category but Research (the one empty category), one item
// with a broken image address, mirror-shaped items without a summary, and a last completed
// run older than a day (the Stale state).
export function baseSeed(ctx: SeedContext): FixtureSet {
  const sources = baseSources(ctx);
  const [openai, register, techcrunch, simon, mirror] = sources;
  const items = [
    item(openai, 'base-model-release', 'Seed: a new model release and its system card', 'releases', ago(ctx, 3 * HOUR)),
    item(register, 'base-ai-rule-notice', 'Seed: a proposed rule on AI procurement', 'policy', ago(ctx, 5 * HOUR),
      { image_url: `${ctx.fixtures}/images/licensed.png` }),
    item(techcrunch, 'base-developer-tools', 'Seed: a developer tools company raises a round', 'business', ago(ctx, 4 * HOUR)),
    item(techcrunch, 'base-broken-image', 'Seed: an item whose image address is broken', 'business', ago(ctx, 6 * HOUR),
      { image_url: `${ctx.fixtures}/images/missing.png` }),
    item(simon, 'base-assorted-notes', 'Seed: weekly notes on assorted topics', 'other', ago(ctx, 7 * HOUR)),
    item(mirror, 'base-mirror-announcement', 'Seed: an announcement from the Anthropic news mirror', 'releases', ago(ctx, 8 * HOUR)),
  ];
  const stale = new Date(ctx.now.getTime() - 2 * DAY);
  const runs: RunRow[] = [
    { run_date: isoDate(stale), status: 'completed', started_at: stale.toISOString(), ended_at: new Date(stale.getTime() + 5 * 60 * 1000).toISOString() },
  ];
  return {
    sources,
    items,
    runs,
    manifest: {
      source_ids: [...new Set(items.map((row) => row.source_id))].sort(),
      item_ids: items.map((row) => row.id),
      stale_run_date: isoDate(stale),
    },
  };
}

// ---------------------------------------------------------------------------------------
// Fixture sets: one per feature row of both repositories (the row id is the set's name).

type Extra = {
  sources?: SourceRow[];
  items?: ItemRow[];
  runs?: RunRow[];
  // Changes to the base seed that the row's Given needs (a failing feed, older items).
  adjust?: (set: FixtureSet) => void;
  // Fields the row reads from the manifest, computed from the complete set.
  manifest?: (set: FixtureSet) => Record<string, unknown>;
};

// A fixture feed on the fixture feed server whose content carries the run marker and a
// publication time; `name` is a template under fixtures/feeds/.
function fixtureFeed(ctx: SeedContext, name: string, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams({ run: ctx.run, at: ctx.now.toISOString(), ...extra });
  return `${ctx.fixtures}/feeds/${name}?${query}`;
}

function failing(ctx: SeedContext, status: number, id: string): string {
  return `${ctx.fixtures}/status/${status}/${id}`;
}

function source(id: string, name: string, feedUrl: string, extra: Partial<SourceRow> = {}): SourceRow {
  return { id, name, feed_url: feedUrl, display_policy: 'feed-summary', ...extra };
}

function redditSource(ctx: SeedContext, community: string, listing: Record<string, string> = {}): SourceRow {
  const query = new URLSearchParams({ run: ctx.run, at: ctx.now.toISOString(), ...listing });
  return source(`reddit-${community.toLowerCase()}`, `r/${community}`, `${ctx.fixtures}/reddit/r/${community}/new.json?${query}`,
    { source_type: 'reddit', community, display_policy: 'title-link' });
}

const nameOf = (set: FixtureSet, sourceId: string) => set.sources.find((s) => s.id === sourceId)?.name ?? sourceId;

function shown(set: FixtureSet, row: ItemRow) {
  return {
    title: row.title,
    source: nameOf(set, row.source_id),
    category: CATEGORY_NAMES[row.category],
    summary: row.summary,
    published_at: row.published_at,
    original_url: row.canonical_url,
  };
}

function lastCompleted(set: FixtureSet): RunRow | undefined {
  return set.runs.filter((r) => r.status === 'completed').sort((a, b) => b.run_date.localeCompare(a.run_date))[0];
}

function withPolicy(set: FixtureSet, row: ItemRow): string {
  return set.sources.find((s) => s.id === row.source_id)?.image_policy ?? 'placeholder';
}

// The cap the fixture's local configuration uses for AC-08: the configured cap of the job
// (src/process/rank-weights.ts; B-08; the real starting value is OD-26).
export const ARXIV_DAILY_CAP_FIXTURE = ARXIV_DAILY_CAP;
const ARXIV_SEEDED_FOR_DAY = 25;
const OLD = 3 * 365 * DAY; // older than any retention window OD-20 can choose

export function fixtureSet(name: string, ctx: SeedContext): FixtureSet {
  const set = baseSeed(ctx);
  const define = FIXTURE_SETS[name];
  if (!define) throw new Error(`Unknown fixture set ${name}.`);
  const extra = define(ctx, set);
  set.sources.push(...(extra.sources ?? []));
  set.items.push(...(extra.items ?? []));
  set.runs.push(...(extra.runs ?? []));
  extra.adjust?.(set);
  const fields = name === '40g' ? set.manifest : {};
  set.manifest = { fixture_set: name, run: ctx.run, ...fields, ...(extra.manifest?.(set) ?? {}) };
  return set;
}

export function fixtureSetNames(): string[] {
  return Object.keys(FIXTURE_SETS);
}

const today = (ctx: SeedContext) => isoDate(ctx.now);
const src = (set: FixtureSet, id: string) => set.sources.find((s) => s.id === id) as SourceRow;

// Items titled with the run marker on the fixed sources, for rows that only need "a seeded item".
function markedItems(ctx: SeedContext, set: FixtureSet, suffixes: string[], category: Category = 'releases'): ItemRow[] {
  return suffixes.map((suffix, index) =>
    item(src(set, 'openai-news'), `${ctx.run}${suffix}`, `${ctx.run}${suffix} synthetic headline`, category, ago(ctx, (index + 1) * HOUR)));
}

const FIXTURE_SETS: Record<string, (ctx: SeedContext, set: FixtureSet) => Extra> = {
  // Bootstrap row 40g: the base seed only.
  '40g': () => ({}),

  // ai-news-backend rows.
  'AC-01a': () => ({}),
  'AC-01b': (ctx) => ({ runs: [{ run_date: today(ctx), status: 'running', started_at: ago(ctx, HOUR), ended_at: null }] }),
  'AC-01c': () => ({}),
  'AC-02a': (ctx) => ({
    sources: [
      source('fixture-ok', 'Fixture feed that succeeds', fixtureFeed(ctx, 'ok.xml')),
      source('fixture-http-500', 'Fixture feed answering HTTP 500', failing(ctx, 500, 'fixture-http-500')),
      source('fixture-invalid-xml', 'Fixture feed with invalid XML', fixtureFeed(ctx, 'invalid.xml')),
    ],
    manifest: () => ({
      failing_sources: [
        { source_id: 'fixture-http-500', failure: 'http-500' },
        { source_id: 'fixture-invalid-xml', failure: 'invalid-xml' },
      ],
      ok_source_id: 'fixture-ok',
    }),
  }),
  'AC-02b': (ctx) => ({ adjust: (set) => { for (const s of set.sources) s.feed_url = failing(ctx, 500, s.id); } }),
  'AC-03c': (ctx) => ({ sources: [source('fixture-xxe', 'Fixture feed with an external entity', fixtureFeed(ctx, 'xxe.xml'))] }),
  'AC-03d': (ctx) => ({
    sources: [source('fixture-oversized', 'Fixture feed with an oversized item', fixtureFeed(ctx, 'oversized.xml'))],
    manifest: () => ({ oversized_source_id: 'fixture-oversized' }),
  }),
  'AC-03e': (ctx) => ({ sources: [source('fixture-offsite', 'Fixture feed linking off the feed list', fixtureFeed(ctx, 'offsite.xml'))] }),
  'AC-04': (ctx) => ({ sources: [source('fixture-general', 'Fixture general news feed', fixtureFeed(ctx, 'general.xml'))] }),
  'AC-05': (ctx) => ({ sources: [source('fixture-categories', 'Fixture feed for the category rules', fixtureFeed(ctx, 'categories.xml'))] }),
  'AC-06': (ctx, set) => {
    // Today's window holds 10 representative items, 4 of them in Other; the base items are
    // moved out of the window (OD-15 sets the window and the denominator).
    const plan: Category[] = ['other', 'other', 'other', 'other', 'releases', 'releases', 'policy', 'policy', 'business', 'business'];
    return {
      items: plan.map((category, index) =>
        item(src(set, 'techcrunch-ai'), `${ctx.run}-window-${index}`, `${ctx.run}-window-${index} synthetic headline`, category, ago(ctx, (index + 1) * HOUR))),
      adjust: (all) => { for (const row of all.items) if (!row.title.startsWith(ctx.run)) row.published_at = ago(ctx, 3 * DAY); },
    };
  },
  'AC-07a': (ctx) => ({ sources: [source('fixture-same-url', 'Fixture feed with utm variants', fixtureFeed(ctx, 'same-url.xml'))] }),
  'AC-07b': (ctx) => ({
    sources: [
      source('fixture-near-title-a', 'Fixture feed A with a near-identical title', fixtureFeed(ctx, 'near-title-a.xml')),
      source('fixture-near-title-b', 'Fixture feed B with a near-identical title', fixtureFeed(ctx, 'near-title-b.xml')),
    ],
  }),
  'AC-08': (ctx) => ({
    sources: [source('arxiv-cs-ai', 'arXiv cs.AI', fixtureFeed(ctx, 'arxiv.xml', { count: String(ARXIV_SEEDED_FOR_DAY) }), { default_categories: ['research'] })],
    manifest: () => ({
      arxiv_daily_cap: ARXIV_DAILY_CAP_FIXTURE,
      arxiv_day: today(ctx),
      arxiv_seeded_for_day: ARXIV_SEEDED_FOR_DAY,
      arxiv_source_id: 'arxiv-cs-ai',
    }),
  }),
  // Review finding F-S04-1 of backend#3 (S-04 round 1): a copy of a stored item arriving in a
  // later run competes with the stored copy under B-07. Both sets store copy A of
  // <run>-later-copy as a completed run of yesterday left it; today's run delivers copy B.
  // F-S04-1a: B weighs 2 and A 1, and B's copy is the later one, so the weight decides; A's feed
  // also delivers an earlier copy of <run>-kept-copy, whose stored copy is B's: that copy loses.
  // F-S04-1b: equal weights, and B's copy is the earlier one, so the time decides.
  'F-S04-1a': (ctx) => laterRunCopies(ctx, 2, ctx.now),
  'F-S04-1b': (ctx) => laterRunCopies(ctx, 1, new Date(ctx.now.getTime() - 3 * HOUR)),
  'AC-15c': (ctx, set) => ({ items: markedItems(ctx, set, ['-a']) }),
  'AC-15d': (ctx, set) => ({ items: markedItems(ctx, set, ['-a']) }),
  'AC-20a': (ctx, set) => ({ items: markedItems(ctx, set, ['-a', '-b']) }),
  'AC-20b': (ctx, set) => ({ items: markedItems(ctx, set, ['-a', '-b']) }),
  'AC-20c': (ctx, set) => ({ items: markedItems(ctx, set, ['-a']) }),
  'AC-20d': () => ({}),
  'AC-21a': (ctx) => {
    const earlier = new Date(ctx.now.getTime() - 5 * DAY);
    return { runs: [{ run_date: isoDate(earlier), status: 'completed', started_at: earlier.toISOString(), ended_at: earlier.toISOString() }] };
  },
  'AC-22a': (ctx, set) => ({
    items: ['-old-1', '-old-2'].map((suffix) =>
      item(src(set, 'techcrunch-ai'), `${ctx.run}${suffix}`, `${ctx.run}${suffix} synthetic old headline`, 'business', ago(ctx, OLD))),
  }),
  'AC-22b': (ctx) => {
    // The source of these items is no longer in the source configuration.
    const removed: SourceRow = { id: 'removed-source', name: 'Removed source', feed_url: '' };
    return {
      items: ['-removed-source-1', '-removed-source-2'].map((suffix) =>
        item(removed, `${ctx.run}${suffix}`, `${ctx.run}${suffix} synthetic headline`, 'other', ago(ctx, 2 * HOUR))),
    };
  },
  'AC-22c': (ctx, set) => ({
    items: [
      item(src(set, 'techcrunch-ai'), `${ctx.run}-bookmarked-old`, `${ctx.run}-bookmarked-old synthetic headline`, 'business', ago(ctx, OLD)),
      item(src(set, 'techcrunch-ai'), `${ctx.run}-old`, `${ctx.run}-old synthetic headline`, 'business', ago(ctx, OLD)),
    ],
  }),
  'AC-25': () => ({
    // The seeded injection and malformed fixtures (fixtures/validation/hostile.json). The frozen
    // sample with the owner's labels is added by S-06 when the owner has labelled it (B-25).
    manifest: () => ({
      fixture_ids: ['hostile-injection-instructions', 'hostile-malformed-markup'],
      source_ids: ['fixture-hostile'],
    }),
  }),
  'AC-26c': (ctx) => {
    const reddit = redditSource(ctx, 'artificial', { omit: 'admitted' });
    return {
      sources: [reddit],
      items: [item(reddit, `${ctx.run}-reddit-admitted`, `${ctx.run}-reddit-admitted synthetic post`, 'other', ago(ctx, 2 * HOUR))],
    };
  },
  'AC-27a': (ctx) => ({ sources: [redditSource(ctx, 'artificial')] }),
  'AC-27c': (ctx) => ({ sources: [redditSource(ctx, 'artificial')] }),
  'AC-28c': (ctx) => ({ adjust: (set) => { src(set, 'anthropic-news-mirror').feed_url = fixtureFeed(ctx, 'mirror.xml'); } }),
  'AC-28d': (ctx) => ({ adjust: (set) => { src(set, 'anthropic-news-mirror').feed_url = failing(ctx, 503, 'anthropic-news-mirror'); } }),

  // ai-news-frontend rows.
  'AC-03a': (ctx) => ({ sources: [source('fixture-hostile-title', 'Fixture feed with a script title', fixtureFeed(ctx, 'hostile-title.xml'))] }),
  'AC-03b': (ctx) => ({
    sources: [source('fixture-hostile-links', 'Fixture feed with a javascript link', fixtureFeed(ctx, 'hostile-links.xml'))],
    manifest: (set) => ({
      feed_links: [...set.items.map((row) => row.canonical_url), `https://hostile.example.com/ai-news-fixture/${ctx.run}-hostile-ok`],
    }),
  }),
  'AC-09': (ctx, set) => ({
    items: [
      item(src(set, 'openai-news'), `${ctx.run}-release`, `${ctx.run} release headline`, 'releases', ago(ctx, HOUR)),
      item(src(set, 'federal-register-ai'), `${ctx.run}-policy`, `${ctx.run} policy headline`, 'policy', ago(ctx, 2 * HOUR)),
      item(src(set, 'techcrunch-ai'), `${ctx.run}-business`, `${ctx.run} business headline`, 'business', ago(ctx, 3 * HOUR)),
    ],
    manifest: (all) => ({
      items: all.items.map((row) => shown(all, row)),
      last_completed_run_date: lastCompleted(all)?.run_date,
    }),
  }),
  'AC-17': (ctx) => {
    const ended = new Date(ctx.now.getTime() - 30 * HOUR);
    return {
      adjust: (set) => {
        set.runs = [{ run_date: isoDate(ended), status: 'completed', started_at: new Date(ended.getTime() - 5 * 60 * 1000).toISOString(), ended_at: ended.toISOString() }];
      },
      manifest: () => ({ last_completed_at: ended.toISOString() }),
    };
  },
  'AC-21b': () => ({}),
  'AC-10a': (ctx) => {
    const licensed = source('fixture-licensed', 'Fixture licensed source', `${ctx.fixtures}/feeds/fixture-licensed.xml`, { image_policy: 'licensed' });
    return {
      sources: [licensed],
      items: [item(licensed, `${ctx.run}-licensed`, `${ctx.run}-licensed synthetic headline`, 'research', ago(ctx, HOUR),
        { image_url: `${ctx.fixtures}/images/licensed.png?run=${ctx.run}` })],
    };
  },
  'AC-10b': (ctx) => {
    const placeholder = source('fixture-placeholder', 'Fixture placeholder source', `${ctx.fixtures}/feeds/fixture-placeholder.xml`);
    return {
      sources: [placeholder],
      items: [item(placeholder, `${ctx.run}-placeholder`, `${ctx.run}-placeholder synthetic headline`, 'business', ago(ctx, HOUR))],
      manifest: () => ({ source: placeholder.name }),
    };
  },
  'AC-10c': (ctx) => {
    const licensed = source('fixture-licensed', 'Fixture licensed source', `${ctx.fixtures}/feeds/fixture-licensed.xml`, { image_policy: 'licensed' });
    const placeholder = source('fixture-placeholder', 'Fixture placeholder source', `${ctx.fixtures}/feeds/fixture-placeholder.xml`);
    const failedImage = `${ctx.fixtures}/images/fail.png?run=${ctx.run}`;
    return {
      sources: [licensed, placeholder],
      items: [
        item(licensed, `${ctx.run}-failed-image`, `${ctx.run}-failed-image synthetic headline`, 'research', ago(ctx, HOUR), { image_url: failedImage }),
        item(placeholder, `${ctx.run}-placeholder`, `${ctx.run}-placeholder synthetic headline`, 'business', ago(ctx, 2 * HOUR)),
      ],
      manifest: () => ({ failed_image_url: failedImage }),
    };
  },
  'AC-11a': (ctx, set) => threeCategories(ctx, set),
  'AC-11b': (ctx, set) => threeCategories(ctx, set),
  'AC-19': (ctx, set) => ({ items: markedItems(ctx, set, ['-1', '-2']) }),
  'AC-12': (ctx, set) => {
    const article = item(src(set, 'techcrunch-ai'), `${ctx.run}-article`, `${ctx.run} article headline`, 'business', ago(ctx, HOUR));
    // The original address is the fixture publisher page whose body starts with <run>-body.
    article.canonical_url = `${ctx.fixtures}/articles/article.html?run=${ctx.run}`;
    article.id = itemId(article.canonical_url);
    return { items: [article], manifest: (all) => shown(all, article) };
  },
  'AC-13a': (ctx) => ({
    runs: [{ run_date: today(ctx), status: 'completed', started_at: ago(ctx, 2 * HOUR), ended_at: ago(ctx, HOUR) }],
    manifest: (set) => ({
      // The frozen briefing fixture (OD-08: briefing or both): each category in order with its titles.
      briefing: (Object.keys(CATEGORY_NAMES) as Category[])
        .map((category) => ({ category: CATEGORY_NAMES[category], top_titles: set.items.filter((row) => row.category === category).map((row) => row.title) }))
        .filter((entry) => entry.top_titles.length > 0),
    }),
  }),
  'AC-13b': (ctx) => ({
    runs: [{ run_date: today(ctx), status: 'failed', started_at: ago(ctx, 2 * HOUR), ended_at: ago(ctx, HOUR) }],
    manifest: (set) => ({ previous_run_date: lastCompleted(set)?.run_date }),
  }),
  'AC-14a': () => ({}),
  'AC-14b': (ctx, set) => ({ items: markedItems(ctx, set, ['-1']) }),
  'AC-15a': (ctx, set) => ({ items: markedItems(ctx, set, ['']) }),
  'AC-15b': (ctx, set) => ({ items: markedItems(ctx, set, ['']) }),
  'AC-15e': (ctx, set) => ({ items: markedItems(ctx, set, ['']) }),
  'AC-24a': (ctx, set) => ({ items: markedItems(ctx, set, ['']) }),
  'AC-24b': (ctx, set) => ({ items: markedItems(ctx, set, ['']) }),
  'AC-24c': (ctx) => {
    const licensed = source('fixture-licensed', 'Fixture licensed source', `${ctx.fixtures}/feeds/fixture-licensed.xml`, { image_policy: 'licensed' });
    const placeholder = source('fixture-placeholder', 'Fixture placeholder source', `${ctx.fixtures}/feeds/fixture-placeholder.xml`);
    return {
      sources: [licensed, placeholder],
      items: [
        item(licensed, `${ctx.run}-licensed`, `${ctx.run}-licensed synthetic headline`, 'research', ago(ctx, HOUR),
          { image_url: `${ctx.fixtures}/images/licensed.png?run=${ctx.run}` }),
        item(placeholder, `${ctx.run}-placeholder`, `${ctx.run}-placeholder synthetic headline`, 'business', ago(ctx, 2 * HOUR)),
      ],
      manifest: (set) => {
        const withImage = set.items.filter((row) => withPolicy(set, row) !== 'placeholder' && row.image_url);
        return { image_count: withImage.length, placeholder_count: set.items.length - withImage.length };
      },
    };
  },
  'AC-16a': (ctx, set) => {
    const [row] = markedItems(ctx, set, ['']);
    return { items: [row], manifest: () => ({ title: row.title, summary: row.summary }) };
  },
  'AC-16b': (ctx, set) => ({
    items: markedItems(ctx, set, ['']),
    manifest: (all) => ({
      item_count: all.items.length,
      non_licensed_count: all.items.filter((row) => withPolicy(all, row) !== 'licensed').length,
    }),
  }),
  'AC-16c': (ctx, set) => {
    const [row] = markedItems(ctx, set, ['']);
    return { items: [row], manifest: (all) => shown(all, row) };
  },
  'AC-18a': (ctx, set) => ({ items: markedItems(ctx, set, ['-1', '-2']) }),
  'AC-18b': (ctx, set) => ({ items: markedItems(ctx, set, ['-1', '-2']) }),
  'AC-26a': (ctx) => ({
    sources: [redditSource(ctx, 'artificial')],
    manifest: () => ({
      community: 'r/artificial',
      author: `fixture-author-${ctx.run}`,
      post_url: `https://www.reddit.com/r/artificial/comments/${ctx.run}/admitted/`,
      external_url: `https://external.example.com/ai-news-fixture/${ctx.run}-reddit-admitted`,
    }),
  }),
  'AC-26b': (ctx) => ({
    sources: [redditSource(ctx, 'artificial')],
    manifest: (set) => ({ feed_titles: [...set.items.map((row) => row.title), `${ctx.run}-reddit-admitted synthetic post`] }),
  }),
  'AC-26d': (ctx) => {
    const reddit = redditSource(ctx, 'artificial');
    const ended = new Date(ctx.now.getTime() - 30 * HOUR);
    return {
      sources: [reddit],
      items: [item(reddit, `${ctx.run}-reddit`, `${ctx.run}-reddit synthetic post`, 'other', ago(ctx, 31 * HOUR))],
      adjust: (set) => {
        set.runs = [{ run_date: isoDate(ended), status: 'completed', started_at: new Date(ended.getTime() - 5 * 60 * 1000).toISOString(), ended_at: ended.toISOString() }];
      },
    };
  },
  'AC-26e': (ctx) => {
    const empty = `empty-${ctx.run}`;
    return {
      sources: [redditSource(ctx, empty, { omit: 'admitted' }), redditSource(ctx, 'artificial')],
      manifest: (set) => ({
        feed_titles: [...set.items.map((row) => row.title), `${ctx.run}-reddit-admitted synthetic post`],
        feed_communities: ['r/artificial'],
      }),
    };
  },
  'AC-26f': (ctx) => ({
    sources: [redditSource(ctx, 'artificial')],
    manifest: () => ({ community: 'r/artificial', author: `fixture-author-${ctx.run}` }),
  }),
  'AC-27b': (ctx) => ({ sources: [redditSource(ctx, 'artificial')] }),
  'AC-28a': (ctx) => ({
    adjust: (set) => { src(set, 'anthropic-news-mirror').feed_url = fixtureFeed(ctx, 'mirror.xml'); },
    manifest: () => ({
      mirror_items: [1, 2].map((n) => ({ title: `${ctx.run}-mirror-${n} synthetic announcement`, source: 'Anthropic News', published_at: ctx.now.toISOString() })),
    }),
  }),
  'AC-28b': (ctx) => ({
    adjust: (set) => { src(set, 'anthropic-news-mirror').feed_url = fixtureFeed(ctx, 'mirror.xml'); },
    manifest: () => ({ mirror_titles: [1, 2].map((n) => `${ctx.run}-mirror-${n} synthetic announcement`) }),
  }),
};

// AC-11: items in three categories and none in Research today: the base items outside
// Releases, Policy and Business are moved out of today.
function threeCategories(ctx: SeedContext, set: FixtureSet): Extra {
  const items = [
    item(src(set, 'openai-news'), `${ctx.run}-release`, `${ctx.run} release headline`, 'releases', ago(ctx, HOUR)),
    item(src(set, 'federal-register-ai'), `${ctx.run}-policy-1`, `${ctx.run} policy headline one`, 'policy', ago(ctx, 2 * HOUR)),
    item(src(set, 'federal-register-ai'), `${ctx.run}-policy-2`, `${ctx.run} policy headline two`, 'policy', ago(ctx, 3 * HOUR)),
    item(src(set, 'techcrunch-ai'), `${ctx.run}-business`, `${ctx.run} business headline`, 'business', ago(ctx, 4 * HOUR)),
  ];
  return {
    items,
    adjust: (all) => { all.items = all.items.filter((row) => ['releases', 'policy', 'business'].includes(row.category)); },
    manifest: (all) => ({ policy_titles: all.items.filter((row) => row.category === 'policy').map((row) => row.title) }),
  };
}

// The sets of review finding F-S04-1 (above). Feed times are whole seconds, as RFC 822 carries them.
function laterRunCopies(ctx: SeedContext, weightB: number, copyBAt: Date): Extra {
  const second = (date: Date) => new Date(Math.floor(date.getTime() / 1000) * 1000);
  const copyB = second(copyBAt);
  const copyAAt = second(new Date(ctx.now.getTime() - 4 * HOUR));
  const a = source('fixture-later-a', 'Fixture feed A of a later-run copy', fixtureFeed(ctx, 'later-run-a.xml', { at: copyAAt.toISOString() }));
  const b = source('fixture-later-b', 'Fixture feed B of a later-run copy', fixtureFeed(ctx, 'later-run-b.xml', { at: copyB.toISOString() }),
    { source_weight: weightB });
  const stored = item(a, `${ctx.run}-later-copy`, `${ctx.run}-later-copy synthetic AI story (copy A)`, 'releases', ago(ctx, HOUR));
  const kept = item(b, `${ctx.run}-kept-copy`, `${ctx.run}-kept-copy synthetic note on model evaluations (copy B)`, 'research', ago(ctx, HOUR));
  const yesterday = new Date(ctx.now.getTime() - DAY);
  return {
    sources: [a, b],
    items: weightB > 1 ? [stored, kept] : [stored],
    runs: [{ run_date: isoDate(yesterday), status: 'completed', started_at: yesterday.toISOString(), ended_at: yesterday.toISOString() }],
    manifest: () => ({
      earlier_run_date: isoDate(yesterday),
      stored_source_id: a.id,
      later_source_id: b.id,
      later_copy_url: stored.canonical_url,
      later_copy_item_id: stored.id,
      later_copy_published_at: copyB.toISOString(),
      ...(weightB > 1 ? { kept_copy_url: kept.canonical_url, kept_copy_item_id: kept.id } : {}),
    }),
  };
}
