// The job module `collect` (priitkustala/ai-news-backend#1, S-02; Locked, Architecture:
// per-source fetch with bounded retry and a bulkhead per source). Every enabled feed source
// is fetched from its configured address and parsed on its own: a source that times out,
// answers with an error or returns invalid XML becomes that source's recorded failure and
// never stops or changes the others (B-02). At most COLLECT_CONCURRENCY sources are fetched
// at a time. Reddit sources are collected by S-07 (priitkustala/ai-news#44) and are skipped
// here without a request.
import { fetchFeed, SourceFailure } from './fetch.js';
import { parseFeed, type FeedEntry } from './parse.js';

export const COLLECT_CONCURRENCY = 4;

export type CollectSource = { id: string; feed_url: string; source_type: string };

export type SourceResult =
  | { source_id: string; ok: true; entries: FeedEntry[]; attempts: number }
  | { source_id: string; ok: false; error: string };

export type CollectResult = {
  results: SourceResult[];
  skipped: { source_id: string; reason: string }[];
  requests: { source_id: string; source_type: string; host: string }[];
};

async function collectOne(source: CollectSource): Promise<SourceResult> {
  try {
    const { body, attempts } = await fetchFeed(source.feed_url);
    return { source_id: source.id, ok: true, entries: parseFeed(body), attempts };
  } catch (error) {
    const message = error instanceof SourceFailure ? error.message : 'unexpected: the source could not be collected';
    return { source_id: source.id, ok: false, error: message };
  }
}

export async function collect(sources: CollectSource[]): Promise<CollectResult> {
  const skipped = sources.filter((s) => s.source_type !== 'feed')
    .map((s) => ({ source_id: s.id, reason: `source type ${s.source_type} is not collected by this job yet` }));
  const feeds = sources.filter((s) => s.source_type === 'feed');
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
      requests.push({ source_id: source.id, source_type: source.source_type, host });
      results[index] = await collectOne(source);
    }
  };
  await Promise.all(Array.from({ length: Math.min(COLLECT_CONCURRENCY, feeds.length) }, lane));
  requests.sort((a, b) => a.source_id.localeCompare(b.source_id));
  return { results, skipped, requests };
}
