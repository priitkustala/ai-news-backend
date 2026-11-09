// 36-AC-03a (scenario, @surface-job, project api): priitkustala/ai-news-backend#36, criterion AC-3.
// Approved settlement 51 of 2026-11-09: the command seed-sources replaces the configured sources with
// the rows of a sources file (the format of config/sources.json) and loads no item.
// Given the committed source list config/sources.json, when seed-sources runs with that file, then it
// exits 0 and reports the file's source ids in file order and their count. No ingest runs on that list.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { repositoryRoot, runMarker } from '../../support/env';
import { lastJsonObject, runBackend } from '../../support/backend';
import { seed } from '../../support/job';

test(
  '36-AC-03a: seed-sources stores the committed source list and reports its ids in file order',
  { tag: ['@journey-ingest', '@surface-job', '@story-36'] },
  async ({}) => {
    // Given: the base seed with the 40g set, and the committed source list
    seed('40g', runMarker());
    const file = path.join(repositoryRoot(), 'config', 'sources.json');
    const list = JSON.parse(fs.readFileSync(file, 'utf8')) as { sources: { id: string }[] };
    const ids = list.sources.map((s) => s.id);
    expect(ids.length, 'prerequisite: the committed list has 16 or more rows').toBeGreaterThanOrEqual(16);

    // When: seed-sources runs with the absolute path of that file
    const result = runBackend(['seed-sources', file]);

    // Then: the exit is 0, sources are the file's ids in order and count is the row count
    expect(result.exitCode, `seed-sources exits 0: ${result.stderr}`).toBe(0);
    const output = lastJsonObject(result.stdout);
    expect(output?.sources, 'sources are the file ids in file order').toEqual(ids);
    expect(output?.count, 'count is the row count of the file').toBe(ids.length);
  },
);
