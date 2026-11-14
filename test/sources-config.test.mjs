// The committed source list config/sources.json (priitkustala/ai-news#108; approved settlement
// 47 of 2026-11-09): its shape, the six changed or new rows, the one Anthropic mirror row, and
// draw-sample's own parse of it through the built command (a refusal before any fetch, so no
// feed is requested). Runs after npm run build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'config', 'sources.json');
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const CATEGORIES = new Set(['releases', 'research', 'policy', 'business', 'other']);

test('config/sources.json parses and holds a list under the key sources', () => {
  const config = read();
  assert.ok(Array.isArray(config.sources) && config.sources.length > 0);
});

test('every row is well formed and the ids are unique', () => {
  const { sources } = read();
  assert.equal(new Set(sources.map((s) => s.id)).size, sources.length, 'ids are unique');
  for (const s of sources) {
    assert.equal(s.source_type, s.id === 'anthropic-news-mirror' ? 'page' : 'feed', `${s.id}: source_type`);
    assert.ok(['feed-summary', 'title-link'].includes(s.display_policy), `${s.id}: display_policy`);
    assert.ok(Array.isArray(s.default_categories) && s.default_categories.every((c) => CATEGORIES.has(c)), `${s.id}: categories`);
    assert.ok(typeof s.source_weight === 'number' && s.source_weight > 0, `${s.id}: source_weight`);
  }
});

const CHANGED = {
  'techpolicy-press': ['https://www.techpolicy.press/rss/feed.xml', ['policy']],
  'simon-willison': ['https://simonwillison.net/tags/ai.atom', ['releases', 'business']],
  'google-ai-blog': ['https://blog.google/innovation-and-ai/technology/ai/rss/', ['releases', 'research']],
  'nvidia-blog': ['https://blogs.nvidia.com/feed/', ['releases', 'business']],
  'mit-technology-review-ai': ['https://www.technologyreview.com/topic/artificial-intelligence/feed', ['research', 'business']],
  'import-ai': ['https://importai.substack.com/feed', ['research', 'policy']],
};

for (const [id, [feedUrl, categories]] of Object.entries(CHANGED)) {
  test(`the row ${id} has its approved address and categories`, () => {
    const row = read().sources.find((s) => s.id === id);
    assert.ok(row, `${id} is listed`);
    assert.equal(row.feed_url, feedUrl);
    assert.deepEqual(row.default_categories, categories);
  });
}

test('exactly one anthropic-news-mirror row', () => {
  assert.equal(read().sources.filter((s) => s.id === 'anthropic-news-mirror').length, 1);
});

test('the anthropic-news-mirror row reads the vendor\'s own news page (priitkustala/ai-news-backend#41)', () => {
  const row = read().sources.find((s) => s.id === 'anthropic-news-mirror');
  assert.equal(row.name, 'Anthropic News');
  assert.equal(row.source_type, 'page');
  assert.equal(row.feed_url, 'https://www.anthropic.com/news');
  assert.deepEqual(row.default_categories, ['releases', 'research']);
  assert.equal(row.display_policy, 'title-link');
  assert.equal(row.source_weight, 1);
});

function drawSample(sourcesFile) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-news-108-'));
  fs.writeFileSync(path.join(out, 'sample.json'), '');
  const result = spawnSync(process.execPath, [path.join(root, 'dist', 'cli.js'), 'draw-sample', '--sources', sourcesFile, '--out', out],
    { cwd: root, encoding: 'utf8' });
  fs.rmSync(out, { recursive: true, force: true });
  return result;
}

test('draw-sample parses config/sources.json and then refuses a folder that already holds sample.json', () => {
  const result = drawSample(file);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /already holds sample\.json/);
});

test('draw-sample refuses a copy of config/sources.json whose second row repeats the first id', () => {
  const config = read();
  config.sources[1] = { ...config.sources[1], id: config.sources[0].id };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-news-108-'));
  const copy = path.join(dir, 'sources.json');
  fs.writeFileSync(copy, JSON.stringify(config));
  const result = drawSample(copy);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /a source id appears twice/);
});
