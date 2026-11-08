// AC-2e (script, @surface-job, project api): item priitkustala/ai-news#75 (SI-3a), row AC-2e.
// Source: the item's worked example (refuse or report before labelling) and its approved settlement,
// read-me-first 7 and points 7 and 8.
// Given a synthetic sources file on the fixture feed server, when draw-sample draws a folder outside the
// repository and the measure command runs with --sample-dir on that unlabelled folder, then measure exits 0
// with label_origin unlabelled, no record is scored, and every share that needs a label is unavailable with
// its reason (the other-share and summary-presence values need no label and keep their shape).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { drawSample, measure } from '../../support/job';

// The synthetic sources of the settlement's point 8, on the fixture feed server.
function syntheticSources(run: string, now: number) {
  const base = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a feed address of the fixture feed server')).origin;
  const at = (agoMs: number) => new Date(now - agoMs).toISOString();
  const source = (id: string, feedUrl: string, categories: string[]) =>
    ({ id, name: `${id} (fixture)`, feed_url: feedUrl, source_type: 'feed', default_categories: categories, display_policy: 'feed-summary', source_weight: 1 });
  return {
    sources: [
      source('fixture-openai', `${base}/feeds/openai-news.xml?run=${run}&at=${at(3600_000)}`, ['releases']),
      source('fixture-old', `${base}/feeds/techcrunch-ai.xml?run=${run}&at=${at(10 * 86400_000)}`, ['business']),
      source('fixture-many', `${base}/feeds/draw-25-items.xml?run=${run}&at=${at(2 * 3600_000)}`, ['releases']),
      source('fixture-failing', `${base}/status/500/fixture-failing`, []),
    ],
  };
}

const LABELLED_SHARES = ['relevance_precision', 'relevance_recall', 'category_accuracy', 'duplicate_precision', 'duplicate_recall',
  'top_n_must_read_share', 'top_n_skip_share'];

const isUnavailable = (value: unknown) => {
  const v = value as Record<string, unknown> | null;
  return v !== null && typeof v === 'object' && v.value === null && typeof v.unavailable_reason === 'string' && v.unavailable_reason !== '';
};
const shareOk = (value: unknown) => (typeof value === 'number' ? value >= 0 && value <= 1 : isUnavailable(value));

test(
  'AC-2e: measure on an unlabelled drawn folder reports every label share unavailable and does not refuse',
  { tag: ['@journey-measure', '@surface-job', '@story-75'] },
  async ({}) => {
    // Given: a synthetic sources file in a fresh folder outside the repository
    const run = runMarker();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ai-news-75-${run}-`));
    const sourcesFile = path.join(dir, 'sources-input.json');
    fs.writeFileSync(sourcesFile, `${JSON.stringify(syntheticSources(run, Date.now()), null, 2)}\n`);
    const out = path.join(dir, 'sample');

    // When: draw-sample draws the folder, and measure runs with --sample-dir on it, unlabelled
    const draw = drawSample(['--sources', sourcesFile, '--out', out]);
    const result = measure(['--sample-dir', out]);

    // Then: the draw wrote an unlabelled labels.json; measure exits 0 on it, scores no record, and every
    // share that needs a label is unavailable with its reason
    expect(draw.exitCode, draw.stderr).toBe(0);
    const labels = JSON.parse(fs.readFileSync(path.join(out, 'labels.json'), 'utf8')) as { label_origin: string; items: { labels: object }[] };
    expect(labels.label_origin).toBe('unlabelled');
    expect(labels.items.length, 'the drawn folder has items').toBeGreaterThan(0);
    for (const item of labels.items) expect(item.labels).toEqual({});

    expect(result.exitCode, result.stderr).toBe(0);
    const report = result.report ?? {};
    expect(report.label_origin).toBe('unlabelled');
    expect((report.counts as Record<string, unknown> | undefined)?.scored_items).toBe(0);
    for (const metric of LABELLED_SHARES) expect(isUnavailable(report[metric]), `${metric} is unavailable with a reason`).toBe(true);
    for (const [category, value] of Object.entries((report.category_accuracy_per_category ?? {}) as Record<string, unknown>)) {
      expect(isUnavailable(value), `category_accuracy_per_category.${category}`).toBe(true);
    }
    expect(shareOk(report.other_share), 'other_share keeps its shape').toBe(true);
    for (const [source, value] of Object.entries((report.summary_presence_per_source ?? {}) as Record<string, unknown>)) {
      expect(shareOk(value), `summary_presence_per_source.${source}`).toBe(true);
    }
  },
);
