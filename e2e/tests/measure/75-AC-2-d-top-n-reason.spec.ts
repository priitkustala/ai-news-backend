// AC-2d (script, @surface-job, project api): item priitkustala/ai-news#75 (SI-3a), row AC-2d.
// Source: the item's Scope (the top-N reason) and its approved settlement, points 4 and 7.
// Given a copy of the committed validation sample outside the repository with must-read or skip on every
// label record, when the measure command runs with --sample-dir on the copy, then both top-N shares stay
// unavailable and their reason names N and the ranking weights (OD-26 open) and no longer a missing label.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { repositoryRoot, runMarker } from '../../support/env';
import { measure } from '../../support/job';

type LabelsFile = { items: { fixture_id: string; labels: Record<string, unknown> }[] };

test(
  'AC-2d: with importance on every record the top-N reason names only N and the ranking weights',
  { tag: ['@journey-measure', '@surface-job', '@story-75'] },
  async ({}) => {
    // Given: a copy of the committed sample outside the repository, every record labelled must-read or skip
    const run = runMarker();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ai-news-75-${run}-`));
    fs.cpSync(path.join(repositoryRoot(), 'fixtures', 'validation-sample'), dir, { recursive: true });
    const file = path.join(dir, 'labels.json');
    const labels = JSON.parse(fs.readFileSync(file, 'utf8')) as LabelsFile;
    labels.items.forEach((item, index) => { item.labels.importance = index % 2 === 0 ? 'must-read' : 'skip'; });
    fs.writeFileSync(file, `${JSON.stringify(labels, null, 2)}\n`);
    expect(labels.items.length, 'prerequisite: the copy has label records').toBeGreaterThan(0);

    // When: measure runs with --sample-dir on the copy
    const result = measure(['--sample-dir', dir]);

    // Then: every record still passes the label check, and both top-N shares are unavailable with the
    // reason of N and the ranking weights, no longer the missing must-read or skip label
    expect(result.exitCode, result.stderr).toBe(0);
    const report = result.report ?? {};
    const fixtures = (Array.isArray(report.fixtures) ? report.fixtures : []) as Record<string, unknown>[];
    for (const item of labels.items) {
      expect(fixtures.find((f) => f.fixture_id === item.fixture_id)?.labels_from_fixed_lists, item.fixture_id).toBe(true);
    }
    for (const metric of ['top_n_must_read_share', 'top_n_skip_share']) {
      const value = (report[metric] ?? {}) as Record<string, unknown>;
      expect(value.value, metric).toBeNull();
      expect(String(value.unavailable_reason), metric).toContain('N and the ranking weights are not set (OD-26 open)');
      expect(String(value.unavailable_reason), metric).not.toContain('must-read or skip label');
    }
  },
);
