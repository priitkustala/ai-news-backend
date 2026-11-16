// The article digest's pure text rules (priitkustala/ai-news-backend#55): validDigest keeps a model
// reply of 600 to 1200 characters after trimming and 4 to 8 sentences, without a link and not NONE
// (AC-5); articleText turns an article page into its plain text, cut at 12000 characters. And AC-10's
// check that no file of src/digest names the owner's private data. Runs on the built module after
// npm run build; synthetic texts only, no request.
// priitkustala/ai-news-backend#88 (AC-6): the link rule refuses an address only, and the feed bound
// keeps a reply of 1 to 8 sentences and at most 1200 characters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as t from '../dist/digest/text.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A text of n characters made of words of eight letters: it ends in a letter and holds no sentence end.
function words(n) {
  let text = '';
  while (text.length < n) text += 'abcdefgh ';
  text = text.slice(0, n);
  return text.endsWith(' ') ? `${text.slice(0, -1)}x` : text;
}

// `count` sentences joined by single spaces, `total` characters in all.
function sentences(count, total) {
  const body = total - (count - 1);
  const base = Math.floor(body / count);
  return Array.from({ length: count }, (_, i) => {
    const length = i === count - 1 ? body - base * (count - 1) : base;
    return `${words(length - 1)}.`;
  }).join(' ');
}

const valid = (reply) => {
  assert.equal(typeof t.validDigest, 'function', 'validDigest is an exported function');
  return t.validDigest(reply);
};

test('the constants of the digest text', () => {
  assert.equal(t.DIGEST_MIN_CHARS, 600);
  assert.equal(t.DIGEST_MAX_CHARS, 1200);
  assert.equal(t.ARTICLE_MIN_CHARS, 500);
  assert.equal(t.ARTICLE_TEXT_MAX_CHARS, 12000);
});

test('a 5-sentence reply of 820 characters is kept', () => {
  const reply = sentences(5, 820);
  assert.equal(reply.length, 820);
  assert.equal(valid(reply), reply);
});

test('the reply is trimmed', () => {
  const reply = sentences(5, 820);
  assert.equal(valid(`  ${reply}\n`), reply);
});

test('the edges of 600 and 1200 characters are kept', () => {
  const short = sentences(4, 600);
  const long = sentences(8, 1200);
  assert.equal(short.length, 600);
  assert.equal(long.length, 1200);
  assert.equal(valid(short), short);
  assert.equal(valid(long), long);
});

test('a reply of 599 characters is refused', () => {
  const reply = sentences(5, 599);
  assert.equal(reply.length, 599);
  assert.equal(valid(reply), null);
});

test('a reply of 1201 characters is refused', () => {
  const reply = sentences(5, 1201);
  assert.equal(reply.length, 1201);
  assert.equal(valid(reply), null);
});

test('a reply of 3 sentences is refused', () => {
  assert.equal(valid(sentences(3, 800)), null);
});

test('a reply of 9 sentences is refused', () => {
  assert.equal(valid(sentences(9, 800)), null);
});

test('a reply holding a link is refused', () => {
  const reply = sentences(5, 800);
  const linked = `${reply.slice(0, 400)} https://example.com/x ${reply.slice(400 + 23)}`;
  assert.equal(linked.length, 800);
  assert.equal(valid(linked), null);
});

test('AC-6: a reply naming HTTP/3 with no address is kept', () => {
  const reply = sentences(5, 800);
  const named = `${reply.slice(0, 400)} HTTP/3 ${reply.slice(400 + 8)}`;
  assert.equal(named.length, 800);
  assert.equal(valid(named), named);
});

test('AC-6: a reply holding an address is refused', () => {
  const reply = sentences(5, 800);
  const linked = `${reply.slice(0, 400)} https://example.com/x ${reply.slice(400 + 23)}`;
  const named = `${reply.slice(0, 400)} WWW.example.com ${reply.slice(400 + 17)}`;
  assert.equal(linked.length, 800);
  assert.equal(named.length, 800);
  assert.equal(valid(linked), null);
  assert.equal(valid(named), null);
});

// The feed bound (priitkustala/ai-news-backend#88): a reply written without the page's text.
const validFeed = (reply) => {
  assert.equal(typeof t.validDigest, 'function', 'validDigest is an exported function');
  return t.validDigest(reply, 'feed');
};

test('AC-6: the feed bound keeps 1 sentence and 8 sentences', () => {
  const one = sentences(1, 99);
  const eight = sentences(8, 1000);
  assert.equal(one.length, 99);
  assert.equal(eight.length, 1000);
  assert.equal(validFeed(`  ${one}\n`), one);
  assert.equal(validFeed(` ${eight} `), eight);
});

test('AC-6: the feed bound refuses 9 sentences, 1201 characters and NONE', () => {
  const long = sentences(5, 1201);
  assert.equal(long.length, 1201);
  assert.equal(validFeed(sentences(9, 800)), null);
  assert.equal(validFeed(long), null);
  assert.equal(validFeed('NONE'), null);
  assert.equal(validFeed(' none '), null);
});

test('the reply NONE is refused in any case', () => {
  assert.equal(valid('NONE'), null);
  assert.equal(valid(' none '), null);
  assert.equal(valid('None'), null);
});

test('a full stop not followed by white space (as in v1.5) does not end a sentence', () => {
  const four = sentences(4, 800);
  const three = `${sentences(3, 700)} v1.5 ${words(94)}`;
  assert.equal(valid(four), four);
  assert.equal(valid(three), null);
});

test('articleText drops script, style, noscript, template and comments', () => {
  const html = '<html><head><title>T</title><style>p { color: red; }</style><script>var hidden = 1;</script></head>'
    + '<body><!-- a comment --><p>First</p><noscript>no script</noscript><template><p>tpl</p></template><p>Second</p></body></html>';
  assert.equal(t.articleText(html), 'T First Second');
});

test('articleText decodes the entities and collapses white space', () => {
  const html = '<p>a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;&nbsp;f &#39;g&#39; &#x41;</p>\n\n<p>  h\t i </p>';
  assert.equal(t.articleText(html), 'a & b <c> "d" \'e\' f \'g\' A h i');
});

test('articleText cuts at 12000 characters', () => {
  const html = `<p>${words(15000)}</p>`;
  const text = t.articleText(html);
  assert.equal(text.length, 12000);
  assert.equal(text, words(15000).slice(0, 12000));
});

test('AC-10: no file of src/digest names bookmarks, push subscriptions, the owner or auth', () => {
  const folder = path.join(root, 'src', 'digest');
  const files = fs.readdirSync(folder).filter((name) => name.endsWith('.ts'));
  assert.ok(files.length >= 2, `src/digest holds ${files.length} files`);
  const pattern = /bookmarks|push_subscriptions|app_private\.owner|auth\./;
  for (const name of files) {
    const hits = fs.readFileSync(path.join(folder, name), 'utf8').split('\n').filter((line) => pattern.test(line));
    assert.deepEqual(hits, [], `${name} matches the pattern`);
  }
});
