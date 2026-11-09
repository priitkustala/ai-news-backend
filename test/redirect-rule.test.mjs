// The redirect rule of the fetcher (priitkustala/ai-news#108; approved settlement 47 of
// 2026-11-09, B-03): redirectTarget, a pure function, follows an HTTP 301 or 308 to the
// configured host (a leading www. aside) at https or the configured scheme, at most two
// redirects, and refuses every other redirect in the fetcher's message form. Runs on the built
// module after npm run build; .test hosts only, no request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redirectTarget, SourceFailure } from '../dist/collect/fetch.js';

const refused = (status, detail) => (error) =>
  error instanceof SourceFailure && error.kind === `http-${status}` && error.message === `http-${status}: ${detail}`;
const notFollowed = (status) => refused(status, `the feed answered HTTP ${status}; redirects are not followed`);

test('a 301 from the host to www.host is followed (AC-2)', () => {
  assert.equal(redirectTarget('https://example.test/feed.xml', 'https://example.test/feed.xml', 301, 'https://www.example.test/feed.xml', 1),
    'https://www.example.test/feed.xml');
});

test('a 301 from www.host to the host is followed (AC-2)', () => {
  assert.equal(redirectTarget('https://www.example.test/feed.xml', 'https://www.example.test/feed.xml', 301, 'https://example.test/feed.xml', 1),
    'https://example.test/feed.xml');
});

test('a 308 to another path on the same host is followed, a relative Location against the fetched address', () => {
  assert.equal(redirectTarget('https://example.test/feed.xml', 'https://example.test/feed.xml', 308, '/rss/feed.xml', 1),
    'https://example.test/rss/feed.xml');
});

test('an http configured address redirected to an http target on the same host is followed', () => {
  assert.equal(redirectTarget('http://example.test/feed.xml', 'http://example.test/feed.xml', 301, 'http://example.test/new.xml', 2),
    'http://example.test/new.xml');
});

for (const status of [302, 303, 307, 300]) {
  test(`a ${status} is refused, redirects are not followed`, () => {
    assert.throws(() => redirectTarget('https://example.test/feed.xml', 'https://example.test/feed.xml', status, 'https://example.test/new.xml', 1),
      notFollowed(status));
  });
}

test('a 301 to another host is refused', () => {
  assert.throws(() => redirectTarget('https://example.test/feed.xml', 'https://example.test/feed.xml', 301, 'https://other.example.test/feed.xml', 1),
    notFollowed(301));
});

test('a 301 from https to http on the same host (a lower scheme) is refused', () => {
  assert.throws(() => redirectTarget('https://example.test/feed.xml', 'https://example.test/feed.xml', 301, 'http://example.test/feed.xml', 1),
    notFollowed(301));
});

test('a 301 with no Location is refused', () => {
  assert.throws(() => redirectTarget('https://example.test/feed.xml', 'https://example.test/feed.xml', 301, null, 1), notFollowed(301));
});

test('a third redirect is refused with too many redirects', () => {
  assert.throws(() => redirectTarget('https://example.test/feed.xml', 'https://example.test/b.xml', 301, 'https://example.test/c.xml', 3),
    refused(301, 'the feed answered HTTP 301 after 2 redirects; too many redirects'));
});
