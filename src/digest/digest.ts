// The digest step of the ingestion job (priitkustala/ai-news-backend#55, #88; priitkustala/ai-news#191):
// the pick takes every feed item without a digest and with fewer than DIGEST_GIVE_UP_ATTEMPTS
// attempts, items never tried before ahead of items tried before and the newest first inside each
// group, with no limit. For each, the app's own job reads the item's own page once, respecting the
// host's robots file, sends the item's fields and the page's text to the model, and stores only the
// model's text as the item's digest, never the article's. The feed path: an item of a reddit source
// (its page is never read), an item whose page cannot be read, and an item with DIGEST_MAX_ATTEMPTS
// attempts or more is sent with article_text null, and its digest is stored with the mark [...] after
// it. A refused reply counts one attempt and its log line names the reason (rejectReason, or no
// content); an item that reaches DIGEST_GIVE_UP_ATTEMPTS is given up, never picked again, and keeps
// its feed summary in the app. A reply refused for length (priitkustala/ai-news#218) is cut after its
// last sentence end inside 1200 characters or, too short from the page, asked once more with both
// limits named; when nothing fits, the item is given up at once in that run. The step has a time budget of DIGEST_TIME_BUDGET_MS (the environment
// variable of that name, a positive whole number, replaces it in tests): once it is used no item is
// started, the run reports budget, and the next run continues. A failure of the model's interface
// stops the run and keeps what is stored. Standard error carries counts, item ids, reasons and
// failure kinds only.
import { withClient, type Client } from '../db.js';
import { fetchFeed, SourceFailure } from '../collect/fetch.js';
import { robotsAllows } from '../collect/page.js';
import {
  ARTICLE_MIN_CHARS, DIGEST_MAX_CHARS, DIGEST_MIN_CHARS, articleText, fitReply, isTooShort, rejectReason, type RejectReason,
} from './text.js';

export const DIGEST_MAX_ATTEMPTS = 3;
export const DIGEST_GIVE_UP_ATTEMPTS = 5;
export const DIGEST_TIME_BUDGET_MS = 15 * 60_000;
export const PAGE_TIMEOUT_MS = 10_000;
export const MODEL_TIMEOUT_MS = 60_000;
export const DIGEST_MODEL = 'gpt-6-luna';
export const DEFAULT_API_BASE = 'https://api.openai.com/v1';
const MAX_COMPLETION_TOKENS = 2000;
// The mark after a digest written from the feed text only: the whole article could not be read.
const FEED_ONLY_MARK = '[...]';

export const DIGEST_PROMPT = [
  'You write the digest of one news story for a news app whose readers want the news without reading the original article in complex English.',
  'You are given the item\'s title, source name, category, feed summary and the text of its page as JSON; article_text is null when the page could not be read.',
  'Write in professional English that is easy to understand: clear, short sentences, everyday words, and any technical term explained in a few plain words.',
  'With article_text, write the main content of the news in 4 to 8 sentences, at most 1200 characters in all; if the given texts do not support a digest of the news, answer with the single word NONE.',
  'Without article_text, write a shorter digest of 1 to 8 sentences, at most 1200 characters in all, from the title and feed summary only.',
  'Use only facts stated in the given texts; add no fact that is not in them.',
  'Write no link and no address of any kind.',
].join(' ');
// The note after DIGEST_PROMPT when a reply from the page was too short (priitkustala/ai-news#218).
const LENGTH_NOTE = `Your last answer was too short: write at least ${DIGEST_MIN_CHARS} and at most ${DIGEST_MAX_CHARS} characters in all.`;

export type DigestReport = {
  status: 'done' | 'skipped' | 'stopped' | 'budget';
  reason: string | null;
  pending: number;
  stored: number;
  article_skipped: number;
  invalid: number;
  stored_page: number;
  stored_feed: number;
  invalid_none: number;
  invalid_link: number;
  invalid_length: number;
  invalid_sentences: number;
  invalid_no_content: number;
  given_up: number;
  left: number;
};

// The model's answer for an item: the digest to store, or null and the reason it is refused.
type Answer = { reply: string; reason: null } | { reply: null; reason: RejectReason | 'no content' };

type PendingItem = {
  id: string;
  title: string;
  category: string;
  summary: string | null;
  canonical_url: string;
  source_name: string | null;
  digest_attempts: number;
  source_type: string | null;
};

const PAGE_OPTIONS = {
  timeoutMs: PAGE_TIMEOUT_MS,
  attempts: 1,
  headers: { accept: 'text/html, text/plain;q=0.9', 'user-agent': 'ai-news-backend digest' },
};

// A failure of the model's interface: it stops the run.
class ModelStop extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

// The item's page text, or the kind of the reason it is skipped.
async function readArticle(link: string): Promise<{ text: string } | { skip: string }> {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return { skip: 'link' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { skip: 'link' };
  try {
    const { body } = await fetchFeed(new URL('/robots.txt', url).href, PAGE_OPTIONS);
    if (!robotsAllows(body, url.pathname + url.search)) return { skip: 'robots' };
  } catch (error) {
    if (!(error instanceof SourceFailure && error.kind === 'http-404')) {
      return { skip: `robots ${error instanceof SourceFailure ? error.kind : 'unreadable'}` };
    }
  }
  let html: string;
  try {
    ({ body: html } = await fetchFeed(url.href, PAGE_OPTIONS));
  } catch (error) {
    return { skip: `page ${error instanceof SourceFailure ? error.kind : 'unreadable'}` };
  }
  const text = articleText(html);
  if (text.length < ARTICLE_MIN_CHARS) return { skip: 'short' };
  return { text };
}

// The model's reply text, null for a 2xx answer without a string content, or a ModelStop. text is
// null on the feed path; note, when given, follows DIGEST_PROMPT in the system message.
async function askModel(key: string, item: PendingItem, text: string | null, note?: string): Promise<string | null> {
  const base = process.env.DIGEST_API_BASE || DEFAULT_API_BASE;
  const user = JSON.stringify({
    title: item.title,
    source_name: item.source_name,
    category: item.category,
    feed_summary: item.summary,
    article_text: text,
  });
  let response: Response;
  let body: string;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: DIGEST_MODEL,
        messages: [
          { role: 'system', content: note === undefined ? DIGEST_PROMPT : `${DIGEST_PROMPT} ${note}` },
          { role: 'user', content: user },
        ],
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        reasoning_effort: 'none',
      }),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
    if (response.status < 200 || response.status > 299) {
      await response.body?.cancel().catch(() => undefined);
      throw new ModelStop(`http-${response.status}`);
    }
    body = await response.text();
  } catch (error) {
    if (error instanceof ModelStop) throw error;
    throw new ModelStop(error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'network');
  }
  try {
    const content = (JSON.parse(body) as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : null;
  } catch {
    return null;
  }
}

// The closest suitable match for a reply refused for length (priitkustala/ai-news#218): its fit, else,
// for a reply too short from the page, the fit of one more reply asked with LENGTH_NOTE; null when
// nothing fits. A ModelStop of the second ask is thrown on, as the first ask's is.
async function closestFit(key: string, item: PendingItem, text: string | null, first: string, from: 'page' | 'feed'): Promise<string | null> {
  const fitted = fitReply(first, from);
  if (fitted !== null) return fitted;
  if (!isTooShort(first, from)) return null;
  const second = await askModel(key, item, text, LENGTH_NOTE);
  return second === null ? null : fitReply(second, from);
}

// The model's answer for the item: the passing reply trimmed, the closest fit of a reply refused for
// length (priitkustala/ai-news#218), or null and the reason. A ModelStop of either ask is thrown on.
async function answer(key: string, item: PendingItem, text: string | null, from: 'page' | 'feed'): Promise<Answer> {
  const first = await askModel(key, item, text);
  if (first === null) return { reply: null, reason: 'no content' };
  const reason = rejectReason(first, from);
  if (reason === null) return { reply: first.trim(), reason: null };
  const fitted = reason === 'length' ? await closestFit(key, item, text, first, from) : null;
  return fitted === null ? { reply: null, reason } : { reply: fitted, reason: null };
}

// The step's time budget: the environment variable DIGEST_TIME_BUDGET_MS when it holds a positive
// whole number (tests only), else the constant.
function timeBudgetMs(): number {
  const value = process.env.DIGEST_TIME_BUDGET_MS ?? '';
  return /^[0-9]+$/.test(value) && Number(value) > 0 ? Number(value) : DIGEST_TIME_BUDGET_MS;
}

async function countAttempt(client: Client, id: string): Promise<void> {
  await client.query('update public.items set digest_attempts = digest_attempts + 1 where id = $1', [id]);
}

// Gives the item up at once (priitkustala/ai-news#218): no reply could be made to fit its length.
async function giveUp(client: Client, id: string): Promise<void> {
  await client.query('update public.items set digest_attempts = $2 where id = $1', [id, DIGEST_GIVE_UP_ATTEMPTS]);
}

// The skipped run's report: the six keys of ai-news-backend#55 only.
export type SkippedReport = Pick<DigestReport, 'status' | 'reason' | 'pending' | 'stored' | 'article_skipped' | 'invalid'>;

export async function digest(log: (line: string) => void): Promise<DigestReport | SkippedReport> {
  const start = Date.now();
  const report: DigestReport = {
    status: 'done', reason: null, pending: 0, stored: 0, article_skipped: 0, invalid: 0,
    stored_page: 0, stored_feed: 0, invalid_none: 0, invalid_link: 0, invalid_length: 0, invalid_sentences: 0,
    invalid_no_content: 0, given_up: 0, left: 0,
  };
  const key = process.env.DIGEST_API_KEY ?? '';
  if (key === '') {
    log('digest: skipped (no key)');
    return { status: 'skipped', reason: 'no key', pending: 0, stored: 0, article_skipped: 0, invalid: 0 };
  }
  const budget = timeBudgetMs();
  return withClient('DATABASE_URL', async (client) => {
    // The feed view's own condition, on the table the job's role may read and write. Every pending
    // item: never tried before first, then tried before, the newest first in each group.
    const pending = await client.query<PendingItem>(
      `select i.id, i.title, i.category, i.summary, i.canonical_url, s.name as source_name,
              i.digest_attempts, s.source_type
         from public.items i
         left join app_private.sources s on s.id = i.source_id
        where i.status = 'processed' and i.is_representative and not i.arxiv_capped
          and i.digest is null and i.digest_attempts < $1
        order by i.digest_attempts > 0, coalesce(i.published_at, i.fetched_at) desc, i.id`,
      [DIGEST_GIVE_UP_ATTEMPTS],
    );
    report.pending = pending.rows.length;
    log(`digest: ${report.pending} pending`);
    for (const item of pending.rows) {
      if (Date.now() - start >= budget) {
        report.status = 'budget';
        log(`digest: budget used at item ${item.id}`);
        break;
      }
      // A reddit story's page is never read; a story with its page attempts used takes the feed path.
      const feedOnly = item.source_type === 'reddit' || item.digest_attempts >= DIGEST_MAX_ATTEMPTS;
      let text: string | null = null;
      if (!feedOnly) {
        const article = await readArticle(item.canonical_url);
        if ('skip' in article) {
          report.article_skipped += 1;
          log(`digest: item ${item.id} skipped (${article.skip})`);
        } else {
          text = article.text;
        }
      }
      const from = text === null ? 'feed' : 'page';
      let answered: Answer;
      try {
        answered = await answer(key, item, text, from);
      } catch (error) {
        if (!(error instanceof ModelStop)) throw error;
        report.status = 'stopped';
        report.reason = error.reason;
        log(`digest: stopped at item ${item.id} (${error.reason})`);
        break;
      }
      if (answered.reply === null) {
        const { reason } = answered;
        await (reason === 'length' ? giveUp(client, item.id) : countAttempt(client, item.id));
        report.invalid += 1;
        if (reason === 'none') report.invalid_none += 1;
        else if (reason === 'link') report.invalid_link += 1;
        else if (reason === 'length') report.invalid_length += 1;
        else if (reason === 'sentences') report.invalid_sentences += 1;
        else report.invalid_no_content += 1;
        log(`digest: item ${item.id} invalid (${reason})`);
        continue;
      }
      const checked = answered.reply;
      await client.query(
        "update public.items set digest = $2, digest_method = 'model' where id = $1 and digest is null",
        [item.id, from === 'feed' ? `${checked} ${FEED_ONLY_MARK}` : checked],
      );
      report.stored += 1;
      if (from === 'feed') report.stored_feed += 1;
      else report.stored_page += 1;
      log(`digest: item ${item.id} stored${from === 'feed' ? ' (feed only)' : ''}`);
    }
    const givenUp = await client.query<{ count: number }>(
      `select count(*)::int as count from public.items i
        where i.status = 'processed' and i.is_representative and not i.arxiv_capped and i.digest is null and i.digest_attempts >= $1`,
      [DIGEST_GIVE_UP_ATTEMPTS],
    );
    report.given_up = givenUp.rows[0].count;
    const left = await client.query<{ count: number }>(
      `select count(*)::int as count from public.items i
        where i.status = 'processed' and i.is_representative and not i.arxiv_capped and i.digest is null and i.digest_attempts < $1`,
      [DIGEST_GIVE_UP_ATTEMPTS],
    );
    report.left = left.rows[0].count;
    const status = report.status === 'stopped' ? `stopped (${report.reason})` : report.status;
    log(`digest: ${status}, pending ${report.pending}, stored ${report.stored} (page ${report.stored_page}, feed ${report.stored_feed}), `
      + `article_skipped ${report.article_skipped}, invalid ${report.invalid} (none ${report.invalid_none}, link ${report.invalid_link}, `
      + `length ${report.invalid_length}, sentences ${report.invalid_sentences}, no content ${report.invalid_no_content}), `
      + `given_up ${report.given_up}, left ${report.left}`);
    return report;
  });
}
