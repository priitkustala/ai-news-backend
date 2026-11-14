// The reader of the vendor's own news page and its robots rule (priitkustala/ai-news-backend#41,
// AC-1, AC-2 and AC-4): parsePageItems on the synthetic pages under fixtures/pages/, filled here as
// the fixture server fills them (run marker unit, dates from one fixed instant), and robotsAllows
// on robots texts written in the test. Runs after npm run build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePageItems, robotsAllows } from '../dist/collect/page.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_URL = 'http://fixture.test/pages/news.html';
const AT = new Date('2026-11-03T12:00:00.000Z');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pageDate(days) {
  const d = new Date(AT.getTime() - days * 24 * 3600 * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function page(name) {
  return fs.readFileSync(path.join(root, 'fixtures', 'pages', name), 'utf8')
    .replaceAll('{{run}}', 'unit')
    .replaceAll('{{page_date_0}}', pageDate(0))
    .replaceAll('{{page_date_6}}', pageDate(6))
    .replaceAll('{{page_date_13}}', pageDate(13));
}

test('AC-1: the news page gives its three dated posts, each once, and rejects the undated link by count', () => {
  const { entries, rejected } = parsePageItems(page('news.html'), PAGE_URL);
  assert.equal(entries.length, 3);
  for (const entry of entries) {
    assert.ok(typeof entry.title === 'string' && entry.title.trim() !== '', 'a non-empty title');
    assert.equal(entry.summary, null);
  }
  assert.deepEqual(entries.map((e) => e.link), [
    'http://fixture.test/news/unit-example-model-launch',
    'http://fixture.test/news/unit-example-research-note',
    'http://fixture.test/news/unit-example-policy-update',
  ]);
  assert.deepEqual(entries.map((e) => e.published), [
    '2026-11-03T00:00:00.000Z',
    '2026-10-28T00:00:00.000Z',
    '2026-10-21T00:00:00.000Z',
  ]);
  assert.equal(entries.filter((e) => e.link.endsWith('/news/unit-example-model-launch')).length, 1, 'the twice-linked post once');
  assert.ok(entries.every((e) => !e.link.includes('/careers/')), 'no /careers/ link');
  assert.equal(rejected.length, 1);
  assert.match(rejected[0], /\d/, 'the rejection names a count');
  assert.ok(!rejected[0].includes('unit'), 'the rejection names no title or link');
});

test('AC-2: the changed layout gives no entry', () => {
  const { entries } = parsePageItems(page('news-changed.html'), PAGE_URL);
  assert.equal(entries.length, 0);
});

test('AC-4: a missing robots file (no rules) allows the page', () => {
  assert.equal(robotsAllows('', '/pages/news.html'), true);
});

test('AC-4: Disallow /pages/blocked/ blocks that prefix and allows /pages/news.html', () => {
  const robots = 'User-agent: *\nDisallow: /pages/blocked/\n';
  assert.equal(robotsAllows(robots, '/pages/blocked/news.html'), false);
  assert.equal(robotsAllows(robots, '/pages/news.html'), true);
});

test('AC-4: a longer Allow overrides a shorter Disallow', () => {
  const robots = 'User-agent: *\nDisallow: /pages/\nAllow: /pages/news.html\n';
  assert.equal(robotsAllows(robots, '/pages/news.html'), true);
  assert.equal(robotsAllows(robots, '/pages/other.html'), false);
});

test('AC-4: the group for ai-news-backend beats the group *', () => {
  const robots = 'User-agent: *\nDisallow: /\n\nUser-agent: AI-News-Backend\nAllow: /pages/\nDisallow: /pages/private/\n';
  assert.equal(robotsAllows(robots, '/pages/news.html'), true);
  assert.equal(robotsAllows(robots, '/pages/private/news.html'), false);
  assert.equal(robotsAllows(robots, '/pages/news.html', 'another-agent'), false);
});
