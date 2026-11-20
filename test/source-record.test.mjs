// The one reader of a source record (priitkustala/ai-news-backend#95): readSample (the sample
// envelope, a saved feed), readSources (the sources-file envelope of draw-sample and
// seed-sources, a feed_url) and readSourceRecord (the seed envelope) refuse a record without an
// id, without its envelope's feed or with a present field of the wrong type, naming the field and
// the source id, and read an absent optional field as the sources table's default. The commands
// are spawned with an empty secrets folder and a database address nothing listens on, so a
// refusal shows before any connection. Runs after npm run build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources } from '../dist/measure/draw.js';
import { MeasureError, readSample } from '../dist/measure/sample.js';
import { readSourceRecord, SourceRecordError } from '../dist/sources/record.js';
import { UsageError } from '../dist/env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function inTemp(work) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't95-'));
  try {
    return work(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const writeJson = (dir, name, value) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
};

const fromSourcesFile = (entries) => inTemp((dir) => readSources(writeJson(dir, 'sources.json', { sources: entries })).sources);

const sampleOf = (sources) => ({
  sample_id: 't95',
  window: { start: '2026-10-26T00:00:00.000Z', end: '2026-11-02T00:00:00.000Z' },
  max_items_per_source: 20,
  sources,
});
const fromSample = (sources) => inTemp((dir) => readSample(writeJson(dir, 'sample.json', sampleOf(sources))).sources);

const FEED = ['<?xml version="1.0"?>', '<rss version="2.0"><channel><title>t95</title></channel></rss>'];
const fileEntry = (id, extra = {}) => ({ id, feed_url: `http://example.invalid/${id}.xml`, ...extra });
const sampleEntry = (id, extra = {}) => ({ id, feed: FEED, ...extra });

function refuses(work, ErrorClass, message) {
  assert.throws(work, (error) => {
    assert.ok(error instanceof ErrorClass, `a ${ErrorClass.name}`);
    assert.equal(error.message, message);
    return true;
  });
}

function cli(args) {
  return inTemp((dir) => spawnSync(process.execPath, [path.join(root, 'dist', 'cli.js'), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      AI_NEWS_SECRETS_DIR: dir,
      DATABASE_URL: 'postgres://t95@127.0.0.1:9/t95',
      MIGRATION_DATABASE_URL: 'postgres://t95@127.0.0.1:9/t95',
      PGCONNECT_TIMEOUT: '5',
    },
    timeout: 60_000,
  }));
}

const lastLine = (text) => text.split('\n').filter((line) => line.trim() !== '').at(-1);

test('AC-2 a record without id is refused naming id', () => {
  refuses(() => fromSample([{ feed: FEED }]), MeasureError, 'sample.json: source 1 has no id');
  refuses(() => fromSourcesFile([{ feed_url: 'http://example.invalid/a.xml' }]), UsageError,
    '--sources <file>: source 1 needs an id of lower-case letters, digits and hyphens');
  refuses(() => readSourceRecord({ name: 'No id', feed_url: 'http://example.invalid/a.xml' }, 0, 'seed'), SourceRecordError, 'source 1 has no id');
});

test('AC-2 case A a sample source with a saved feed and no feed_url is accepted', () => {
  const [source] = fromSample([sampleEntry('s-a')]);
  assert.equal(source.id, 's-a');
  assert.equal(source.feed, FEED.join('\n'));
});

test('AC-2 case B a sample source without a saved feed is refused naming feed', () => {
  refuses(() => fromSample([{ id: 's-b' }]), MeasureError, 'sample.json: source s-b has no saved feed');
  refuses(() => fromSample([{ id: 's-b', feed: 'one line' }]), MeasureError, 'sample.json: source s-b has no saved feed');
  refuses(() => fromSample([{ id: 's-b', feed: ['a line', 2] }]), MeasureError, 'sample.json: source s-b has no saved feed');
});

test('AC-2 case C a source without a text feed_url is refused naming feed_url', () => {
  refuses(() => fromSourcesFile([{ id: 's-c' }]), UsageError, '--sources <file>: source s-c has no feed_url');
  refuses(() => fromSourcesFile([{ id: 's-c', feed_url: '' }]), UsageError, '--sources <file>: source s-c has no feed_url');
  refuses(() => fromSourcesFile([{ id: 's-c', feed_url: 7 }]), UsageError, '--sources <file>: source s-c has no feed_url');
});

test('AC-2 a text source_weight is refused naming the field', () => {
  refuses(() => fromSourcesFile([fileEntry('lab-news', { source_weight: '2' })]), UsageError,
    '--sources <file>: source lab-news: source_weight must be a number');
  refuses(() => fromSample([sampleEntry('lab-news', { source_weight: '2' })]), MeasureError,
    'sample.json: source lab-news: source_weight must be a number');
});

test('AC-2 a number as source_type is refused naming the field', () => {
  refuses(() => fromSourcesFile([fileEntry('lab-news', { source_type: 1 })]), UsageError,
    '--sources <file>: source lab-news: source_type must be text');
  refuses(() => fromSample([sampleEntry('lab-news', { source_type: 1 })]), MeasureError,
    'sample.json: source lab-news: source_type must be text');
});

test('AC-2 a number as display_policy is refused naming the field', () => {
  refuses(() => fromSourcesFile([fileEntry('lab-news', { display_policy: 1 })]), UsageError,
    '--sources <file>: source lab-news: display_policy must be text');
  refuses(() => fromSample([sampleEntry('lab-news', { display_policy: 1 })]), MeasureError,
    'sample.json: source lab-news: display_policy must be text');
});

test('AC-2 absent source_type, display_policy and source_weight read as feed, title-link and 1', () => {
  const [fromFile] = fromSourcesFile([fileEntry('lab-news')]);
  assert.deepEqual([fromFile.source_type, fromFile.display_policy, fromFile.source_weight], ['feed', 'title-link', 1]);
  const [fromSampleFile] = fromSample([sampleEntry('lab-news')]);
  assert.deepEqual([fromSampleFile.source_type, fromSampleFile.display_policy, fromSampleFile.source_weight], ['feed', 'title-link', 1]);
});

test('AC-2 an absent runner reads as cloud', () => {
  const [source] = fromSourcesFile([fileEntry('lab-news')]);
  assert.equal(source.runner, 'cloud');
});

test('AC-2 absent name, default_categories, community and image_policy read as the id, empty, none and placeholder', () => {
  const source = readSourceRecord({ id: 'lab-news', feed_url: 'http://example.invalid/lab-news.xml' }, 0, 'seed');
  assert.equal(source.name, 'lab-news');
  assert.deepEqual(source.default_categories, []);
  assert.equal(source.community, null);
  assert.equal(source.image_policy, 'placeholder');
});

test('AC-2 a well-formed file reads unchanged', () => {
  const given = {
    id: 'lab-news',
    name: 'Lab News',
    feed_url: 'https://example.org/feed.xml',
    source_type: 'reddit',
    community: 'MachineLearning',
    default_categories: ['research', 'releases'],
    image_policy: 'licensed',
    display_policy: 'feed-summary',
    source_weight: 2.5,
    runner: 'laptop',
  };
  const [source] = fromSourcesFile([given]);
  assert.deepEqual(source, given);
});

test('AC-2 seed-sources refuses the worked example with exit 2 before any connection', () => {
  inTemp((dir) => {
    const file = writeJson(dir, 'sources.json', { sources: [{ id: 'lab-news', feed_url: 'https://example.org/feed.xml', source_weight: '2' }] });
    const result = cli(['seed-sources', file]);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(lastLine(result.stderr), 'usage: --sources <file>: source lab-news: source_weight must be a number');
  });
});

test('AC-2 measure refuses a sample source without a saved feed with exit 1', () => {
  inTemp((dir) => {
    writeJson(dir, 'sample.json', sampleOf([{ id: 's-b' }]));
    const result = cli(['measure', '--sample-dir', dir]);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(lastLine(result.stderr), 'measure: sample.json: source s-b has no saved feed');
  });
});

test('AC-3 config/sources.json reads through the reader with no error', () => {
  const file = path.join(root, 'config', 'sources.json');
  const given = JSON.parse(fs.readFileSync(file, 'utf8')).sources;
  const { sources } = readSources(file);
  assert.equal(sources.length, 16);
  sources.forEach((source, index) => {
    const entry = given[index];
    assert.deepEqual(source, {
      id: entry.id,
      name: entry.name ?? entry.id,
      feed_url: entry.feed_url,
      source_type: entry.source_type ?? 'feed',
      default_categories: entry.default_categories ?? [],
      display_policy: entry.display_policy ?? 'title-link',
      source_weight: entry.source_weight ?? 1,
      runner: entry.runner ?? 'cloud',
      community: entry.community ?? null,
      image_policy: entry.image_policy ?? 'placeholder',
    });
  });
});

test('AC-3 fixtures/validation-sample/sample.json reads through the reader with no error', () => {
  const given = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'validation-sample', 'sample.json'), 'utf8')).sources;
  const { sources } = readSample();
  assert.equal(sources.length, 9);
  sources.forEach((source, index) => {
    const entry = given[index];
    assert.deepEqual(source, {
      id: entry.id,
      source_type: entry.source_type ?? 'feed',
      display_policy: entry.display_policy ?? 'title-link',
      default_categories: entry.default_categories ?? [],
      source_weight: entry.source_weight ?? 1,
      feed: entry.feed.join('\n'),
    });
  });
});

test('AC-6 an empty sources list is refused with exit 2', () => {
  inTemp((dir) => {
    const result = cli(['seed-sources', writeJson(dir, 'sources.json', { sources: [] })]);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(lastLine(result.stderr), 'usage: --sources <file> needs a non-empty list under the key sources');
  });
});

test('AC-6 a sources value that is not a list is refused with exit 2', () => {
  inTemp((dir) => {
    const result = cli(['seed-sources', writeJson(dir, 'sources.json', { sources: { id: 'lab-news', feed_url: 'https://example.org/feed.xml' } })]);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(lastLine(result.stderr), 'usage: --sources <file> needs a non-empty list under the key sources');
  });
});
