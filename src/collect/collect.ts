// The job module `collect` (priitkustala/ai-news-backend#1, S-02; Locked, Architecture:
// per-source fetch with bounded retry and a bulkhead per source). Every enabled feed source
// is fetched from its configured address and parsed on its own: a source that times out,
// answers with an error or returns invalid XML becomes that source's recorded failure and
// never stops or changes the others (B-02). At most COLLECT_CONCURRENCY sources are fetched
// at a time. Reddit sources (S-07, priitkustala/ai-news#44, src/collect/reddit.ts) go
// through the same lanes with the same isolation: a token or listing failure is that
// source's recorded failure; without Reddit credentials they are skipped with no request.
// Every requests entry and skip names a Reddit source as `reddit` (R-21). An item over the per-item limit is rejected and recorded with its
// source (src/collect/parse.ts); it never fails the source or stops its siblings. arXiv
// sources are paced (src/collect/fetch.ts).
import { fetchFeed, SourceFailure } from './fetch.js';
import { parseFeedItems, type FeedEntry } from './parse.js';
import { reportedSourceId, type RedditPost, type RedditSession } from './reddit.js';

export const COLLECT_CONCURRENCY = 4;

export type CollectSource = { id: string; feed_url: string; source_type: string; default_categories: string[] | null };

// `reddit` is present on the result of a Reddit source: the posts of its listing.
export type SourceResult =
  | { source_id: string; ok: true; entries: FeedEntry[]; rejected: string[]; attempts: number; reddit?: { posts: RedditPost[] } }
  | { source_id: string; ok: false; error: string };

export type CollectResult = {
  results: SourceResult[];
  skipped: { source_id: string; reason: string }[];
  requests: { source_id: string; source_type: string; host: string }[];
};

// A source arXiv paces: its id starts with arxiv- or its host is arxiv.org or a subdomain.
export function isArxivSource(source: CollectSource): boolean {
  const host = URL.parse(source.feed_url)?.hostname.toLowerCase() ?? '';
  return source.id.startsWith('arxiv-') || host === 'arxiv.org' || host.endsWith('.arxiv.org');
}

async function collectOne(source: CollectSource): Promise<SourceResult> {
  try {
    const { body, attempts } = await fetchFeed(source.feed_url, { paced: isArxivSource(source) });
    const { entries, rejected } = parseFeedItems(body);
    return { source_id: source.id, ok: true, entries, rejected, attempts };
  } catch (error) {
    const message = error instanceof SourceFailure ? error.message : 'unexpected: the source could not be collected';
    return { source_id: source.id, ok: false, error: message };
  }
}

// The listing is requested (and its requests entry recorded) only once the run has a token.
async function collectReddit(source: CollectSource, reddit: RedditSession, requested: () => void): Promise<SourceResult> {
  try {
    await reddit.token();
    requested();
    const { posts, attempts } = await reddit.listing(source);
    return { source_id: source.id, ok: true, entries: [], rejected: [], attempts, reddit: { posts } };
  } catch (error) {
    const message = error instanceof SourceFailure ? error.message : 'unexpected: the source could not be collected';
    return { source_id: source.id, ok: false, error: message };
  }
}

// `reddit` is the run's Data API session, or null when the run has no Reddit credentials.
export async function collect(sources: CollectSource[], reddit: RedditSession | null = null): Promise<CollectResult> {
  const collected = (s: CollectSource) => s.source_type === 'feed' || (s.source_type === 'reddit' && reddit !== null);
  const skipped = sources.filter((s) => !collected(s)).map((s) => ({
    source_id: reportedSourceId(s),
    reason: s.source_type === 'reddit' ? 'no Reddit credentials set' : `source type ${s.source_type} is not collected by this job`,
  }));
  const feeds = sources.filter(collected);
  const requests: CollectResult['requests'] = [];
  const results: SourceResult[] = new Array(feeds.length);
  let next = 0;
  // The bulkhead: a fixed number of lanes take the sources in turn; each source's failure is
  // caught inside collectOne, so one source can neither fail nor block another lane's work.
  const lane = async () => {
    while (next < feeds.length) {
      const index = next++;
      const source = feeds[index];
      let host: string;
      try {
        const url = new URL(source.feed_url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
        host = url.host;
      } catch {
        results[index] = { source_id: source.id, ok: false, error: 'config: the feed address is not an http or https address' };
        continue;
      }
      const requested = () => requests.push({ source_id: reportedSourceId(source), source_type: source.source_type, host });
      if (source.source_type === 'reddit') {
        results[index] = await collectReddit(source, reddit as RedditSession, requested);
      } else {
        requested();
        results[index] = await collectOne(source);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(COLLECT_CONCURRENCY, feeds.length) }, lane));
  requests.sort((a, b) => a.source_id.localeCompare(b.source_id));
  return { results, skipped, requests };
}
