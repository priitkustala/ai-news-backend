// The measure command (priitkustala/ai-news-backend#4, S-06; Locked AC-25, B-25, W4 section 8):
// runs the deterministic pipeline of main on the frozen validation sample and prints each
// metric as a value. The saved feed of each sample source is parsed by the collect module's
// parser (the sample is saved feeds, so nothing is fetched), its entries are processed by the
// process modules as a run processes them (src/ingest/process.ts: canonical address,
// relevance, category), and the kept items are clustered as src/process/apply.ts clusters
// them. The seeded hostile fixtures go through the same steps as items of a feed of their own.
// No verdict, bar or weight: OD-26 is open, so the report holds values only. Prints no item
// text (Locked R-21): ids, counts and shares.
import { parseFeed, type FeedEntry } from '../collect/parse.js';
import { SourceFailure } from '../collect/fetch.js';
import { processEntries, type ItemToStore, type ProcessSource } from '../ingest/process.js';
import { canonicalUrl, clusterItems } from '../process/dedupe.js';
import { CATEGORIES, type Category } from '../process/category-rules.js';
import { entryErrors, inputErrors, itemErrors, labelErrors, type RecordKind } from './schema.js';
import { MeasureError, readHostile, readLabels, readSample, type RawRecord, type Sample, type SampleSource } from './sample.js';

export type Unavailable = { value: null; unavailable_reason: string };
export type Share = number | Unavailable;

const unavailable = (reason: string): Unavailable => ({ value: null, unavailable_reason: reason });
const share = (count: number, of: number, reason: string): Share => (of > 0 ? count / of : unavailable(reason));

// The outcome of one fixture record: the entry the collect step read for it and the item the
// process step kept (null when the item was not kept).
export type Outcome = 'kept' | 'not-relevant' | 'dropped' | 'not-in-sample';
export type Fixture = {
  record: RawRecord;
  kind: RecordKind;
  source_id: string;
  outcome: Outcome;
  entry: FeedEntry | null;
  item: ItemToStore | null;
  cluster_id: string | null;
};

export type Labelled = { ai_relevant: boolean; category: Category; duplicate_group: string | null };

// The labels of a record that passed labelErrors (src/measure/schema.ts).
const labelsOf = (record: RawRecord): Labelled => {
  const labels = record.labels as Record<string, unknown>;
  return { ai_relevant: labels.ai_relevant as boolean, category: labels.category as Category, duplicate_group: (labels.duplicate_group as string | undefined) ?? null };
};

// The schema validation of one fixture record and the record it yields (src/measure/schema.ts).
function validate(f: Fixture, duplicateIds: Set<string>) {
  const schemaErrors = [
    ...inputErrors(f.record, f.kind, duplicateIds.has(String(f.record.fixture_id))),
    ...entryErrors(f.entry),
    ...(f.item ? itemErrors(f.item, f.source_id) : []),
  ];
  const labelErrorList = labelErrors(f.record, f.item);
  return { schema_valid: schemaErrors.length === 0, labels_from_fixed_lists: labelErrorList.length === 0, errors: [...schemaErrors, ...labelErrorList] };
}

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The hostile fixtures' source: a general feed source with the fixture sources' configuration
// of the seed (src/seed-data.ts, source(): feed-summary, no default category, weight 1).
const hostileSource = (id: string): ProcessSource & { source_weight: number } =>
  ({ id, source_type: 'feed', display_policy: 'feed-summary', default_categories: [], source_weight: 1 });

// A hostile fixture as the item of an RSS feed: its title and summary as the feed's text
// (escaped, so the parser returns them as written), a link of its own on a fixture host, and
// the last hour of the window as its publication time.
export function hostileLink(fixtureId: unknown): string {
  return `https://hostile.example.com/ai-news-fixture/${encodeURIComponent(String(fixtureId))}`;
}

function hostileFeed(fixtures: RawRecord[], at: Date): string {
  const items = fixtures.map((f) => '<item>'
    + `<title>${typeof f.title === 'string' ? xml(f.title) : ''}</title>`
    + `<link>${xml(hostileLink(f.fixture_id))}</link>`
    + (typeof f.summary === 'string' ? `<description>${xml(f.summary)}</description>` : '')
    + `<pubDate>${at.toUTCString()}</pubDate></item>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Hostile fixtures</title>\n${items.join('\n')}\n</channel></rss>\n`;
}

type Processed = { source: SampleSource | ReturnType<typeof hostileSource>; entries: FeedEntry[]; items: ItemToStore[] };

function run(source: Processed['source'], body: string): Processed {
  let entries: FeedEntry[];
  try {
    entries = parseFeed(body);
  } catch (error) {
    throw new MeasureError(`the saved feed of ${source.id} cannot be parsed (${error instanceof SourceFailure ? error.kind : 'unexpected'})`);
  }
  return { source, entries, items: processEntries(source, entries).items };
}

function outcomeOf(link: string | null, processed: Processed | undefined): Pick<Fixture, 'outcome' | 'entry' | 'item'> {
  const url = canonicalUrl(link);
  const entry = processed?.entries.find((e) => url !== null && canonicalUrl(e.link) === url) ?? null;
  if (!processed || !entry) return { outcome: 'not-in-sample', entry: null, item: null };
  const item = processed.items.find((i) => i.canonical_url === url) ?? null;
  if (item) return { outcome: 'kept', entry, item };
  return { outcome: entry.title ? 'not-relevant' : 'dropped', entry, item: null };
}

// Checks the sample's own shape (B-25): every item inside the window, at most the cap per
// source, and one label for every item.
function checkSample(sample: Sample, processed: Processed[], labels: RawRecord[]): void {
  const labelled = new Set(labels.map((record) => canonicalUrl(typeof record.link === 'string' ? record.link : null)));
  for (const { source, entries } of processed) {
    if (entries.length > sample.max_items_per_source) {
      throw new MeasureError(`source ${source.id} has ${entries.length} items, over the cap of ${sample.max_items_per_source}`);
    }
    for (const [index, entry] of entries.entries()) {
      const at = entry.published ? Date.parse(entry.published) : Number.NaN;
      if (Number.isNaN(at) || at < sample.window.start || at >= sample.window.end) {
        throw new MeasureError(`item ${index + 1} of source ${source.id} is not published inside the sample window`);
      }
      if (!labelled.has(canonicalUrl(entry.link))) throw new MeasureError(`item ${index + 1} of source ${source.id} has no label`);
    }
  }
}

export type MeasureReport = Record<string, unknown>;

export function measure(log: (line: string) => void): MeasureReport {
  const sample = readSample();
  const labels = readLabels();
  const hostile = readHostile();

  // collect (parse the saved feeds) and process, source by source
  const processed = sample.sources.map((source) => run(source, source.feed));
  checkSample(sample, processed, labels.records);
  const bySource = new Map(processed.map((p) => [p.source.id, p]));
  const sampleFixtures: Fixture[] = labels.records.map((record) => {
    const sourceId = String(record.source_id ?? '');
    return { record, kind: 'sample' as const, source_id: sourceId, cluster_id: null, ...outcomeOf(typeof record.link === 'string' ? record.link : null, bySource.get(sourceId)) };
  });

  const hostileAt = new Date(sample.window.end - 3600 * 1000);
  const hostileIds = [...new Set(hostile.map((f) => (typeof f.source_id === 'string' && f.source_id !== '' ? f.source_id : 'fixture-hostile')))];
  const hostileFixtures: Fixture[] = hostileIds.flatMap((id) => {
    const own = hostile.filter((f) => (typeof f.source_id === 'string' && f.source_id !== '' ? f.source_id : 'fixture-hostile') === id);
    const result = run(hostileSource(id), hostileFeed(own, hostileAt));
    return own.map((record) => ({ record, kind: 'hostile' as const, source_id: id, cluster_id: null, ...outcomeOf(hostileLink(record.fixture_id), result) }));
  });

  // the duplicate clusters of the kept sample items (src/process/apply.ts: the publication
  // time, or the fetch time when the feed gave none; the sample's fetch time is its window end)
  const kept = sampleFixtures.filter((f) => f.item !== null);
  const weight = new Map(sample.sources.map((s) => [s.id, s.source_weight]));
  const marks = clusterItems(kept.map((f) => ({
    id: f.item!.id,
    canonical_url: f.item!.canonical_url,
    title: f.item!.title,
    source_weight: weight.get(f.item!.source_id) ?? 0,
    time: f.item!.published_at ? Date.parse(f.item!.published_at) : sample.window.end,
  })));
  for (const f of kept) f.cluster_id = marks.get(f.item!.id)!.cluster_id;

  // every fixture record validated; the metrics count the sample records that pass both checks
  const fixtures = [...sampleFixtures, ...hostileFixtures];
  const seen = new Map<string, number>();
  for (const f of fixtures) seen.set(String(f.record.fixture_id), (seen.get(String(f.record.fixture_id)) ?? 0) + 1);
  const duplicateIds = new Set([...seen].filter(([, count]) => count > 1).map(([id]) => id));
  const checks = new Map(fixtures.map((f) => [f, validate(f, duplicateIds)]));
  const scored = sampleFixtures.filter((f) => checks.get(f)!.schema_valid && checks.get(f)!.labels_from_fixed_lists)
    .map((f) => ({ ...f, labels: labelsOf(f.record) }));
  const keptScored = scored.filter((f) => f.item !== null);
  const relevant = scored.filter((f) => f.labels!.ai_relevant);
  const keptRelevant = keptScored.filter((f) => f.labels!.ai_relevant);
  const categoryRight = keptRelevant.filter((f) => f.item!.category === f.labels!.category);

  const perCategory = Object.fromEntries(CATEGORIES.map((category) => {
    const own = keptRelevant.filter((f) => f.labels!.category === category);
    return [category, share(own.filter((f) => f.item!.category === category).length, own.length,
      `no AI-relevant item of the sample labelled ${category} is kept by the pipeline`)];
  }));

  const representatives = kept.filter((f) => marks.get(f.item!.id)!.is_representative);
  const otherRepresentatives = representatives.filter((f) => f.item!.category === 'other');

  // duplicate pairs among the kept, labelled items: predicted (one cluster) and labelled (one duplicate group)
  const pairs = { predicted: 0, labelled: 0, both: 0 };
  for (let i = 0; i < keptScored.length; i += 1) {
    for (let j = i + 1; j < keptScored.length; j += 1) {
      const a = keptScored[i];
      const b = keptScored[j];
      const predicted = a.cluster_id === b.cluster_id;
      const labelled = a.labels!.duplicate_group !== null && a.labels!.duplicate_group === b.labels!.duplicate_group;
      if (predicted) pairs.predicted += 1;
      if (labelled) pairs.labelled += 1;
      if (predicted && labelled) pairs.both += 1;
    }
  }

  const summaryPresence = Object.fromEntries(sample.sources.map((source) => {
    const own = kept.filter((f) => f.item!.source_id === source.id);
    return [source.id, share(own.filter((f) => f.item!.summary !== null).length, own.length, `no item of ${source.id} is kept by the pipeline`)];
  }));

  const invalid = fixtures.filter((f) => !checks.get(f)!.schema_valid || !checks.get(f)!.labels_from_fixed_lists).length;
  log(`measure: sample ${sample.sample_id}: ${sample.sources.length} sources, ${sampleFixtures.length} labelled items, `
    + `${kept.length} kept, ${representatives.length} clusters; ${hostileFixtures.length} hostile fixtures; label origin ${labels.label_origin}; ${invalid} fixture records fail validation`);
  if (labels.label_origin !== 'owner') log('measure: the labels are not the owner\'s labels: the values do not claim feed quality');

  const TOP_N = 'the sample carries no must-read or skip label (B-25: the owner labels importance; the fixture labels carry relevance, '
    + 'category and duplicates only), and N and the ranking weights are not set (OD-26 open)';
  return {
    sample_id: sample.sample_id,
    label_origin: labels.label_origin,
    window: { start: new Date(sample.window.start).toISOString(), end: new Date(sample.window.end).toISOString() },
    verdict: null,
    relevance_precision: share(keptRelevant.length, keptScored.length, 'the pipeline keeps no labelled item of the sample'),
    relevance_recall: share(keptRelevant.length, relevant.length, 'no item of the sample is labelled AI-relevant'),
    category_accuracy: share(categoryRight.length, keptRelevant.length, 'no AI-relevant item of the sample is kept by the pipeline'),
    other_share: share(otherRepresentatives.length, representatives.length, 'the pipeline keeps no item of the sample'),
    duplicate_precision: share(pairs.both, pairs.predicted, 'the pipeline puts no two kept items of the sample in one cluster'),
    duplicate_recall: share(pairs.both, pairs.labelled, 'the sample has no labelled duplicate pair among the kept items'),
    top_n_must_read_share: unavailable(TOP_N),
    top_n_skip_share: unavailable(TOP_N),
    category_accuracy_per_category: perCategory,
    summary_presence_per_source: summaryPresence,
    counts: {
      sources: sample.sources.length,
      sample_items: sampleFixtures.length,
      scored_items: scored.length,
      labelled_relevant: relevant.length,
      kept: keptScored.length,
      kept_relevant: keptRelevant.length,
      category_right: categoryRight.length,
      clusters: representatives.length,
      clusters_in_other: otherRepresentatives.length,
      duplicate_pairs_predicted: pairs.predicted,
      duplicate_pairs_labelled: pairs.labelled,
      duplicate_pairs_both: pairs.both,
      hostile_fixtures: hostileFixtures.length,
      fixtures_failing_validation: invalid,
    },
    fixtures: fixtures.map((f) => ({
      fixture_id: String(f.record.fixture_id),
      source_id: f.source_id,
      outcome: f.outcome,
      relevance_method: f.item?.relevance_method ?? null,
      category: f.item?.category ?? null,
      category_method: f.item?.category_method ?? null,
      cluster_id: f.cluster_id,
      schema_valid: checks.get(f)!.schema_valid,
      labels_from_fixed_lists: checks.get(f)!.labels_from_fixed_lists,
      ...(checks.get(f)!.errors.length > 0 ? { errors: checks.get(f)!.errors } : {}),
    })),
  };
}
