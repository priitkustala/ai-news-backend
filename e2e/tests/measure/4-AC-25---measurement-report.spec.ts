// AC-25 (script, @surface-job, project api): story 4, coverage.md row AC-25 -.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// criterion AC-25; the Given/When/Then is the owning story's row AC-25.
// Given the frozen validation sample with owner labels and the seeded injection and malformed fixtures, when
// the measurement script runs, then it prints each metric of W4 section 8 and every fixture yields a
// schema-valid record with labels from the fixed lists. CONDITIONAL on OD-26 for the bars: until the owner
// sets them the script reports the values without a verdict (no bar is asserted here).
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { measure, seed } from '../../support/job';

// The metrics of W4 section 8 for the deterministic pipeline (Locked, Problem and outcome;
// OD-19 DECIDED: no model step, so W4's summary-fidelity metric does not apply), with the
// shape of each value: a share between 0 and 1, or a map of such shares per category or
// per source.
const SHARES = ['relevance_precision', 'relevance_recall', 'category_accuracy', 'other_share', 'duplicate_precision',
  'duplicate_recall', 'top_n_must_read_share', 'top_n_skip_share'];
const MAPS: Record<string, string> = { category_accuracy_per_category: 'category', summary_presence_per_source: 'source' };
const FIVE = ['releases', 'research', 'policy', 'business', 'other'];

// A value is reported, or reported unavailable with its reason (for example no labelled
// duplicate pair in the sample); no pass bar is invented (OD-26).
function shareOk(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 1;
  const v = value as Record<string, unknown> | null;
  return v !== null && typeof v === 'object' && v.value === null && typeof v.unavailable_reason === 'string' && v.unavailable_reason !== '';
}

test(
  'AC-25: the measurement script prints each W4 section 8 metric and every fixture record is schema-valid',
  { tag: ['@journey-measure', '@surface-job', '@story-4'] },
  async ({}) => {
    // Given: the frozen validation sample with owner labels and the seeded injection and malformed
    // fixtures; the manifest names every fixture record (fixture_ids) and the sample's sources
    const run = runMarker();
    const manifest = seed('AC-25', run);
    const fixtureIds = (Array.isArray(manifest.fixture_ids) ? manifest.fixture_ids : []).map(String);
    const sourceIds = (Array.isArray(manifest.source_ids) ? manifest.source_ids : []).map(String);
    expect(fixtureIds.length, 'prerequisite: the manifest names the fixture records').toBeGreaterThan(0);

    // When: the measurement script runs
    const result = measure();

    // Then: it prints each metric with a value of its shape, and every named fixture yields a
    // schema-valid record with labels from the fixed lists; no pass bar is asserted (OD-26)
    expect(result.exitCode, result.stderr).toBe(0);
    const report = result.report ?? {};
    for (const metric of SHARES) expect(shareOk(report[metric]), `${metric} is a share or an explained unavailable value`).toBe(true);
    for (const [metric, per] of Object.entries(MAPS)) {
      const map = (report[metric] ?? {}) as Record<string, unknown>;
      const want = per === 'category' ? FIVE : sourceIds;
      expect(Object.keys(map).sort(), `${metric} has one value per ${per}`).toEqual([...want].sort());
      for (const key of want) expect(shareOk(map[key]), `${metric}.${key}`).toBe(true);
    }
    const fixtures = (Array.isArray(report.fixtures) ? report.fixtures : []) as Record<string, unknown>[];
    expect(fixtures.map((f) => String(f.fixture_id)).sort(), 'one record per named fixture, none missing').toEqual([...fixtureIds].sort());
    for (const fixture of fixtures) {
      expect(fixture.schema_valid, String(fixture.fixture_id)).toBe(true);
      expect(fixture.labels_from_fixed_lists, String(fixture.fixture_id)).toBe(true);
    }
  },
);
