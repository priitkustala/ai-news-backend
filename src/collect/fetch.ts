// Fetch of one configured feed address (priitkustala/ai-news-backend#1, S-02; Locked,
// Architecture: per-source fetch with bounded retry). A permanent redirect (HTTP 301 or 308)
// within the configured site is followed, at most two, never to another host or a lower scheme
// (B-03, priitkustala/ai-news#108); every other redirect is recorded as the source's failure, so
// the job never reaches a host outside the source configuration. Each request has a timeout
// (covering the headers and the whole body) and a size bound; a transient failure (network,
// timeout, HTTP 429 or 5xx), whether it happens before the headers or while the body is read,
// is retried with backoff from the configured address, any other failure (size, redirect, other
// HTTP status) is final at once. A paced source (arXiv) waits for its turn before every attempt.
// A caller may set the method, request headers and a body (the Reddit Data API's token and
// bearer requests, S-07, priitkustala/ai-news#44); the limits are the same. Node 22's built-in
// fetch, no dependency.

export const FETCH_ATTEMPTS = 3;
export const FETCH_BACKOFF_MS = [250, 750];
export const FETCH_TIMEOUT_MS = 15_000;
export const FETCH_MAX_BYTES = 10 * 1024 * 1024;
// The most redirects one attempt follows (priitkustala/ai-news#108).
export const FETCH_MAX_REDIRECTS = 2;
// arXiv asks for at most one request every three seconds (B-03).
export const ARXIV_MIN_GAP_MS = 3_000;

// A failure of one source, recorded on the run as `source_errors[].error`. The message names
// the kind of failure and numbers only, never the feed's content (Locked R-21).
export class SourceFailure extends Error {
  constructor(readonly kind: string, detail: string, readonly transient = false) {
    super(`${kind}: ${detail}`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The arXiv gate: paced attempts, of any lane and retries included, take turns; each turn
// starts at least ARXIV_MIN_GAP_MS after the previous turn's request was answered (or
// failed), so arXiv receives at most one request every three seconds.
let arxivQueue: Promise<void> = Promise.resolve();
let arxivLast = Number.NEGATIVE_INFINITY;
async function arxivTurn(): Promise<() => void> {
  let release = () => {};
  const answered = new Promise<void>((resolve) => { release = () => { arxivLast = performance.now(); resolve(); }; });
  const turn = arxivQueue.then(async () => {
    for (let wait = arxivLast + ARXIV_MIN_GAP_MS - performance.now(); wait > 0; wait = arxivLast + ARXIV_MIN_GAP_MS - performance.now()) {
      await sleep(Math.ceil(wait));
    }
  });
  arxivQueue = turn.then(() => answered);
  await turn;
  return release;
}

async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > FETCH_MAX_BYTES) throw new SourceFailure('too-large', `the feed declares ${declared} bytes, over ${FETCH_MAX_BYTES}`);
  if (!response.body) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > FETCH_MAX_BYTES) throw new SourceFailure('too-large', `the feed is over ${FETCH_MAX_BYTES} bytes`);
    chunks.push(chunk);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

// A thrown fetch or body-stream error as a SourceFailure: a timeout or a network failure is
// transient; its cause code (for example UND_ERR_SOCKET) is kept, never a message text.
function classify(error: unknown, stage: string): SourceFailure {
  if (error instanceof SourceFailure) return error;
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new SourceFailure('timeout', `no complete answer within ${FETCH_TIMEOUT_MS} ms (${stage})`, true);
  }
  const cause = error instanceof Error ? (error.cause as { code?: string } | undefined)?.code : undefined;
  return new SourceFailure('network', `the connection failed ${stage}${cause ? ` (${cause})` : ''}`, true);
}

export type FetchOptions = { paced?: boolean; method?: string; headers?: Record<string, string>; body?: string };

const dropWww = (host: string) => host.toLowerCase().replace(/^www\./, '');

// The address a redirect leads to, or the source's failure (priitkustala/ai-news#108; approved
// settlement 47, B-03). `configured` is the source's feed address, `fetched` the address that
// answered `status` with `location`, and `redirects` the number of this redirect (1 for the
// first). Followed only: a 301 or 308, at most FETCH_MAX_REDIRECTS, to the configured host (a
// leading www. dropped from each, the port kept) at https or the configured scheme. Pure.
export function redirectTarget(configured: string, fetched: string, status: number, location: string | null, redirects: number): string {
  const refused = () => new SourceFailure(`http-${status}`, `the feed answered HTTP ${status}; redirects are not followed`);
  if (status !== 301 && status !== 308) throw refused();
  if (redirects > FETCH_MAX_REDIRECTS) {
    throw new SourceFailure(`http-${status}`, `the feed answered HTTP ${status} after ${FETCH_MAX_REDIRECTS} redirects; too many redirects`);
  }
  if (!location) throw refused();
  let target: URL;
  try {
    target = new URL(location, fetched);
  } catch {
    throw refused();
  }
  const origin = new URL(configured);
  if (dropWww(target.host) !== dropWww(origin.host)) throw refused();
  if (target.protocol !== 'https:' && target.protocol !== origin.protocol) throw refused();
  return target.toString();
}

async function attempt(url: string, options: FetchOptions, answered?: () => void): Promise<string> {
  let address = url;
  for (let redirects = 0; ; redirects += 1) {
    let response: Response;
    try {
      response = await fetch(address, {
        method: options.method ?? 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9', 'user-agent': 'ai-news-backend ingest',
          ...options.headers,
        },
        ...(options.body === undefined ? {} : { body: options.body }),
      });
    } catch (error) {
      throw classify(error, 'before the headers');
    } finally {
      answered?.();
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      address = redirectTarget(url, address, response.status, response.headers.get('location'), redirects + 1);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const transient = response.status === 429 || response.status >= 500;
      throw new SourceFailure(`http-${response.status}`, `the feed answered HTTP ${response.status}`, transient);
    }
    try {
      return await readBounded(response);
    } catch (error) {
      if (error instanceof SourceFailure) await response.body?.cancel().catch(() => undefined);
      throw classify(error, 'while reading the body');
    }
  }
}

// The body of the feed at `url`, or a SourceFailure after at most FETCH_ATTEMPTS attempts;
// with `paced`, each attempt waits for its turn at the arXiv gate.
export async function fetchFeed(url: string, options: FetchOptions = {}): Promise<{ body: string; attempts: number }> {
  for (let n = 1; ; n += 1) {
    const answered = options.paced ? await arxivTurn() : undefined;
    try {
      return { body: await attempt(url, options, answered), attempts: n };
    } catch (error) {
      const failure = classify(error, 'during the request');
      if (!failure.transient || n >= FETCH_ATTEMPTS) {
        throw n > 1 ? new SourceFailure(failure.kind, `${failure.message.slice(failure.kind.length + 2)} (after ${n} attempts)`) : failure;
      }
      await sleep(FETCH_BACKOFF_MS[n - 1] ?? FETCH_BACKOFF_MS[FETCH_BACKOFF_MS.length - 1]);
    }
  }
}
