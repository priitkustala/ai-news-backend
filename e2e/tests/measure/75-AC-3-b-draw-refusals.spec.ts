// AC-3b (script, @surface-job, project api): item priitkustala/ai-news#75 (SI-3a), row AC-3b.
// Source: the item's Scope (no real item in a repository) and its approved settlement, points 3, 5 and 7.
// Given a synthetic sources file, when draw-sample runs with --out a folder tracked by git, and then with
// --out a folder outside the repository that already holds a sample.json, then both runs exit 2 with their
// refusal line on standard error and write nothing (exit 2 alone is also a usage error before the command
// exists: the words count).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { repositoryRoot, requireEnv, runMarker } from '../../support/env';
import { drawSample } from '../../support/job';

test(
  'AC-3b: draw-sample refuses a tracked --out and an --out that already holds sample.json, writing nothing',
  { tag: ['@journey-measure', '@surface-job', '@story-75'] },
  async ({}) => {
    // Given: a synthetic sources file outside the repository, a folder git tracks, and a folder outside the
    // repository that already holds a sample.json
    const run = runMarker();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ai-news-75-${run}-`));
    const base = new URL(requireEnv('E2E_FIXTURE_FEED_URL', 'a feed address of the fixture feed server')).origin;
    const sourcesFile = path.join(dir, 'sources-input.json');
    fs.writeFileSync(sourcesFile, `${JSON.stringify({ sources: [{ id: 'fixture-openai', name: 'fixture-openai (fixture)',
      feed_url: `${base}/feeds/openai-news.xml?run=${run}&at=${new Date(Date.now() - 3600_000).toISOString()}`, source_type: 'feed',
      default_categories: ['releases'], display_policy: 'feed-summary', source_weight: 1 }] }, null, 2)}\n`);
    const tracked = path.join(repositoryRoot(), 'fixtures', 'feeds');
    const trackedBefore = fs.readdirSync(tracked).sort();
    const frozen = path.join(dir, 'frozen');
    fs.mkdirSync(frozen);
    const frozenSample = `{"sample_id": "frozen-${run}"}\n`;
    fs.writeFileSync(path.join(frozen, 'sample.json'), frozenSample);

    // When: draw-sample runs with --out the tracked folder
    const intoTracked = drawSample(['--sources', sourcesFile, '--out', tracked]);

    // Then: exit 2 with the refusal of a tracked folder, and the folder is unchanged
    expect(intoTracked.exitCode, intoTracked.stderr).toBe(2);
    expect(intoTracked.stderr).toContain('usage: --out <folder> holds files tracked by git; a sample of real items never lives in a repository');
    expect(fs.readdirSync(tracked).sort()).toEqual(trackedBefore);

    // When: draw-sample runs with --out the folder that already holds sample.json
    const intoFrozen = drawSample(['--sources', sourcesFile, '--out', frozen]);

    // Then: exit 2 with the refusal of a frozen sample, and the folder holds only its own sample.json, unchanged
    expect(intoFrozen.exitCode, intoFrozen.stderr).toBe(2);
    expect(intoFrozen.stderr).toContain('usage: --out <folder> already holds sample.json; a drawn sample is frozen, draw into a new folder');
    expect(fs.readdirSync(frozen)).toEqual(['sample.json']);
    expect(fs.readFileSync(path.join(frozen, 'sample.json'), 'utf8')).toBe(frozenSample);
  },
);
