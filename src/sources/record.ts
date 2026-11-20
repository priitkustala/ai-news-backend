// The one reader of a source record (priitkustala/ai-news-backend#95): the measure sample
// (src/measure/sample.ts), the sources file of draw-sample and seed-sources (src/measure/draw.ts)
// and the fixture sources of the seed (src/seed.ts) read the common fields of a source here, each
// with its own feed envelope: the sample a saved feed (`feed`, an array of text lines), the
// sources file and the seed a `feed_url`. A present field of the wrong type is refused with an
// error naming the field and the source id, never the value; an absent optional field reads as
// the one default the sources table gives it: db/migrations/0001_exposed_schema.sql lines 31
// (source_type feed), 32 (community, nullable), 33 (default_categories empty), 34 (source_weight
// 1), 35 (image_policy placeholder) and 37 (display_policy title-link), and
// db/migrations/0018_source_runner.sql line 20 (runner cloud). Values are only type-checked: a
// text outside the table's check (config/sources.json uses the source_type page) passes.
import { isRunner, RUNNERS, type Runner } from '../ingest/ingest.js';

// A malformed source record; each caller reports it in its own error form.
export class SourceRecordError extends Error {}

export type SourceRecord = {
  id: string;
  name: string;
  source_type: string;
  display_policy: string;
  default_categories: string[];
  source_weight: number;
  runner: Runner;
  community: string | null;
  image_policy: string;
  // The saved feed lines of a sample source; null for the other envelopes.
  feed: string[] | null;
  // The feed address of a sources-file or seed source; null for a sample source.
  feed_url: string | null;
};

export type SourceEnvelope = 'sample' | 'sources-file' | 'seed';

const SOURCES_FILE_ID = /^[a-z0-9][a-z0-9-]*$/;

const isText = (value: unknown): value is string => typeof value === 'string';

export function readSourceRecord(entry: unknown, index: number, envelope: SourceEnvelope): SourceRecord {
  const s = (entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}) as Record<string, unknown>;
  const n = index + 1;
  if (envelope === 'sources-file') {
    if (!isText(s.id) || !SOURCES_FILE_ID.test(s.id)) throw new SourceRecordError(`source ${n} needs an id of lower-case letters, digits and hyphens`);
  } else if (!isText(s.id) || s.id === '') {
    throw new SourceRecordError(`source ${n} has no id`);
  }
  const id = s.id;
  if (envelope === 'sample') {
    if (!Array.isArray(s.feed) || !s.feed.every(isText)) throw new SourceRecordError(`source ${id} has no saved feed`);
  } else if (!isText(s.feed_url) || s.feed_url === '') {
    throw new SourceRecordError(`source ${id} has no feed_url`);
  }
  if (s.runner !== undefined && !isRunner(s.runner)) throw new SourceRecordError(`source ${id} has a runner other than ${RUNNERS.join(' or ')}`);
  for (const field of ['name', 'source_type', 'display_policy', 'image_policy'] as const) {
    if (s[field] !== undefined && !isText(s[field])) throw new SourceRecordError(`source ${id}: ${field} must be text`);
  }
  if (s.default_categories !== undefined && !(Array.isArray(s.default_categories) && s.default_categories.every(isText))) {
    throw new SourceRecordError(`source ${id}: default_categories must be a list of text`);
  }
  if (s.source_weight !== undefined && typeof s.source_weight !== 'number') throw new SourceRecordError(`source ${id}: source_weight must be a number`);
  if (s.community !== undefined && s.community !== null && !isText(s.community)) throw new SourceRecordError(`source ${id}: community must be text`);
  return {
    id,
    // The table has no default for name (not null); the id is the name a source without one shows.
    name: (s.name as string | undefined) ?? id,
    // The table's default source type (0001 line 31).
    source_type: (s.source_type as string | undefined) ?? 'feed',
    // The table's default display policy (0001 line 37): the title and link only.
    display_policy: (s.display_policy as string | undefined) ?? 'title-link',
    // The table's default categories (0001 line 33): none, the rules alone decide.
    default_categories: (s.default_categories as string[] | undefined) ?? [],
    // The table's default weight (0001 line 34).
    source_weight: (s.source_weight as number | undefined) ?? 1,
    // The table's default runner (0018 line 20).
    runner: (s.runner as Runner | undefined) ?? 'cloud',
    // The table's community is nullable with no default (0001 line 32): none, a source that is not Reddit.
    community: (s.community as string | null | undefined) ?? null,
    // The table's default image policy (0001 line 35): no image is shown from the source.
    image_policy: (s.image_policy as string | undefined) ?? 'placeholder',
    feed: envelope === 'sample' ? [...(s.feed as string[])] : null,
    feed_url: envelope === 'sample' ? null : (s.feed_url as string),
  };
}

export function readSourceRecords(list: readonly unknown[], envelope: SourceEnvelope): SourceRecord[] {
  const sources = list.map((entry, index) => readSourceRecord(entry, index, envelope));
  if (new Set(sources.map((s) => s.id)).size !== sources.length) throw new SourceRecordError('a source id appears twice');
  return sources;
}
