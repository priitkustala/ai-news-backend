// Fixture feed server of the local test environment (priitkustala/ai-news#40; Locked, Local
// test environment, row Fixture feed server, port 8081): canned RSS and Atom files under
// feeds/, failing and malformed feeds, a feed shaped like the Anthropic mirror and a fixture
// Reddit Data API listing. No internet egress: every address it serves is local. A feed
// address may carry `run` (the scenario's run marker) and `at` (an ISO 8601 instant); the
// templates use them as {{run}}, {{at_iso}} and {{at_rfc822}}, so a seeded source's feed
// carries the marker of the scenario that seeded it; {{origin}} is this server's own address
// as the request reached it. /stall/body and /disconnect/body send their headers and then
// stall or drop the connection (bounded retry of a body read, S-02 round 2). With
// FIXTURE_LOG_REQUESTS=1 every request path is logged to standard output; a request for
// /entities/never-request.dtd is always logged, because no job may ever make it. The Reddit
// routes stand in for Reddit's OAuth and Data API (S-07, priitkustala/ai-news#44): POST
// /reddit/api/v1/access_token answers an application-only token to an HTTP Basic request with
// grant_type client_credentials (401 otherwise); the listing and /reddit/api/info.json need a
// bearer authorization (401 without one); info.json answers every t3_ id of its id parameter
// as a post marked removed (the fixture's "removed on Reddit"). GET /requests answers the
// in-memory log of the last 2000 request paths with their queries (/requests and /health left
// out), and GET /redirect/STATUS/N/ID answers STATUS with a Location to the same route with N-1
// or, at N 1, to ok.xml with run set to the run marker and ID and target=ID, at this origin or,
// with to=other, at this server's own IPv4 address (redirects within a site,
// priitkustala/ai-news#108). Node 22's built-in modules only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.FIXTURE_PORT ?? 8081);
const OVERSIZED_BYTES = 3 * 1024 * 1024;
const REQUEST_LOG_LIMIT = 2000;
const requestLog = [];
// A 1x1 PNG, for the image addresses of the seeded items.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function params(url) {
  const run = url.searchParams.get('run') ?? '';
  const at = new Date(url.searchParams.get('at') ?? Date.now());
  return {
    run: /^[A-Za-z0-9-]{1,64}$/.test(run) ? run : 'fixture',
    at: Number.isNaN(at.getTime()) ? new Date() : at,
  };
}

function fill(template, { run, at, origin }) {
  return template
    .replaceAll('{{origin}}', origin)
    .replaceAll('{{run}}', run)
    .replaceAll('{{at_iso}}', at.toISOString())
    .replaceAll('{{at_rfc822}}', at.toUTCString())
    .replace('{{oversized}}', () => 'x'.repeat(OVERSIZED_BYTES));
}

function arxiv({ run, at }, count) {
  const items = Array.from({ length: count }, (_, n) =>
    `    <item><title>${run}-arxiv-${n + 1} A synthetic paper on agents</title>` +
    `<link>https://arxiv.org/abs/ai-news-fixture-${run}-${n + 1}</link>` +
    `<description>Synthetic abstract ${n + 1}.</description><pubDate>${at.toUTCString()}</pubDate></item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>arXiv cs.AI (fixture)</title>` +
    `<link>https://arxiv.org/list/cs.AI/recent</link><description>Fixture</description>\n${items}\n</channel></rss>\n`;
}

function redditListing({ run, at }, community, omit) {
  const created = Math.floor(at.getTime() / 1000);
  const admitted = {
    kind: 't3',
    data: {
      id: `${run}-admitted`, subreddit: community, title: `${run}-reddit-admitted synthetic post`,
      author: `fixture-author-${run}`, permalink: `/r/${community}/comments/${run}/admitted/`,
      url: `https://external.example.com/ai-news-fixture/${run}-reddit-admitted`, is_self: false,
      post_hint: 'link', created_utc: created, removed_by_category: null,
    },
  };
  const image = {
    kind: 't3',
    data: {
      id: `${run}-image`, subreddit: community, title: `${run}-reddit-image synthetic image post`,
      author: `fixture-author-${run}`, permalink: `/r/${community}/comments/${run}/image/`,
      url: `https://i.redd.it/ai-news-fixture-${run}.png`, is_self: false, post_hint: 'image', created_utc: created,
      removed_by_category: null,
    },
  };
  const children = omit === 'admitted' ? [image] : [admitted, image];
  return JSON.stringify({ kind: 'Listing', data: { after: null, before: null, children } });
}

function redditRemoved(ids) {
  const children = ids.filter((id) => /^t3_[A-Za-z0-9_-]{1,80}$/.test(id)).map((name) => ({
    kind: 't3',
    data: { id: name.slice(3), name, title: '[removed]', author: '[deleted]', removed_by_category: 'deleted' },
  }));
  return JSON.stringify({ kind: 'Listing', data: { after: null, before: null, children } });
}

function readBody(request, limit = 4096) {
  return new Promise((resolve) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; if (body.length > limit) request.destroy(); });
    request.on('end', () => resolve(body));
    request.on('error', () => resolve(''));
  });
}

async function redditToken(request, response) {
  const basic = /^Basic [A-Za-z0-9+/=]+$/.test(request.headers.authorization ?? '');
  const form = new URLSearchParams(await readBody(request));
  if (!basic || form.get('grant_type') !== 'client_credentials') {
    return send(response, 401, 'application/json', JSON.stringify({ error: 'unauthorized' }));
  }
  return send(response, 200, 'application/json',
    JSON.stringify({ access_token: crypto.randomBytes(18).toString('base64url'), token_type: 'bearer', expires_in: 3600, scope: 'read' }));
}

const hasBearer = (request) => /^bearer \S+$/i.test(request.headers.authorization ?? '');

function send(response, status, type, body) {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  response.end(body);
}

function redirect(request, response, url, { run, origin }, status, hops, id) {
  let location;
  if (hops > 1) location = `${origin}/redirect/${status}/${hops - 1}/${id}${url.search}`;
  else {
    const query = new URLSearchParams(url.search);
    query.set('run', `${run}-${id}`);
    query.set('target', id);
    const address = (request.socket.localAddress ?? '127.0.0.1').replace(/^::ffff:/, '');
    const base = query.get('to') === 'other' ? `http://${address}:${PORT}` : origin;
    location = `${base}/feeds/ok.xml?${query}`;
  }
  response.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', Location: location });
  response.end(`fixture redirect ${status}\n`);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://fixtures.local');
  const p = { ...params(url), origin: `http://${request.headers.host ?? `localhost:${PORT}`}` };
  let match;
  if (url.pathname !== '/requests' && url.pathname !== '/health') {
    requestLog.push(url.pathname + url.search);
    if (requestLog.length > REQUEST_LOG_LIMIT) requestLog.splice(0, requestLog.length - REQUEST_LOG_LIMIT);
  }
  if (process.env.FIXTURE_LOG_REQUESTS === '1') process.stdout.write(`request ${new Date().toISOString()} ${request.method} ${url.pathname}\n`);
  if (url.pathname === '/entities/never-request.dtd') {
    process.stdout.write('CANARY: /entities/never-request.dtd was requested\n');
    return send(response, 200, 'application/xml-dtd', '<!ENTITY never "never">\n');
  }
  if ((match = url.pathname.match(/^\/(stall|disconnect)\/body\/[A-Za-z0-9-]+$/))) {
    response.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'no-store' });
    response.write('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>');
    if (match[1] === 'disconnect') setTimeout(() => request.socket.destroy(), 100);
    else {
      const stall = setTimeout(() => response.end('</channel></rss>\n'), 120_000);
      response.on('close', () => clearTimeout(stall));
    }
    return;
  }
  if (url.pathname === '/reddit/api/v1/access_token' && request.method === 'POST') return void redditToken(request, response);
  if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, 'text/plain', 'method not allowed\n');
  if (url.pathname === '/health') return send(response, 200, 'text/plain', 'ok\n');
  if (url.pathname === '/requests') return send(response, 200, 'application/json', JSON.stringify({ requests: requestLog }));
  if ((match = url.pathname.match(/^\/redirect\/(\d{3})\/([1-9])\/([A-Za-z0-9-]+)$/))) {
    return redirect(request, response, url, p, Number(match[1]), Number(match[2]), match[3]);
  }
  if ((match = url.pathname.match(/^\/status\/(\d{3})\/[A-Za-z0-9-]+$/))) {
    return send(response, Number(match[1]), 'text/plain', `fixture status ${match[1]}\n`);
  }
  if (url.pathname === '/feeds/arxiv.xml') {
    const count = Math.min(Math.max(Number(url.searchParams.get('count') ?? 25) || 25, 1), 200);
    return send(response, 200, 'application/rss+xml; charset=utf-8', arxiv(p, count));
  }
  if ((match = url.pathname.match(/^\/feeds\/([a-z0-9-]+\.xml)$/))) {
    const file = path.join(ROOT, 'feeds', match[1]);
    if (!fs.existsSync(file)) return send(response, 404, 'text/plain', 'no such fixture feed\n');
    const body = fill(fs.readFileSync(file, 'utf8'), p);
    return send(response, 200, body.includes('<feed') ? 'application/atom+xml; charset=utf-8' : 'application/rss+xml; charset=utf-8', body);
  }
  if (url.pathname === '/entities/xxe.txt') return send(response, 200, 'text/plain', `xxe-${p.run}`);
  if (url.pathname.startsWith('/reddit/') && !hasBearer(request)) {
    return send(response, 401, 'application/json', JSON.stringify({ error: 'unauthorized' }));
  }
  if (url.pathname === '/reddit/api/info.json') {
    return send(response, 200, 'application/json', redditRemoved((url.searchParams.get('id') ?? '').split(',').slice(0, 100)));
  }
  if ((match = url.pathname.match(/^\/reddit\/r\/([A-Za-z0-9_-]+)\/new\.json$/))) {
    return send(response, 200, 'application/json', redditListing(p, match[1], url.searchParams.get('omit')));
  }
  if (url.pathname === '/images/licensed.png' || url.pathname === '/images/fail.png') return send(response, 200, 'image/png', PNG);
  if (url.pathname === '/articles/article.html') {
    return send(response, 200, 'text/html; charset=utf-8',
      `<!doctype html><html><head><title>${p.run} article</title></head><body><p>${p.run}-body Synthetic publisher article text.</p></body></html>\n`);
  }
  return send(response, 404, 'text/plain', 'not found\n');
});

server.listen(PORT, () => process.stdout.write(`fixture feed server on port ${PORT}\n`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
