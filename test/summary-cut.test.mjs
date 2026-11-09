// The summary cut of the ingestion job (priitkustala/ai-news#109; approved settlement 50 of
// 2026-11-09, B-09): cutSummary, a pure function, keeps a text of at most 1000 characters, cuts a
// longer one after its last sentence end within 1000 characters, else at its last space with one
// ellipsis, else at 999 characters with the ellipsis. Runs on the built module after npm run build;
// synthetic texts only, no request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../dist/ingest/process.js';

const ELLIPSIS = '…';

// A text of n characters made of words of eight letters: it ends in a letter and holds no sentence end.
function words(n) {
  let text = '';
  while (text.length < n) text += 'abcdefgh ';
  text = text.slice(0, n);
  return text.endsWith(' ') ? `${text.slice(0, -1)}x` : text;
}

// A sentence of n characters ending in `end`.
const sentence = (n, end = '.') => `${words(n - 1)}${end}`;

const cut = (text) => {
  assert.equal(typeof p.cutSummary, 'function', 'cutSummary is an exported function');
  return p.cutSummary(text);
};

test('cutSummary is a function', () => {
  assert.equal(typeof p.cutSummary, 'function');
});

test('a 200-character text is returned unchanged', () => {
  const text = sentence(100) + ' ' + sentence(99);
  assert.equal(text.length, 200);
  assert.equal(cut(text), text);
});

test('a 1000-character text is returned unchanged', () => {
  const text = words(1000);
  assert.equal(text.length, 1000);
  assert.equal(cut(text), text);
});

// Worked example: sentences end at characters 380, 760, 980 and 1300 of a 1400-character text.
const example = [sentence(380), sentence(379), sentence(219), sentence(319), words(99)].join(' ');

test('the worked example of 1400 characters is cut after the sentence ending at character 980', () => {
  assert.equal(example.length, 1400);
  const result = cut(example);
  assert.equal(result, example.slice(0, 980));
  assert.equal(result.length, 980);
  assert.equal(result.slice(-1), '.');
});

test('an exclamation mark end is kept', () => {
  const text = `${sentence(500)} ${sentence(300, '!')} ${words(600)}`;
  assert.equal(cut(text), text.slice(0, 801));
  assert.equal(cut(text).slice(-1), '!');
});

test('a question mark end is kept', () => {
  const text = `${sentence(500)} ${sentence(300, '?')} ${words(600)}`;
  assert.equal(cut(text), text.slice(0, 801));
  assert.equal(cut(text).slice(-1), '?');
});

test('a full stop not followed by a space (as in v1.5) is not a sentence end', () => {
  const text = `${sentence(400)} ${words(300)} v1.5 ${words(600)}`;
  const result = cut(text);
  assert.equal(result, text.slice(0, 400));
});

test('1200 characters with no sentence end give at most 1000 characters ending in one ellipsis', () => {
  const text = words(1200);
  const result = cut(text);
  assert.ok(result.length <= 1000, `length ${result.length}`);
  assert.equal(result.slice(-1), ELLIPSIS);
  assert.equal(result.slice(0, -1).includes(ELLIPSIS), false);
  const before = result.slice(0, -1);
  assert.ok(text.startsWith(before));
  assert.equal(text[before.length], ' ');
});

test('the worked example of a first sentence of 1200 characters is cut at the last space within 1000 characters', () => {
  const text = `${sentence(1200)} ${words(100)}`;
  const last = text.slice(0, 1000).lastIndexOf(' ');
  const result = cut(text);
  assert.equal(result, text.slice(0, last) + ELLIPSIS);
  assert.ok(result.length <= 1000);
});

test('a text with no space within its first 1000 characters gives its first 999 characters and the ellipsis', () => {
  const text = `${'a'.repeat(1100)} tail`;
  assert.equal(cut(text), 'a'.repeat(999) + ELLIPSIS);
});

test("a feed's own ellipsis character is not a sentence end", () => {
  const text = `${words(300)}${ELLIPSIS} ${words(1000)}`;
  const result = cut(text);
  assert.equal(result.slice(-1), ELLIPSIS);
  assert.ok(result.length <= 1000);
  assert.ok(result.length > 301);
});

const entry = (summary) => ({ title: 'Synthetic AI model release notes', link: 'https://summary.example.com/ai-news-fixture/unit', summary, published: null, guid: null });
const feedSource = (display_policy) => ({ id: 'unit-source', source_type: 'rss', display_policy, default_categories: null });

test('through processEntries a title-link source keeps no summary', () => {
  const { items } = p.processEntries(feedSource('title-link'), [entry('A short summary.')]);
  assert.equal(items.length, 1);
  assert.equal(items[0].summary, null);
});

test('through processEntries an empty summary gives null', () => {
  const { items } = p.processEntries(feedSource('feed-summary'), [entry('')]);
  assert.equal(items.length, 1);
  assert.equal(items[0].summary, null);
});

test('through processEntries a 3000-character summary gives the cut', () => {
  const raw = [sentence(900), sentence(700), sentence(700), sentence(700)].join(' ');
  const { items } = p.processEntries(feedSource('feed-summary'), [entry(raw)]);
  assert.equal(items.length, 1);
  assert.equal(items[0].summary, cut(raw));
  assert.equal(items[0].summary, raw.slice(0, 900));
});
