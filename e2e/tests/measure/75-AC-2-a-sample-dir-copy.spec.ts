// AC-2a (script, @surface-job, project api): item priitkustala/ai-news#75 (SI-3a), row AC-2a.
// Source: the item's AC-2 and its approved settlement, point 7.
// Given a copy of the committed validation sample in a fresh folder outside the repository, when the
// measure command runs with --sample-dir on the copy and without the option, then both exit 0 and the
// report with the option equals the report without it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { repositoryRoot, runMarker } from '../../support/env';
import { measure } from '../../support/job';

test(
  'AC-2a: measure --sample-dir on a copy of the committed sample prints the same report as measure without the option',
  { tag: ['@journey-measure', '@surface-job', '@story-75'] },
  async ({}) => {
    // Given: a copy of fixtures/validation-sample in a fresh folder under the system's temporary folder
    const run = runMarker();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ai-news-75-${run}-`));
    fs.cpSync(path.join(repositoryRoot(), 'fixtures', 'validation-sample'), dir, { recursive: true });
    expect(fs.existsSync(path.join(dir, 'sample.json')) && fs.existsSync(path.join(dir, 'labels.json')), 'prerequisite: the copy holds both files').toBe(true);

    // When: measure runs with --sample-dir on the copy, and without the option
    const withOption = measure(['--sample-dir', dir]);
    const without = measure();

    // Then: both exit 0 and the two reports are equal
    expect(withOption.exitCode, withOption.stderr).toBe(0);
    expect(without.exitCode, without.stderr).toBe(0);
    expect(withOption.report, 'the report of the copy').toBeDefined();
    expect(withOption.report).toEqual(without.report);
  },
);
