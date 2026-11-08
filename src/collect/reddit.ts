// The Reddit source of the job module `collect` (priitkustala/ai-news#44, S-07; Locked B-26,
// OD-37 A, OD-38, OD-41 and R-21). Each enabled source of type reddit is one community the
// owner configured (OD-44, the configured list): its feed_url is the community's listing on
// Reddit's Data API. The job reads the credentials REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET
// from its environment, and REDDIT_TOKEN_URL (default Reddit's own token address); with
// either credential missing, or with a row in app_private.reddit_credentials_withheld (the
// local test environment's Given "no Reddit credentials", written only by the seed), every
// Reddit source is skipped with no request (AC-27). Otherwise one application-only token is
// requested per run (HTTP Basic, grant_type client_credentials, the read scope), only when
// an enabled Reddit source exists; each listing is a GET with that bearer and a fixed
// User-Agent naming the app and no account, under the limits of src/collect/fetch.ts. A post
// is admitted by the rule of OD-38 (isAdmitted below); an admitted post becomes an item with
// its title unmodified, its link's canonical address, no summary and no image, the post's
// Reddit address, the external address and the author's handle, and raw holding the post's
// id only (never its text). The removal pass of a later run asks the info endpoint about the
// stored posts a listing no longer carries (removedIds). R-21: a Reddit source's id names its
// community, so every report entry and log line writes it as `reddit` (reportedSourceId), and
// a failure message names the kind of failure and numbers only. Credentials and the token are
// held in memory only, never written or logged.
import { createHash } from 'node:crypto';
import type { Client } from '../db.js';
import { fetchFeed, SourceFailure } from './fetch.js';
import { canonicalUrl } from '../process/dedupe.js';
import { relevance, type RelevanceMethod } from '../process/relevance.js';
import { categorise, type CategoryMethod } from '../process/category.js';
import type { Category } from '../process/category-rules.js';

export const REDDIT_DEFAULT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
export const REDDIT_USER_AGENT = 'server:ai-news-backend:1.0 (daily ingest job)';
export const REDDIT_REPORTED_ID = 'reddit';
// The info endpoint takes at most 100 fullnames per request.
export const REDDIT_INFO_BATCH = 100;

export type RedditCredentials = { clientId: string; clientSecret: string; tokenUrl: string };

export type RedditPost = {
  id: string;
  title?: unknown;
  url?: unknown;
  permalink?: unknown;
  author?: unknown;
  created_utc?: unknown;
  is_self?: unknown;
  over_18?: unknown;
  crosspost_parent?: unknown;
  removed_by_category?: unknown;
};

export type RedditFields = {
  raw: { reddit_id: string };
  post_url: string | null;
  external_url: string;
  author_handle: string | null;
};

export type RedditItem = {
  id: string;
  canonical_url: string;
  source_id: string;
  title: string;
  published_at: string | null;
  summary: null;
  relevance_method: RelevanceMethod;
  category: Category;
  category_method: CategoryMethod;
  reddit: RedditFields;
};

type SourceRef = { id: string; source_type: string };
type RedditSource = SourceRef & { feed_url: string; default_categories: string[] | null };

// The id a report entry or a log line names for a source: `reddit` for every Reddit source (R-21).
export function reportedSourceId(source: SourceRef): string {
  return source.source_type === 'reddit' ? REDDIT_REPORTED_ID : source.id;
}

// The credentials of this run, or null when the Reddit sources are to be skipped.
export async function redditCredentials(client: Client, env: NodeJS.ProcessEnv = process.env): Promise<RedditCredentials | null> {
  const clientId = env.REDDIT_CLIENT_ID;
  const clientSecret = env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const withheld = await client.query('select 1 from app_private.reddit_credentials_withheld limit 1');
  if (withheld.rowCount) return null;
  return { clientId, clientSecret, tokenUrl: env.REDDIT_TOKEN_URL || REDDIT_DEFAULT_TOKEN_URL };
}

const REDDIT_HOSTS = ['reddit.com', 'redd.it'];

function isRedditHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, '');
  return REDDIT_HOSTS.some((own) => name === own || name.endsWith(`.${own}`));
}

// OD-38, which Reddit posts count as news: the owner's answer "link posts to external sites
// only". A post is admitted when it is not a self post, is no crosspost, is not marked over
// 18, is not removed, has a non-empty title, and links to an http or https address whose host
// is not Reddit's own (reddit.com, redd.it or a subdomain of either).
export function isAdmitted(post: RedditPost): boolean {
  if (post.is_self === true || post.over_18 === true) return false;
  if (post.crosspost_parent !== undefined && post.crosspost_parent !== null) return false;
  if (post.removed_by_category !== undefined && post.removed_by_category !== null) return false;
  if (typeof post.title !== 'string' || post.title.trim() === '') return false;
  if (typeof post.url !== 'string') return false;
  const url = URL.parse(post.url);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return false;
  return !isRedditHost(url.hostname);
}

const POST_ID = /^[A-Za-z0-9_-]{1,80}$/;

// The posts of a listing body (kind t3 children with a usable id); a body that is not a
// listing is the source's failure.
export function parseListing(body: string): RedditPost[] {
  let listing: unknown;
  try {
    listing = JSON.parse(body);
  } catch {
    throw new SourceFailure('parse', 'the listing is not valid JSON');
  }
  const children = (listing as { data?: { children?: unknown } } | null)?.data?.children;
  if (!Array.isArray(children)) throw new SourceFailure('parse', 'the answer is not a listing');
  const posts: RedditPost[] = [];
  for (const child of children) {
    const { kind, data } = (child ?? {}) as { kind?: unknown; data?: Record<string, unknown> };
    if (kind !== 't3' || !data || typeof data.id !== 'string' || !POST_ID.test(data.id)) continue;
    posts.push(data as RedditPost);
  }
  return posts;
}

// The admitted posts of one listing as items; of two posts with one canonical address the
// earlier is kept. Not admitted posts and later copies are counted as dropped.
export function redditItems(source: RedditSource, posts: RedditPost[]): { items: RedditItem[]; dropped: number; notRelevant: number } {
  const byUrl = new Map<string, RedditItem>();
  let dropped = 0;
  let notRelevant = 0;
  for (const post of posts) {
    if (!isAdmitted(post)) {
      dropped += 1;
      continue;
    }
    const title = post.title as string;
    const external = post.url as string;
    const url = canonicalUrl(external);
    if (!url) {
      dropped += 1;
      continue;
    }
    const created = typeof post.created_utc === 'number' && Number.isFinite(post.created_utc) ? new Date(post.created_utc * 1000) : undefined;
    const published_at = created && !Number.isNaN(created.getTime()) ? created.toISOString() : null;
    const earlier = byUrl.get(url);
    if (earlier) {
      dropped += 1;
      if (published_at === null || (earlier.published_at !== null && earlier.published_at <= published_at)) continue;
    }
    const relevanceMethod = relevance(source, title);
    if (!relevanceMethod) {
      notRelevant += 1;
      continue;
    }
    const { category, method } = categorise(source, title);
    const permalink = typeof post.permalink === 'string' && post.permalink.startsWith('/') ? post.permalink : null;
    const author = typeof post.author === 'string' && post.author !== '' && post.author !== '[deleted]' ? post.author : null;
    byUrl.set(url, {
      id: createHash('sha256').update(url).digest('hex'),
      canonical_url: url,
      source_id: source.id,
      title,
      published_at,
      summary: null,
      relevance_method: relevanceMethod,
      category,
      category_method: method,
      reddit: {
        raw: { reddit_id: post.id },
        post_url: permalink ? `https://www.reddit.com${permalink}` : null,
        external_url: external,
        author_handle: author,
      },
    });
  }
  return { items: [...byUrl.values()], dropped, notRelevant };
}

function httpAddress(address: string, what: string): URL {
  const url = URL.parse(address);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new SourceFailure('config', `the ${what} is not an http or https address`);
  }
  return url;
}

// One run's access to the Data API: the token is requested once, at the first need, and is
// shared by every Reddit source of the run and by the removal pass.
export class RedditSession {
  #token: Promise<string> | undefined;

  constructor(readonly credentials: RedditCredentials) {}

  token(): Promise<string> {
    this.#token ??= this.#requestToken();
    return this.#token;
  }

  async #requestToken(): Promise<string> {
    const tokenUrl = httpAddress(this.credentials.tokenUrl, 'token address');
    const basic = Buffer.from(`${this.credentials.clientId}:${this.credentials.clientSecret}`).toString('base64');
    let body: string;
    try {
      ({ body } = await fetchFeed(tokenUrl.toString(), {
        method: 'POST',
        headers: {
          authorization: `Basic ${basic}`, accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded', 'user-agent': REDDIT_USER_AGENT,
        },
        body: 'grant_type=client_credentials',
      }));
    } catch (error) {
      const kind = error instanceof SourceFailure ? error.kind : 'unexpected';
      throw new SourceFailure('reddit-token', `the token request failed (${kind})`);
    }
    let answer: { access_token?: unknown; token_type?: unknown } | null = null;
    try {
      answer = JSON.parse(body);
    } catch {
      // handled below
    }
    if (typeof answer?.access_token !== 'string' || answer.access_token === ''
      || (typeof answer.token_type === 'string' && answer.token_type.toLowerCase() !== 'bearer')) {
      throw new SourceFailure('reddit-token', 'the token answer carries no bearer token');
    }
    return answer.access_token;
  }

  async #get(url: string): Promise<{ body: string; attempts: number }> {
    const token = await this.token();
    return fetchFeed(url, { headers: { authorization: `bearer ${token}`, accept: 'application/json', 'user-agent': REDDIT_USER_AGENT } });
  }

  // The posts of the source's listing (the token is requested first, if this run has none yet).
  async listing(source: RedditSource): Promise<{ posts: RedditPost[]; attempts: number }> {
    const { body, attempts } = await this.#get(httpAddress(source.feed_url, 'listing address').toString());
    return { posts: parseListing(body), attempts };
  }

  // Of the given post ids of the source, those Reddit marks removed (removed_by_category set,
  // or the author [deleted]) or no longer returns. The API base is the listing address up to
  // /r/. A failed lookup throws, so the caller deletes nothing.
  async removedIds(source: RedditSource, ids: string[]): Promise<string[]> {
    const at = source.feed_url.indexOf('/r/');
    if (at < 0) throw new SourceFailure('config', 'the listing address has no /r/ part');
    const base = httpAddress(source.feed_url.slice(0, at), 'API base').toString().replace(/\/$/, '');
    const removed: string[] = [];
    for (let start = 0; start < ids.length; start += REDDIT_INFO_BATCH) {
      const batch = ids.slice(start, start + REDDIT_INFO_BATCH);
      let body: string;
      try {
        ({ body } = await this.#get(`${base}/api/info.json?id=${batch.map((id) => `t3_${encodeURIComponent(id)}`).join(',')}`));
      } catch (error) {
        const kind = error instanceof SourceFailure ? error.kind : 'unexpected';
        throw new SourceFailure('reddit-info', `the removal lookup of ${batch.length} post(s) failed (${kind})`);
      }
      let posts: RedditPost[];
      try {
        posts = parseListing(body);
      } catch {
        throw new SourceFailure('reddit-info', `the removal lookup of ${batch.length} post(s) answered no listing`);
      }
      const answered = new Map(posts.map((post) => [post.id, post]));
      for (const id of batch) {
        const post = answered.get(id);
        if (!post || (post.removed_by_category !== undefined && post.removed_by_category !== null) || post.author === '[deleted]') {
          removed.push(id);
        }
      }
    }
    return removed;
  }
}
