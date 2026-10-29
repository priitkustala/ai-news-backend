// 40g (bootstrap, @surface-data, project api): the environment bootstrap story (#40), coverage.md row 40 g.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// section Local test environment (bootstrap checks).
// Given the test owner signed in on the seeded synthetic database, when the seeded sources and items are read
// through the local Supabase interface, then the seed is present.
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { seed } from '../../support/job';
import { expectRows, readRelation, signIn } from '../../support/data';

test(
  '40g: the seeded sources and items are present for the signed-in test owner',
  { tag: ['@journey-bootstrap', '@surface-data', '@story-40'] },
  async ({ request }) => {
    // Given: the synthetic test owner signed in on the seeded synthetic database; the seed's
    // manifest names the base seed (Locked, Local test environment, row PostgreSQL: fixed
    // sources, items in every category, a last run older than a day): source_ids, item_ids
    // and stale_run_date
    const run = runMarker();
    const manifest = seed('40g', run);
    const sourceIds = (Array.isArray(manifest.source_ids) ? manifest.source_ids : []).map(String);
    const itemIds = (Array.isArray(manifest.item_ids) ? manifest.item_ids : []).map(String);
    expect(sourceIds.length, 'the manifest names the fixed sources').toBeGreaterThan(0);
    expect(itemIds.length, 'the manifest names the seeded items').toBeGreaterThan(0);
    const owner = signIn('owner');

    // When: the seeded sources and items are read through the local Supabase interface. The
    // exposed schema has no sources relation (Locked, Interface between job and client), so a
    // source is observed as the source_id that its seeded items carry in items
    const items = expectRows(await readRelation(request, 'items', owner), 'the owner reads items');
    const runs = expectRows(await readRelation(request, 'ingestion_runs', owner), 'the owner reads ingestion_runs');

    // Then: the seed is present: every seeded item, every fixed source on its items, and the
    // stale run record
    const readIds = new Set(items.map((row) => String(row.id)));
    expect(itemIds.filter((id) => !readIds.has(id)), 'seeded items missing from items').toEqual([]);
    const readSources = new Set(items.filter((row) => itemIds.includes(String(row.id))).map((row) => String(row.source_id)));
    expect([...readSources].sort(), 'the fixed sources, seen on their seeded items').toEqual([...sourceIds].sort());
    expect(runs.filter((row) => row.run_date === manifest.stale_run_date && row.status === 'completed'),
      'the last completed run older than a day').toHaveLength(1);
  },
);
