// AC-2c (script, @surface-job, project api): item priitkustala/ai-news#75 (SI-3a), row AC-2c.
// Source: the item's AC-2 and its approved settlement, points 4 and 7.
// Given a copy of the committed validation sample outside the repository with "importance": "must-read"
// on one label record, then with "importance": "urgent" on it, when the measure command runs with
// --sample-dir on the copy, then must-read passes that record's label check and urgent fails it with the
// error labels.importance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { repositoryRoot, runMarker } from '../../support/env';
import { measure } from '../../support/job';

type LabelsFile = { items: { fixture_id: string; labels: Record<string, unknown> }[] };

function withImportance(dir: string, value: string): string {
  const file = path.join(dir, 'labels.json');
  const labels = JSON.parse(fs.readFileSync(file, 'utf8')) as LabelsFile;
  labels.items[0].labels.importance = value;
  fs.writeFileSync(file, `${JSON.stringify(labels, null, 2)}\n`);
  return labels.items[0].fixture_id;
}

function recordOf(report: Record<string, unknown> | undefined, id: string): Record<string, unknown> | undefined {
  const fixtures = (Array.isArray(report?.fixtures) ? report.fixtures : []) as Record<string, unknown>[];
  return fixtures.find((f) => f.fixture_id === id);
}

test(
  'AC-2c: labels.importance must-read passes the label check and urgent fails it with labels.importance',
  { tag: ['@journey-measure', '@surface-job', '@story-75'] },
  async ({}) => {
    // Given: a copy of the committed sample outside the repository, one record labelled must-read
    const run = runMarker();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ai-news-75-${run}-`));
    fs.cpSync(path.join(repositoryRoot(), 'fixtures', 'validation-sample'), dir, { recursive: true });
    const id = withImportance(dir, 'must-read');

    // When: measure runs with --sample-dir on the copy
    const accepted = measure(['--sample-dir', dir]);

    // Then: exit 0 and that record's labels come from the fixed lists
    expect(accepted.exitCode, accepted.stderr).toBe(0);
    const passed = recordOf(accepted.report, id);
    expect(passed, `the report has the record ${id}`).toBeDefined();
    expect(passed?.labels_from_fixed_lists, `${id} with importance must-read`).toBe(true);
    expect((passed?.errors ?? []) as string[]).not.toContain('labels.importance');

    // Given: the same record labelled urgent
    withImportance(dir, 'urgent');

    // When: measure runs again
    const refused = measure(['--sample-dir', dir]);

    // Then: exit 0, and the record fails the label check with the error labels.importance
    expect(refused.exitCode, refused.stderr).toBe(0);
    const failed = recordOf(refused.report, id);
    expect(failed?.labels_from_fixed_lists, `${id} with importance urgent`).toBe(false);
    expect((failed?.errors ?? []) as string[]).toContain('labels.importance');
  },
);
