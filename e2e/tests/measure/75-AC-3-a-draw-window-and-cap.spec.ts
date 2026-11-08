// AC-3a (script, @surface-job, project api): item priitkustala/ai-news#75 (SI-3a), row AC-3a.
// Source: the item's AC-3 and its approved settlement, points 5, 7 and 8.
// Given a synthetic sources file on the fixture feed server (one source inside the window, one only older
// than it, one with 25 items, one answering HTTP 500), when draw-sample draws a folder outside the
// repository, then the window is the 7 days ending at the draw, the 25-item source keeps 20 (the first 20
// in feed order, as their times tie), the old source is excluded, the failing source failed, the files of
// the folder hold the drawn items with fixture ids <source id>-<NNNN>, and measure on the folder exits 0.
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

type SourceLine = { source_id: string; status: string; bytes: number; entries: number; kept: number; dropped: Record<string, number>; reason: string | null };

test(
  'AC-3a: draw-sample draws a 7-day window ending at the draw, at most 20 items per source, excluded and failed sources listed',
  { tag: ['@journey-measure', '@surface-job', '@story-75'] },
  async ({}) => {
    // Given: a synthetic sources file in a fresh folder outside the repository
    const run = runMarker();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ai-news-75-${run}-`));
    const sourcesFile = path.join(dir, 'sources-input.json');
    const input = syntheticSources(run, Date.now());
    fs.writeFileSync(sourcesFile, `${JSON.stringify(input, null, 2)}\n`);
    const out = path.join(dir, 'sample');

    // When: draw-sample draws the folder
    const before = Math.floor(Date.now() / 1000) * 1000;
    const draw = drawSample(['--sources', sourcesFile, '--out', out]);
    const after = Date.now();

    // Then: the window, the cap and the per-source lines hold, and the folder is measurable
    expect(draw.exitCode, draw.stderr).toBe(0);
    const report = draw.report ?? {};
    const window = (report.window ?? {}) as { start?: string; end?: string };
    const start = Date.parse(String(window.start));
    const end = Date.parse(String(window.end));
    expect(end - start, 'the window is 7 days').toBe(7 * 86400_000);
    expect(end, 'the window ends at the draw').toBeGreaterThanOrEqual(before);
    expect(end, 'the window ends at the draw').toBeLessThanOrEqual(after);

    const lines = (Array.isArray(report.sources) ? report.sources : []) as SourceLine[];
    expect(lines.map((l) => l.source_id).sort(), 'one line per source of the input').toEqual(input.sources.map((s) => s.id).sort());
    const line = (id: string) => lines.find((l) => l.source_id === id)!;
    expect(line('fixture-openai')).toMatchObject({ status: 'fetched', entries: 1, kept: 1 });
    expect(line('fixture-many')).toMatchObject({ status: 'fetched', entries: 25, kept: 20 });
    expect(line('fixture-many').dropped.over_cap, 'five over the cap').toBe(5);
    expect(line('fixture-old')).toMatchObject({ status: 'excluded', kept: 0, reason: 'no item inside the window' });
    expect(line('fixture-old').dropped.outside_window).toBe(2);
    expect(line('fixture-failing')).toMatchObject({ status: 'failed', kept: 0, bytes: 0 });
    expect(String(line('fixture-failing').reason)).toContain('http-500');
    for (const l of lines.filter((x) => x.status !== 'failed')) expect(l.bytes, `${l.source_id} bytes`).toBeGreaterThan(0);
    expect(report.items).toBe(21);

    const sample = JSON.parse(fs.readFileSync(path.join(out, 'sample.json'), 'utf8')) as Record<string, unknown>;
    expect(sample.max_items_per_source).toBe(20);
    expect(sample.window).toEqual(report.window);
    expect(sample.sample_id).toBe(report.sample_id);
    const sampleSources = sample.sources as { id: string; feed: string[]; drawn_from: string }[];
    expect(sampleSources.map((s) => s.id)).toEqual(['fixture-openai', 'fixture-many']);
    expect(sampleSources.map((s) => s.feed.join('\n').split('<item>').length - 1)).toEqual([1, 20]);
    expect((sample.excluded as { source_id: string }[]).map((e) => e.source_id).sort()).toEqual(['fixture-failing', 'fixture-old']);

    const labels = JSON.parse(fs.readFileSync(path.join(out, 'labels.json'), 'utf8')) as { items: { fixture_id: string; source_id: string; link: string }[] };
    const many = labels.items.filter((i) => i.source_id === 'fixture-many');
    expect(many.map((i) => i.fixture_id)).toEqual(Array.from({ length: 20 }, (_, n) => `fixture-many-${String(n + 1).padStart(4, '0')}`));
    expect(many.map((i) => i.link), 'ties keep the feed order').toEqual(
      Array.from({ length: 20 }, (_, n) => `https://draw.example.com/ai-news-fixture/${run}-item-${String(n + 1).padStart(2, '0')}`));
    expect(labels.items.filter((i) => i.source_id === 'fixture-openai').map((i) => i.fixture_id)).toEqual(['fixture-openai-0001']);
    expect(JSON.parse(fs.readFileSync(path.join(out, 'sources.json'), 'utf8'))).toEqual(input);

    const measured = measure(['--sample-dir', out]);
    expect(measured.exitCode, measured.stderr).toBe(0);
    expect(measured.report?.sample_id).toBe(report.sample_id);
  },
);
