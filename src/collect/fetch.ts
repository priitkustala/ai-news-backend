// Fetch of one configured feed address (priitkustala/ai-news-backend#1, S-02; Locked,
// Architecture: per-source fetch with bounded retry). Only the configured address is
// requested: a redirect is not followed but recorded as the source's failure, so the job
// never reaches a host outside the source configuration (B-03). Each attempt has a timeout
// (covering the headers and the whole body) and a size bound; a transient failure (network,
// timeout, HTTP 429 or 5xx), whether it happens before the headers or while the body is read,
// is retried with backoff, any other failure (size, redirect, other HTTP status) is final at
// once. Node 22's built-in fetch, no dependency.

export const FETCH_ATTEMPTS = 3;
export const FETCH_BACKOFF_MS = [250, 750];
export const FETCH_TIMEOUT_MS = 15_000;
export const FETCH_MAX_BYTES = 10 * 1024 * 1024;

// A failure of one source, recorded on the run as `source_errors[].error`. The message names
// the kind of failure and numbers only, never the feed's content (Locked R-21).
export class SourceFailure extends Error {
  constructor(readonly kind: string, detail: string, readonly transient = false) {
    super(`${kind}: ${detail}`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function attempt(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9', 'user-agent': 'ai-news-backend ingest' },
    });
  } catch (error) {
    throw classify(error, 'before the headers');
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new SourceFailure(`http-${response.status}`, `the feed answered HTTP ${response.status}; redirects are not followed`);
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

// The body of the feed at `url`, or a SourceFailure after at most FETCH_ATTEMPTS attempts.
export async function fetchFeed(url: string): Promise<{ body: string; attempts: number }> {
  for (let n = 1; ; n += 1) {
    try {
      return { body: await attempt(url), attempts: n };
    } catch (error) {
      const failure = classify(error, 'during the request');
      if (!failure.transient || n >= FETCH_ATTEMPTS) {
        throw n > 1 ? new SourceFailure(failure.kind, `${failure.message.slice(failure.kind.length + 2)} (after ${n} attempts)`) : failure;
      }
      await sleep(FETCH_BACKOFF_MS[n - 1] ?? FETCH_BACKOFF_MS[FETCH_BACKOFF_MS.length - 1]);
    }
  }
}
