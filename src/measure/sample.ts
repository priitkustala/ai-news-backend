// The frozen validation sample of the measure command (priitkustala/ai-news-backend#4, S-06;
// Locked B-25, AC-25): `fixtures/validation-sample/sample.json` holds the sample (the window,
// the per-source cap, each source's configuration and its saved feed body), `labels.json`
// beside it one label record per sample item, and `fixtures/validation/hostile.json` the
// seeded injection and malformed fixtures. The sample and the labels are two files so that the
// labels can be replaced (the owner's labels) without changing the sample. `measure
// --sample-dir <folder>` (priitkustala/ai-news#75) reads the two files from a folder that no
// repository tracks instead, a real sample drawn by `draw-sample` (src/measure/draw.ts); the
// hostile fixtures stay the committed ones. The fixture records
// are read as they are and validated per record (src/measure/schema.ts); only a sample that
// cannot be measured at all (a file missing or not JSON, a source without a feed, an item
// outside the window or over the cap, an item without a label) stops the command.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repositoryRoot, UsageError } from '../env.js';
import { readSourceRecords, SourceRecordError } from '../sources/record.js';

export const SAMPLE_FILE = path.join(repositoryRoot, 'fixtures', 'validation-sample', 'sample.json');
export const LABELS_FILE = path.join(repositoryRoot, 'fixtures', 'validation-sample', 'labels.json');
export const HOSTILE_FILE = path.join(repositoryRoot, 'fixtures', 'validation', 'hostile.json');

// A sample the command cannot measure; reported as one line on standard error, exit 1.
export class MeasureError extends Error {}

export type SampleSource = {
  id: string;
  source_type: string;
  display_policy: string;
  default_categories: string[];
  source_weight: number;
  feed: string;
};

export type Sample = {
  sample_id: string;
  window: { start: number; end: number };
  max_items_per_source: number;
  sources: SampleSource[];
};

// A fixture record as its file holds it: validated per record, never trusted.
export type RawRecord = Record<string, unknown>;

export type Labels = { label_origin: string; records: RawRecord[] };

// A file of the repository by its repository path, a file elsewhere (a --sample-dir folder) by its own.
const relative = (file: string) => {
  const inside = path.relative(repositoryRoot, file);
  return inside.startsWith('..') || path.isAbsolute(inside) ? file : inside;
};

// Whether git tracks a file in `folder` (git -C <folder> ls-files prints a path). A folder in
// no repository (git exits non-zero) and an ignored folder in one print nothing: not tracked.
export function trackedByGit(folder: string): boolean {
  const result = spawnSync('git', ['-C', folder, 'ls-files'], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim() !== '';
}

// The two files of a --sample-dir folder (#75), after the refusal of a folder git tracks: a
// sample of real items never lives in a repository (Locked OD-23, R-21).
export function sampleFolder(folder: string): { sample: string; labels: string } {
  const dir = path.resolve(folder);
  if (trackedByGit(dir)) {
    throw new UsageError('--sample-dir <folder> holds files tracked by git; a sample of real items never lives in a repository');
  }
  return { sample: path.join(dir, 'sample.json'), labels: path.join(dir, 'labels.json') };
}

function readJson(file: string): Record<string, unknown> {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new MeasureError(`${relative(file)} cannot be read`);
  }
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // reported below
  }
  throw new MeasureError(`${relative(file)} is not a JSON object`);
}

const records = (value: unknown): RawRecord[] =>
  (Array.isArray(value) ? value : []).map((entry) => (entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as RawRecord : {}));

const time = (value: unknown): number => (typeof value === 'string' ? Date.parse(value) : Number.NaN);

export function readSample(file: string = SAMPLE_FILE): Sample {
  const raw = readJson(file);
  const window = (raw.window ?? {}) as Record<string, unknown>;
  const start = time(window.start);
  const end = time(window.end);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) throw new MeasureError('sample.json: window needs a start before its end');
  const max = raw.max_items_per_source;
  if (typeof max !== 'number' || !Number.isInteger(max) || max < 1) throw new MeasureError('sample.json: max_items_per_source must be a positive whole number');
  let read: ReturnType<typeof readSourceRecords>;
  try {
    read = readSourceRecords(records(raw.sources), 'sample');
  } catch (error) {
    if (error instanceof SourceRecordError) throw new MeasureError(`sample.json: ${error.message}`);
    throw error;
  }
  const sources = read.map((s): SampleSource => ({
    id: s.id,
    source_type: s.source_type,
    display_policy: s.display_policy,
    default_categories: s.default_categories,
    source_weight: s.source_weight,
    feed: (s.feed as string[]).join('\n'),
  }));
  if (sources.length === 0) throw new MeasureError('sample.json: the sample has no source');
  return { sample_id: String(raw.sample_id ?? ''), window: { start, end }, max_items_per_source: max, sources };
}

export function readLabels(file: string = LABELS_FILE): Labels {
  const raw = readJson(file);
  return { label_origin: typeof raw.label_origin === 'string' ? raw.label_origin : 'unknown', records: records(raw.items) };
}

export function readHostile(): RawRecord[] {
  return records(readJson(HOSTILE_FILE).fixtures);
}

// The AC-25 fixture manifest (src/seed-data.ts): every fixture record of the set, the labelled
// sample items and the hostile fixtures, and the sources of the sample.
export function fixtureManifest(): { fixture_ids: string[]; source_ids: string[] } {
  return {
    fixture_ids: [...readLabels().records, ...readHostile()].map((record) => String(record.fixture_id)),
    source_ids: readSample().sources.map((source) => source.id),
  };
}
