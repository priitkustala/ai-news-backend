// AC-4a (script, @surface-job, project api): item priitkustala/ai-news#75 (SI-3a), row AC-4a.
// Source: the item's Scope (the labelling table) and AC-4, and its approved settlement, points 5 and 7.
// Given a synthetic sources file on the fixture feed server, when draw-sample draws a folder outside the
// repository, then labelling-table.md names the sample id and the SHA-256 of sample.json, its legend lists
// the fixed values of the four label columns, its header row is exactly the eight columns, it has one row
// per item of sample.json in order with every fixture_id once and every label cell empty, a | in a title is
// written \| and a title's line break is a space on one row.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { requireEnv, runMarker } from '../../support/env';
import { drawSample } from '../../support/job';

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

const HEADER = '| fixture_id | source_id | title | link | ai_relevant | category | duplicate_group | importance |';
// The cells of a table row: split on every | that is not written \|.
const cells = (row: string) => row.trim().slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim());

test(
  'AC-4a: draw-sample writes the labelling table with the exact header, one row per item and empty label cells',
  { tag: ['@journey-measure', '@surface-job', '@story-75'] },
  async ({}) => {
    // Given: a synthetic sources file in a fresh folder outside the repository
    const run = runMarker();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ai-news-75-${run}-`));
    const sourcesFile = path.join(dir, 'sources-input.json');
    fs.writeFileSync(sourcesFile, `${JSON.stringify(syntheticSources(run, Date.now()), null, 2)}\n`);
    const out = path.join(dir, 'sample');

    // When: draw-sample draws the folder
    const draw = drawSample(['--sources', sourcesFile, '--out', out]);

    // Then: the table's heading, legend, header, rows and cells hold
    expect(draw.exitCode, draw.stderr).toBe(0);
    const sampleBytes = fs.readFileSync(path.join(out, 'sample.json'));
    const sample = JSON.parse(sampleBytes.toString('utf8')) as { sample_id: string; sources: { feed: string[] }[] };
    const labels = JSON.parse(fs.readFileSync(path.join(out, 'labels.json'), 'utf8')) as { items: { fixture_id: string; source_id: string; link: string }[] };
    const sampleItems = sample.sources.reduce((n, s) => n + s.feed.join('\n').split('<item>').length - 1, 0);
    const table = fs.readFileSync(path.join(out, 'labelling-table.md'), 'utf8');
    const lines = table.split('\n');

    const heading = lines.find((l) => l.startsWith('# ')) ?? '';
    expect(heading).toContain(sample.sample_id);
    expect(heading).toContain(createHash('sha256').update(sampleBytes).digest('hex'));

    const headerAt = lines.indexOf(HEADER);
    expect(headerAt, 'the header row is exactly the eight columns').toBeGreaterThan(0);
    expect(lines.filter((l) => l.trim().startsWith('| fixture_id')).length, 'one header row').toBe(1);
    expect(cells(lines[headerAt + 1]).every((c) => /^:?-{3,}:?$/.test(c)) && cells(lines[headerAt + 1]).length === 8, 'the separator row').toBe(true);
    const legend = lines.slice(0, headerAt).join('\n');
    for (const value of ['true', 'false', 'releases', 'research', 'policy', 'business', 'other', 'must-read', 'skip']) {
      expect(legend, `the legend lists ${value}`).toContain(`\`${value}\``);
    }

    const rows = lines.slice(headerAt + 2).filter((l) => l.trim().startsWith('|'));
    expect(rows.length, 'one row per item of sample.json').toBe(sampleItems);
    expect(rows.length, 'one row per item of labels.json').toBe(labels.items.length);
    const parsed = rows.map(cells);
    for (const row of parsed) expect(row.length, 'eight cells a row').toBe(8);
    expect(parsed.map((r) => r[0]), 'every fixture_id once, in sample order').toEqual(labels.items.map((i) => i.fixture_id));
    expect(parsed.map((r) => r[1])).toEqual(labels.items.map((i) => i.source_id));
    expect(parsed.map((r) => r[3])).toEqual(labels.items.map((i) => i.link));
    for (const row of parsed) expect(row.slice(4), `${row[0]}: the label cells are empty`).toEqual(['', '', '', '']);

    const byLink = (suffix: string) => parsed.find((r) => r[3].endsWith(suffix));
    expect(byLink(`${run}-item-03`)?.[2], 'a | in a title is written \\|').toBe(`${run} synthetic AI model note 03 \\| with a bar`);
    expect(byLink(`${run}-item-05`)?.[2], 'a line break in a title is a space').toBe(`${run} synthetic AI model note 05 first line second line`);
  },
);
