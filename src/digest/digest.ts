// The digest step of the ingestion job (priitkustala/ai-news-backend#55): for each feed item
// without a digest, newest first and at most DIGEST_ITEMS_PER_RUN a run, the app's own job reads
// the item's own page once, respecting the host's robots file, sends the item's fields and the
// page's text to the model, and stores only the model's text as the item's digest, never the
// article's. An item whose page cannot be read, or whose reply is refused, counts one attempt;
// after DIGEST_MAX_ATTEMPTS it is not tried again. A failure of the model's interface stops the run
// and keeps what is stored. Standard error carries counts, item ids and failure kinds only.
import { withClient, type Client } from '../db.js';
import { fetchFeed, SourceFailure } from '../collect/fetch.js';
import { robotsAllows } from '../collect/page.js';
import { ARTICLE_MIN_CHARS, articleText, validDigest } from './text.js';

export const DIGEST_ITEMS_PER_RUN = 40;
export const DIGEST_MAX_ATTEMPTS = 3;
export const PAGE_TIMEOUT_MS = 10_000;
export const MODEL_TIMEOUT_MS = 60_000;
export const DIGEST_MODEL = 'gpt-5-nano';
export const DEFAULT_API_BASE = 'https://api.openai.com/v1';
const MAX_COMPLETION_TOKENS = 2000;

export const DIGEST_PROMPT = [
  'You write the digest of one news article for a news app.',
  'You are given the item\'s title, source name, category, feed summary and the text of its page as JSON.',
  'Write the main content of the news in 4 to 8 plain English sentences, at most 1200 characters in all.',
  'Use only facts stated in the given texts; add no fact that is not in them.',
  'Write no link and no address of any kind.',
  'If the given texts do not support a digest of the news, answer with the single word NONE.',
].join(' ');

export type DigestReport = {
  status: 'done' | 'skipped' | 'stopped';
  reason: string | null;
  pending: number;
  stored: number;
  article_skipped: number;
  invalid: number;
};

type PendingItem = {
  id: string;
  title: string;
  category: string;
  summary: string | null;
  canonical_url: string;
  source_name: string | null;
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

// The model's reply text, null for a 2xx answer without a string content, or a ModelStop.
async function askModel(key: string, item: PendingItem, text: string): Promise<string | null> {
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
          { role: 'system', content: DIGEST_PROMPT },
          { role: 'user', content: user },
        ],
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        reasoning_effort: 'minimal',
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

async function countAttempt(client: Client, id: string): Promise<void> {
  await client.query('update public.items set digest_attempts = digest_attempts + 1 where id = $1', [id]);
}

export async function digest(log: (line: string) => void): Promise<DigestReport> {
  const report: DigestReport = { status: 'done', reason: null, pending: 0, stored: 0, article_skipped: 0, invalid: 0 };
  const key = process.env.DIGEST_API_KEY ?? '';
  if (key === '') {
    log('digest: skipped (no key)');
    return { ...report, status: 'skipped', reason: 'no key' };
  }
  return withClient('DATABASE_URL', async (client) => {
    // The feed view's own condition, on the table the job's role may read and write.
    const pending = await client.query<PendingItem>(
      `select i.id, i.title, i.category, i.summary, i.canonical_url, s.name as source_name
         from public.items i
         left join app_private.sources s on s.id = i.source_id
        where i.status = 'processed' and i.is_representative and not i.arxiv_capped
          and i.digest is null and i.digest_attempts < $1
        order by coalesce(i.published_at, i.fetched_at) desc, i.id
        limit $2`,
      [DIGEST_MAX_ATTEMPTS, DIGEST_ITEMS_PER_RUN],
    );
    report.pending = pending.rows.length;
    log(`digest: ${report.pending} pending`);
    for (const item of pending.rows) {
      const article = await readArticle(item.canonical_url);
      if ('skip' in article) {
        await countAttempt(client, item.id);
        report.article_skipped += 1;
        log(`digest: item ${item.id} skipped (${article.skip})`);
        continue;
      }
      let reply: string | null;
      try {
        reply = await askModel(key, item, article.text);
      } catch (error) {
        if (!(error instanceof ModelStop)) throw error;
        report.status = 'stopped';
        report.reason = error.reason;
        log(`digest: stopped at item ${item.id} (${error.reason})`);
        break;
      }
      const text = reply === null ? null : validDigest(reply);
      if (text === null) {
        await countAttempt(client, item.id);
        report.invalid += 1;
        log(`digest: item ${item.id} invalid (${reply === null ? 'no content' : 'refused reply'})`);
        continue;
      }
      await client.query(
        "update public.items set digest = $2, digest_method = 'model' where id = $1 and digest is null",
        [item.id, text],
      );
      report.stored += 1;
      log(`digest: item ${item.id} stored`);
    }
    log(`digest: ${report.status}, pending ${report.pending}, stored ${report.stored}, article_skipped ${report.article_skipped}, invalid ${report.invalid}`);
    return report;
  });
}
