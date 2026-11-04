// F-S04-1 (scenario, @surface-job, project api): story 3, review finding F-S04-1 of the S-04 round 1
// evaluation (a defect found in review, reproduced as a failing scenario first; regression contract,
// Test integrity). Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// B-07: the feed shows one representative per cluster, from the highest-weight source, then the earliest.
// Given an item stored by the completed run of an earlier date, when a later run delivers another copy
// of the same canonical URL that wins under B-07, then the feed shows one row for that URL, with the
// stored item's id, naming the winning copy's source; a copy that loses changes nothing.
import { test, expect } from '@playwright/test';
import { runMarker, runDateToday } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { expectRows, readRelation, signIn, titleOf } from '../../support/data';

const byUrl = (url: unknown) => `canonical_url=eq.${encodeURIComponent(String(url))}`;

test(
  'F-S04-1a: a later-run copy from a higher-weight source becomes the representative',
  { tag: ['@journey-ingest', '@surface-job', '@story-3'] },
  async ({ request }) => {
    // Given: copy A (source weight 1) of <run>-later-copy stored by yesterday's completed run, and a
    // stored copy B (source weight 2) of <run>-kept-copy
    const run = runMarker();
    const manifest = seed('F-S04-1a', run);
    const owner = signIn('owner');
    const earlier = expectRows(await readRelation(request, 'ingestion_runs', owner, `run_date=eq.${manifest.earlier_run_date}`), 'prerequisite: the owner reads ingestion_runs');
    expect(earlier.map((row) => row.status), 'prerequisite: the earlier run date completed').toEqual(['completed']);
    const before = expectRows(await readRelation(request, 'feed', owner, byUrl(manifest.later_copy_url)), 'prerequisite: the owner reads the feed');
    expect(before.map((row) => row.source_id), 'prerequisite: the stored copy is source A\'s').toEqual([manifest.stored_source_id]);

    // When: today's run delivers copy B (source weight 2) of <run>-later-copy and copy A of <run>-kept-copy
    const result = ingest(runDateToday());
    expect(result.report?.status, 'prerequisite (1, the run report): the run completes').toMatch(/^(completed|partial)$/);

    // Then: one feed row for <run>-later-copy, with the stored id, naming source B and copy B's title
    const later = expectRows(await readRelation(request, 'feed', owner, byUrl(manifest.later_copy_url)), 'Then');
    expect(later).toHaveLength(1);
    expect(later[0].id).toBe(manifest.later_copy_item_id);
    expect(later[0].source_id).toBe(manifest.later_source_id);
    expect(titleOf(later[0])).toContain(`${run}-later-copy`);
    expect(titleOf(later[0])).toContain('(copy B)');
    // and the lower-weight copy of <run>-kept-copy changed nothing: the stored copy B stays
    const kept = expectRows(await readRelation(request, 'feed', owner, byUrl(manifest.kept_copy_url)), 'Then');
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe(manifest.kept_copy_item_id);
    expect(kept[0].source_id).toBe(manifest.later_source_id);
    expect(titleOf(kept[0])).toContain('(copy B)');
  },
);

test(
  'F-S04-1b: at equal source weights the earlier copy arriving in a later run becomes the representative',
  { tag: ['@journey-ingest', '@surface-job', '@story-3'] },
  async ({ request }) => {
    // Given: copy A of <run>-later-copy stored by yesterday's completed run; sources A and B weigh the same
    const run = runMarker();
    const manifest = seed('F-S04-1b', run);
    const owner = signIn('owner');
    const earlier = expectRows(await readRelation(request, 'ingestion_runs', owner, `run_date=eq.${manifest.earlier_run_date}`), 'prerequisite: the owner reads ingestion_runs');
    expect(earlier.map((row) => row.status), 'prerequisite: the earlier run date completed').toEqual(['completed']);
    const before = expectRows(await readRelation(request, 'feed', owner, byUrl(manifest.later_copy_url)), 'prerequisite: the owner reads the feed');
    expect(before.map((row) => row.source_id), 'prerequisite: the stored copy is source A\'s').toEqual([manifest.stored_source_id]);

    // When: today's run delivers copy B, published earlier than the stored copy A
    const result = ingest(runDateToday());
    expect(result.report?.status, 'prerequisite (1, the run report): the run completes').toMatch(/^(completed|partial)$/);

    // Then: one feed row for <run>-later-copy, with the stored id, naming source B and copy B's time
    const later = expectRows(await readRelation(request, 'feed', owner, byUrl(manifest.later_copy_url)), 'Then');
    expect(later).toHaveLength(1);
    expect(later[0].id).toBe(manifest.later_copy_item_id);
    expect(later[0].source_id).toBe(manifest.later_source_id);
    expect(Date.parse(String(later[0].published_at))).toBe(Date.parse(String(manifest.later_copy_published_at)));
    expect(titleOf(later[0])).toContain(`${run}-later-copy`);
  },
);
