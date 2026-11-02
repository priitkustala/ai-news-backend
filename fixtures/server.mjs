// Fixture feed server of the local test environment (priitkustala/ai-news#40; Locked, Local
// test environment, row Fixture feed server, port 8081): canned RSS and Atom files under
// feeds/, failing and malformed feeds, a feed shaped like the Anthropic mirror and a fixture
// Reddit Data API listing. No internet egress: every address it serves is local. A feed
// address may carry `run` (the scenario's run marker) and `at` (an ISO 8601 instant); the
// templates use them as {{run}}, {{at_iso}} and {{at_rfc822}}, so a seeded source's feed
// carries the marker of the scenario that seeded it. Node 22's built-in modules only.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.FIXTURE_PORT ?? 8081);
const OVERSIZED_BYTES = 3 * 1024 * 1024;
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

function fill(template, { run, at }) {
  return template
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

function send(response, status, type, body) {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  response.end(body);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://fixtures.local');
  const p = params(url);
  let match;
  if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, 'text/plain', 'method not allowed\n');
  if (url.pathname === '/health') return send(response, 200, 'text/plain', 'ok\n');
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
