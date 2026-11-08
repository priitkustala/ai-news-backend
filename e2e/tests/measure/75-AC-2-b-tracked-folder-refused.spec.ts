// AC-2b (script, @surface-job, project api): item priitkustala/ai-news#75 (SI-3a), row AC-2b.
// Source: the item's AC-2 and its approved settlement, points 3 and 7.
// Given the committed folder fixtures/validation-sample, which git tracks, when the measure command runs
// with --sample-dir on it, then it exits 2, prints no report and standard error names the refusal of a
// folder tracked by git (exit 2 alone is also a usage error before the option exists: the words count).
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { repositoryRoot } from '../../support/env';
import { measure } from '../../support/job';

test(
  'AC-2b: measure --sample-dir on a folder tracked by git is refused with exit 2 and the refusal words',
  { tag: ['@journey-measure', '@surface-job', '@story-75'] },
  async ({}) => {
    // Given: the committed sample folder, tracked by git
    const tracked = path.join(repositoryRoot(), 'fixtures', 'validation-sample');

    // When: measure runs with --sample-dir on it
    const result = measure(['--sample-dir', tracked]);

    // Then: exit 2, no report, and the refusal of a tracked folder on standard error
    expect(result.exitCode, result.stderr).toBe(2);
    expect(result.report, 'no report is printed').toBeUndefined();
    expect(result.stderr).toContain('usage: --sample-dir <folder> holds files tracked by git; a sample of real items never lives in a repository');
  },
);
