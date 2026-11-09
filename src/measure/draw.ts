// The draw-sample command (priitkustala/ai-news#75, SI-3a; Locked B-25: a frozen 7-day sample,
// at most 20 items per source, labelled by the owner). It fetches each source of a --sources
// file once, with the job's own fetch and parser (src/collect/fetch.ts: only the configured
// address, no redirect followed, a timeout and a size bound; src/collect/parse.ts), and writes
// into an --out folder that git does not track: sample.json in the committed format of
// fixtures/validation-sample/, labels.json with one empty label set per item (label_origin
// unlabelled), labelling-table.md for the owner and sources.json, a copy of the input. The
// folder is then measurable with measure --sample-dir. Real items never enter a repository
// (Locked OD-23, R-21): a tracked --out is refused, and standard output and standard error carry
// source ids, counts, bytes and hashes only, never a title, a link or a summary.
//
// The saved feed of a source is not the publisher's body: it is the drawn entries written back
// as a minimal RSS 2.0 body, escaped as the hostile fixtures' feed of src/measure/measure.ts is,
// so that it holds only the drawn items (measure refuses an item outside the window or over the
// cap) and the parser returns exactly the drawn entries from it (checked here, per source).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { UsageError } from '../env.js';
import { isArxivSource } from '../collect/collect.js';
import { fetchFeed, SourceFailure } from '../collect/fetch.js';
import { parseFeedItems, type FeedEntry } from '../collect/parse.js';
import { canonicalUrl } from '../process/dedupe.js';
import { CATEGORIES } from '../process/category-rules.js';
import { MeasureError, trackedByGit } from './sample.js';

export const WINDOW_DAYS = 7;
export const MAX_ITEMS_PER_SOURCE = 20;
const DRAW_CONCURRENCY = 4;
const DAY_MS = 86_400_000;

export const TABLE_HEADER = '| fixture_id | source_id | title | link | ai_relevant | category | duplicate_group | importance |';

type DrawSource = {
  id: string;
  name: string;
  feed_url: string;
  source_type: string;
  default_categories: string[];
  display_policy: string;
  source_weight: number;
};

export type Dropped = { no_link: number; no_time: number; outside_window: number; repeated: number; over_cap: number; oversized: number };

export type SourceLine = {
  source_id: string;
  status: 'fetched' | 'failed' | 'excluded';
  bytes: number;
  entries: number;
  kept: number;
  dropped: Dropped;
  reason: string | null;
};

type Drawn = { line: SourceLine; kept: FeedEntry[] };

export function readSources(file: string): { input: Buffer; sources: DrawSource[] } {
  let input: Buffer;
  let raw: unknown;
  try {
    input = fs.readFileSync(file);
  } catch {
    throw new UsageError('--sources <file> cannot be read');
  }
  try {
    raw = JSON.parse(input.toString('utf8'));
  } catch {
    throw new UsageError('--sources <file> is not JSON');
  }
  const list = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).sources : undefined;
  if (!Array.isArray(list) || list.length === 0) throw new UsageError('--sources <file> needs a non-empty list under the key sources');
  const sources = list.map((entry, index): DrawSource => {
    const s = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    if (typeof s.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(s.id)) throw new UsageError(`--sources <file>: source ${index + 1} needs an id of lower-case letters, digits and hyphens`);
    if (typeof s.feed_url !== 'string' || s.feed_url === '') throw new UsageError(`--sources <file>: source ${s.id} has no feed_url`);
    return {
      id: s.id,
      name: typeof s.name === 'string' ? s.name : s.id,
      feed_url: s.feed_url,
      source_type: typeof s.source_type === 'string' ? s.source_type : 'feed',
      default_categories: Array.isArray(s.default_categories) ? s.default_categories.map(String) : [],
      display_policy: typeof s.display_policy === 'string' ? s.display_policy : 'title-link',
      source_weight: typeof s.source_weight === 'number' ? s.source_weight : 1,
    };
  });
  if (new Set(sources.map((s) => s.id)).size !== sources.length) throw new UsageError('--sources <file>: a source id appears twice');
  return { input, sources };
}

// The refusals of --out, before anything is fetched or written: a folder git tracks (for a
// folder not yet there, its nearest existing parent folder), and a folder already holding a
// sample.json (a drawn sample is frozen; the owner may already be labelling it).
function checkOut(out: string): void {
  let probe = out;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  if (trackedByGit(probe)) {
    throw new UsageError('--out <folder> holds files tracked by git; a sample of real items never lives in a repository');
  }
  if (fs.existsSync(path.join(out, 'sample.json'))) {
    throw new UsageError('--out <folder> already holds sample.json; a drawn sample is frozen, draw into a new folder');
  }
}

const noneDropped = (): Dropped => ({ no_link: 0, no_time: 0, outside_window: 0, repeated: 0, over_cap: 0, oversized: 0 });

// The keep rules of one source: a link and a publication time inside the window, the first of
// a repeated canonical address, then at most MAX_ITEMS_PER_SOURCE, the newest first and ties in
// feed order.
function keep(entries: FeedEntry[], window: { start: number; end: number }, dropped: Dropped): FeedEntry[] {
  const seen = new Set<string>();
  const candidates: { entry: FeedEntry; at: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const url = canonicalUrl(entry.link);
    const at = entry.published ? Date.parse(entry.published) : Number.NaN;
    if (url === null) dropped.no_link += 1;
    else if (Number.isNaN(at)) dropped.no_time += 1;
    else if (at < window.start || at >= window.end) dropped.outside_window += 1;
    else if (seen.has(url)) dropped.repeated += 1;
    else {
      seen.add(url);
      candidates.push({ entry, at, index });
    }
  });
  candidates.sort((a, b) => b.at - a.at || a.index - b.index);
  dropped.over_cap = Math.max(0, candidates.length - MAX_ITEMS_PER_SOURCE);
  return candidates.slice(0, MAX_ITEMS_PER_SOURCE).map((c) => c.entry);
}

// XML text as measure.ts escapes the hostile fixtures' feed; a C0 control character, which XML
// cannot carry as text, as a character reference the job's parser decodes back.
const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, (c) => `&#x${c.charCodeAt(0).toString(16)};`);

// The drawn entries as a minimal RSS 2.0 body, one item per line.
export function feedBody(name: string, entries: FeedEntry[]): string {
  const items = entries.map((e) => '<item>'
    + `<title>${xml(e.title)}</title>`
    + (e.link !== null ? `<link>${xml(e.link)}</link>` : '')
    + (e.summary !== null ? `<description>${xml(e.summary)}</description>` : '')
    + (e.published !== null ? `<pubDate>${xml(e.published)}</pubDate>` : '')
    + (e.guid !== null ? `<guid isPermaLink="false">${xml(e.guid)}</guid>` : '')
    + '</item>');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${xml(name)}</title>\n${items.join('\n')}\n</channel></rss>`;
}

const sameEntries = (a: FeedEntry[], b: FeedEntry[]) => JSON.stringify(a) === JSON.stringify(b);

async function drawOne(source: DrawSource, window: { start: number; end: number }): Promise<Drawn> {
  const dropped = noneDropped();
  const failed = (reason: string, bytes = 0, entries = 0): Drawn =>
    ({ line: { source_id: source.id, status: 'failed', bytes, entries, kept: 0, dropped, reason }, kept: [] });
  const url = URL.parse(source.feed_url);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return failed('config: the feed address is not an http or https address');
  let body: string;
  try {
    body = (await fetchFeed(source.feed_url, { paced: isArxivSource(source) })).body;
  } catch (error) {
    return failed(error instanceof SourceFailure ? error.message : 'unexpected: the source could not be fetched');
  }
  const bytes = Buffer.byteLength(body, 'utf8');
  let parsed: ReturnType<typeof parseFeedItems>;
  try {
    parsed = parseFeedItems(body);
  } catch (error) {
    return failed(error instanceof SourceFailure ? error.message : 'unexpected: the feed could not be parsed', bytes);
  }
  dropped.oversized = parsed.rejected.length;
  const entries = parsed.entries.length + parsed.rejected.length;
  const kept = keep(parsed.entries, window, dropped);
  if (kept.length === 0) {
    return { line: { source_id: source.id, status: 'excluded', bytes, entries, kept: 0, dropped, reason: 'no item inside the window' }, kept };
  }
  if (!sameEntries(parseFeedItems(feedBody(source.name, kept)).entries, kept)) {
    return failed('reserialise: the saved feed does not parse back to the drawn entries', bytes, entries);
  }
  return { line: { source_id: source.id, status: 'fetched', bytes, entries, kept: kept.length, dropped, reason: null }, kept };
}

// A table cell of the builder's columns: a | written \|, every line break a space.
const cell = (text: string) => text.replace(/\r\n|\r|\n/g, ' ').replace(/\|/g, '\\|');

function labellingTable(sampleId: string, sampleHash: string, window: { start: string; end: string },
  rows: { fixture_id: string; source_id: string; title: string; link: string }[]): string {
  const quoted = (values: readonly string[]) => values.map((v) => `\`${v}\``);
  const or = (values: string[]) => `${values.slice(0, -1).join(', ')} or ${values[values.length - 1]}`;
  return [
    `# Labelling table: sample ${sampleId}, sample.json SHA-256 ${sampleHash}`,
    '',
    `One row per item of sample.json in this folder, in its order: the frozen sample drawn by draw-sample over the ${WINDOW_DAYS} days`
      + ` from ${window.start} to ${window.end}, at most ${MAX_ITEMS_PER_SOURCE} items per source (priitkustala/ai-news#75).`,
    '',
    '## How to fill it',
    '',
    '- Open this file in a text editor, type one value into each of the four label cells of every row, keep the rows, their order'
      + ' and the first four columns as they are, save it, and tell the orchestrator it is done.',
    `- \`ai_relevant\`: ${or(quoted(['true', 'false']))}.`,
    `- \`category\`: ${or(quoted(CATEGORIES))}.`,
    '- `duplicate_group`: empty (no duplicate) or one lower-case name of letters, digits and hyphens, the same name on every row of one story.',
    `- \`importance\`: ${or(quoted(['must-read', 'skip']))}.`,
    '- The first four columns are written by draw-sample and are not edited: a `|` in a title or link is written `\\|`, a line break as a space.',
    '',
    TABLE_HEADER,
    '|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.fixture_id} | ${r.source_id} | ${cell(r.title)} | ${cell(r.link)} |  |  |  |  |`),
    '',
  ].join('\n');
}

const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

export type DrawReport = {
  sample_id: string;
  drawn_at: string;
  window: { start: string; end: string };
  sources: SourceLine[];
  items: number;
  sha256: { 'sample.json': string; 'labels.json': string; 'labelling-table.md': string };
};

export async function drawSample(sourcesFile: string, outFolder: string, log: (line: string) => void): Promise<DrawReport> {
  const { input, sources } = readSources(sourcesFile);
  const out = path.resolve(outFolder);
  checkOut(out);

  // The window: the 7 days ending at the draw's start instant (UTC, whole seconds).
  const end = Math.floor(Date.now() / 1000) * 1000;
  const window = { start: end - WINDOW_DAYS * DAY_MS, end };
  const windowIso = { start: new Date(window.start).toISOString(), end: new Date(window.end).toISOString() };
  const sampleId = `real-${windowIso.end.slice(0, 10)}`;

  // Each source fetched once; a bounded number at a time, the results in input order.
  const drawn: Drawn[] = new Array(sources.length);
  let next = 0;
  const lane = async () => {
    while (next < sources.length) {
      const index = next++;
      drawn[index] = await drawOne(sources[index], window);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DRAW_CONCURRENCY, sources.length) }, lane));
  for (const { line } of drawn) {
    log(`draw-sample: ${line.source_id} ${line.status}, ${line.bytes} bytes, ${line.entries} entries, ${line.kept} kept`
      + `${line.reason ? ` (${line.reason})` : ''}`);
  }

  const withItems = sources.map((source, index) => ({ source, ...drawn[index] })).filter((d) => d.kept.length > 0);
  if (withItems.length === 0) throw new MeasureError('no source has an item inside the window; nothing is written');

  const sample = {
    _comment: `A frozen validation sample drawn by draw-sample (priitkustala/ai-news#75; Locked B-25): the ${WINDOW_DAYS}-day window ending at`
      + ` the draw, at most ${MAX_ITEMS_PER_SOURCE} items per source, newest first. Each source's feed is its drawn entries written back as`
      + ' a minimal RSS 2.0 body, not the publisher\'s bytes. It holds real items: it never enters a repository.',
    sample_id: sampleId,
    drawn_at: windowIso.end,
    window: windowIso,
    max_items_per_source: MAX_ITEMS_PER_SOURCE,
    sources: withItems.map(({ source, kept }) => ({
      id: source.id,
      name: source.name,
      source_type: source.source_type,
      default_categories: source.default_categories,
      display_policy: source.display_policy,
      source_weight: source.source_weight,
      drawn_from: source.feed_url,
      feed: feedBody(source.name, kept).split('\n'),
    })),
    excluded: drawn.filter((d) => d.line.status !== 'fetched').map((d) => ({ source_id: d.line.source_id, reason: d.line.reason })),
  };
  const items = withItems.flatMap(({ source, kept }) => kept.map((entry, n) => ({
    fixture_id: `${source.id}-${String(n + 1).padStart(4, '0')}`,
    source_id: source.id,
    title: entry.title,
    link: entry.link as string,
  })));
  const labels = {
    _comment: 'Labels of the drawn sample (sample.json, same folder), one per item, joined to the item by its link. UNLABELLED: the owner'
      + ' fills labelling-table.md; the labels are read back from it by a later item (priitkustala/ai-news#76).',
    sample_id: sampleId,
    label_origin: 'unlabelled',
    items: items.map(({ fixture_id, source_id, link }) => ({ fixture_id, source_id, link, labels: {} })),
  };

  const sampleText = `${JSON.stringify(sample, null, 2)}\n`;
  const labelsText = `${JSON.stringify(labels, null, 2)}\n`;
  const sampleHash = sha256(sampleText);
  const tableText = labellingTable(sampleId, sampleHash, windowIso, items);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'sources.json'), input);
  fs.writeFileSync(path.join(out, 'labels.json'), labelsText);
  fs.writeFileSync(path.join(out, 'labelling-table.md'), tableText);
  fs.writeFileSync(path.join(out, 'sample.json'), sampleText);
  log(`draw-sample: sample ${sampleId}: ${withItems.length} of ${sources.length} sources with items, ${items.length} items`);

  return {
    sample_id: sampleId,
    drawn_at: windowIso.end,
    window: windowIso,
    sources: drawn.map((d) => d.line),
    items: items.length,
    sha256: { 'sample.json': sampleHash, 'labels.json': sha256(labelsText), 'labelling-table.md': sha256(tableText) },
  };
}
