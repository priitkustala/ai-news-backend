// The routes of the fixture feed server (priitkustala/ai-news-backend#97, AC-2 and AC-4):
// fixtures/server.mjs answers from a list of route handlers, each a method list, a path pattern and
// a function, and every route answers as it did when one callback held them all. The server is
// spawned on a free port with only PATH and FIXTURE_PORT in its environment; one case per route
// asserts the status and the whole content type, the never-request entity its CANARY line on
// standard output, and the stall and disconnect routes their held and dropped bodies.
// Needs no build, no database and no file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'server.mjs');
const BEARER = { authorization: 'Bearer fixture-97' };
let server;
let port;
let output = '';

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
}

before(async () => {
  port = await freePort();
  server = spawn(process.execPath, [serverFile], {
    env: { PATH: process.env.PATH ?? '', FIXTURE_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  server.stdout.setEncoding('utf8');
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('fixture feed server on port')) resolve();
    });
    server.once('exit', (code) => reject(new Error(`the fixture server ended with ${code} before it listened`)));
  });
});

after(() => {
  server.kill();
});

function call(method, pathname, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method, path: pathname, headers, agent: false }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, type: response.headers['content-type'], headers: response.headers, body: text }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end(body);
  });
}

// Opens a request and resolves with the request and its response as soon as the headers arrive.
function open(pathname) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method: 'GET', path: pathname, agent: false }, (response) => resolve({ request, response }));
    request.on('error', reject);
    request.end();
  });
}

async function waitForOutput(text, ms) {
  const until = Date.now() + ms;
  while (!output.includes(text) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 20));
  return output.includes(text);
}

test('AC-2 GET /health answers 200 text/plain', async () => {
  const answer = await call('GET', '/health');
  assert.equal(answer.status, 200);
  assert.equal(answer.type, 'text/plain');
  assert.equal(answer.body, 'ok\n');
});

test('AC-2 GET /robots.txt answers 200 text/plain', async () => {
  const answer = await call('GET', '/robots.txt');
  assert.equal(answer.status, 200);
  assert.equal(answer.type, 'text/plain');
  assert.equal(answer.body, 'User-agent: *\nDisallow: /pages/blocked/\nDisallow: /digest-pages/blocked/\n');
});

test('AC-2 an unknown path answers 404 text/plain', async () => {
  for (const [pathname, headers] of [['/no-such-route', {}], ['/reddit/no-such-route', BEARER]]) {
    const answer = await call('GET', pathname, { headers });
    assert.equal(answer.status, 404, pathname);
    assert.equal(answer.type, 'text/plain', pathname);
    assert.equal(answer.body, 'not found\n', pathname);
  }
  const head = await call('HEAD', '/model-calls/t97-head');
  assert.equal(head.status, 404);
  assert.equal(head.type, 'text/plain');
});

test('AC-2 a POST to a feed answers 405 text/plain', async () => {
  const answer = await call('POST', '/feeds/ok.xml', { body: 'x' });
  assert.equal(answer.status, 405);
  assert.equal(answer.type, 'text/plain');
  assert.equal(answer.body, 'method not allowed\n');
});

test('AC-2 GET /requests answers 200 application/json', async () => {
  await call('GET', '/status/204/t97-logged');
  const answer = await call('GET', '/requests');
  assert.equal(answer.status, 200);
  assert.equal(answer.type, 'application/json');
  const { requests } = JSON.parse(answer.body);
  assert.ok(requests.includes('/status/204/t97-logged'));
  assert.ok(!requests.includes('/health') && !requests.includes('/requests'));
});

test('AC-2 the never-request entity answers 200 application/xml-dtd and writes the CANARY line', async () => {
  const answer = await call('GET', '/entities/never-request.dtd');
  assert.equal(answer.status, 200);
  assert.equal(answer.type, 'application/xml-dtd');
  assert.equal(answer.body, '<!ENTITY never "never">\n');
  assert.equal(await waitForOutput('CANARY: /entities/never-request.dtd was requested\n', 2000), true);
});

test('AC-2 the Reddit token route answers 200 to a Basic client_credentials POST and 401 without', async () => {
  const form = { 'content-type': 'application/x-www-form-urlencoded' };
  const granted = await call('POST', '/reddit/api/v1/access_token', {
    headers: { ...form, authorization: 'Basic Zml4dHVyZTpmaXh0dXJl' }, body: 'grant_type=client_credentials',
  });
  assert.equal(granted.status, 200);
  assert.equal(granted.type, 'application/json');
  assert.equal(JSON.parse(granted.body).token_type, 'bearer');
  const refused = await call('POST', '/reddit/api/v1/access_token', { headers: form, body: 'grant_type=client_credentials' });
  assert.equal(refused.status, 401);
  assert.equal(refused.type, 'application/json');
});

test('AC-2 the model stand-in answers 200 to a bearer POST and 404 for an unknown mode', async () => {
  const headers = { ...BEARER, 'content-type': 'application/json' };
  const answered = await call('POST', '/model/valid/t97-model/chat/completions', { headers, body: '{"messages":[]}' });
  assert.equal(answered.status, 200);
  assert.equal(answered.type, 'application/json');
  assert.equal(JSON.parse(answered.body).object, 'chat.completion');
  const unknown = await call('POST', '/model/no-such-mode/t97-model/chat/completions', { headers, body: '{}' });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.type, 'text/plain');
  assert.equal(unknown.body, 'no such stand-in mode\n');
});

test('AC-2 GET /model-calls/KEY answers 200 application/json', async () => {
  await call('POST', '/model/valid/t97-calls/chat/completions', { headers: BEARER, body: '{"n":1}' });
  const answer = await call('GET', '/model-calls/t97-calls');
  assert.equal(answer.status, 200);
  assert.equal(answer.type, 'application/json');
  assert.equal(JSON.parse(answer.body).calls.length, 1);
});

test('AC-2 a digest page answers 200 text/html and a missing one 404', async () => {
  const page = await call('GET', '/digest-pages/long/t97-page.html');
  assert.equal(page.status, 200);
  assert.equal(page.type, 'text/html; charset=utf-8');
  const missing = await call('GET', '/digest-pages/missing/t97-page.html');
  assert.equal(missing.status, 404);
  assert.equal(missing.type, 'text/plain');
});

test('AC-2 a redirect answers its status with a Location', async () => {
  const answer = await call('GET', '/redirect/301/1/t97-hop?run=t97');
  assert.equal(answer.status, 301);
  assert.equal(answer.type, 'text/plain');
  assert.equal(typeof answer.headers.location, 'string');
  assert.equal(answer.headers.location, `http://127.0.0.1:${port}/feeds/ok.xml?run=t97-t97-hop&target=t97-hop`);
});

test('AC-2 GET /status/503/ID answers 503 text/plain', async () => {
  const answer = await call('GET', '/status/503/t97-status');
  assert.equal(answer.status, 503);
  assert.equal(answer.type, 'text/plain');
  assert.equal(answer.body, 'fixture status 503\n');
});

test('AC-2 GET /feeds/arxiv.xml answers 200 application/rss+xml', async () => {
  const answer = await call('GET', '/feeds/arxiv.xml?count=2&run=t97');
  assert.equal(answer.status, 200);
  assert.equal(answer.type, 'application/rss+xml; charset=utf-8');
  assert.ok(answer.body.includes('t97-arxiv-2 '));
});

test('AC-2 a feed file answers 200 with its RSS or Atom type and a missing one 404', async () => {
  const rss = await call('GET', '/feeds/ok.xml?run=t97');
  assert.equal(rss.status, 200);
  assert.equal(rss.type, 'application/rss+xml; charset=utf-8');
  const atom = await call('GET', '/feeds/simon-willison.xml?run=t97');
  assert.equal(atom.status, 200);
  assert.equal(atom.type, 'application/atom+xml; charset=utf-8');
  const missing = await call('GET', '/feeds/no-such-feed.xml');
  assert.equal(missing.status, 404);
  assert.equal(missing.type, 'text/plain');
  assert.equal(missing.body, 'no such fixture feed\n');
});

test('AC-2 a news page and a blocked news page answer 200 text/html', async () => {
  for (const pathname of ['/pages/news.html?run=t97', '/pages/blocked/news.html?run=t97']) {
    const answer = await call('GET', pathname);
    assert.equal(answer.status, 200, pathname);
    assert.equal(answer.type, 'text/html; charset=utf-8', pathname);
  }
});

test('AC-2 GET /entities/xxe.txt answers 200 text/plain', async () => {
  const answer = await call('GET', '/entities/xxe.txt?run=t97');
  assert.equal(answer.status, 200);
  assert.equal(answer.type, 'text/plain');
  assert.equal(answer.body, 'xxe-t97');
});

test('AC-2 a Reddit route answers 401 without a bearer', async () => {
  for (const pathname of ['/reddit/r/MachineLearning/new.json', '/reddit/api/info.json?id=t3_t97', '/reddit/no-such-route']) {
    const answer = await call('GET', pathname);
    assert.equal(answer.status, 401, pathname);
    assert.equal(answer.type, 'application/json', pathname);
    assert.equal(answer.body, JSON.stringify({ error: 'unauthorized' }), pathname);
  }
});

test('AC-2 GET /reddit/api/info.json answers 200 application/json with a bearer', async () => {
  const answer = await call('GET', '/reddit/api/info.json?id=t3_t97a,t3_t97b', { headers: BEARER });
  assert.equal(answer.status, 200);
  assert.equal(answer.type, 'application/json');
  assert.equal(JSON.parse(answer.body).data.children.length, 2);
});

test('AC-2 a Reddit listing answers 200 application/json with a bearer', async () => {
  const answer = await call('GET', '/reddit/r/MachineLearning/new.json?run=t97', { headers: BEARER });
  assert.equal(answer.status, 200);
  assert.equal(answer.type, 'application/json');
  assert.equal(JSON.parse(answer.body).data.children[0].data.id, 't97-admitted');
});

test('AC-2 an image answers 200 image/png', async () => {
  for (const pathname of ['/images/licensed.png', '/images/fail.png']) {
    const answer = await call('GET', pathname);
    assert.equal(answer.status, 200, pathname);
    assert.equal(answer.type, 'image/png', pathname);
  }
});

test('AC-2 the article page answers 200 text/html', async () => {
  const answer = await call('GET', '/articles/article.html?run=t97');
  assert.equal(answer.status, 200);
  assert.equal(answer.type, 'text/html; charset=utf-8');
  assert.ok(answer.body.includes('t97-body Synthetic publisher article text.'));
});

test('AC-4 the stall route keeps the connection open', async () => {
  const { request, response } = await open('/stall/body/t97-stall');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/rss+xml; charset=utf-8');
  let ended = false;
  response.on('data', () => {});
  response.on('end', () => { ended = true; });
  response.on('error', () => {});
  request.on('error', () => {});
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(ended, false);
  assert.equal(response.complete, false);
  request.destroy();
});

test('AC-4 the disconnect route drops the connection', async () => {
  const { request, response } = await open('/disconnect/body/t97-disconnect');
  assert.equal(response.statusCode, 200);
  let ended = false;
  response.on('data', () => {});
  response.on('end', () => { ended = true; });
  response.on('error', () => {});
  request.on('error', () => {});
  const closed = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 3000);
    response.on('close', () => { clearTimeout(timer); resolve(true); });
  });
  assert.equal(closed, true);
  assert.equal(ended, false);
  assert.equal(response.complete, false);
});
