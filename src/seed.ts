// `seed <fixture-set> <run-marker>`: resets the run records, the source configuration, the
// stored items and the bookmarks to the base seed plus the named fixture set, and prints the
// fixture manifest as the last line (tests/README-testids.md, Isolation). Runs with the
// migration role: the seed is the local environment's set-up, not the job.
import { requireEnv, UsageError } from './env.js';
import { inTransaction, withClient, type Client } from './db.js';
import { fixtureSet, fixtureSetNames, type FixtureSet } from './seed-data.js';
import { latestRunId, storeOtherShare } from './ingest/other-share.js';

const RUN_MARKER = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/;

// The seeded window's Other share is stored on the set's latest completed run, the way a run
// stores its own, with `windowEnd` (the time the set was built at) as the window's end.
export async function loadSet(client: Client, set: FixtureSet, windowEnd: Date = new Date()): Promise<void> {
  await inTransaction(client, async () => {
    await client.query('delete from public.bookmarks');
    await client.query('delete from public.ingestion_runs');
    await client.query('delete from public.items');
    await client.query('delete from app_private.sources');
    for (const s of set.sources) {
      await client.query(
        `insert into app_private.sources (id, name, feed_url, source_type, community, default_categories, image_policy, display_policy)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [s.id, s.name, s.feed_url, s.source_type ?? 'feed', s.community ?? null, s.default_categories ?? [],
          s.image_policy ?? 'placeholder', s.display_policy ?? 'title-link'],
      );
    }
    for (const i of set.items) {
      await client.query(
        `insert into public.items (id, canonical_url, source_id, title, published_at, image_url, summary, category, status,
                                   category_method, relevance_method, ai_relevant, processing_version, fetched_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'seed', 'seed', true, 'seed', coalesce($10::timestamptz, now()))`,
        [i.id, i.canonical_url, i.source_id, i.title, i.published_at, i.image_url, i.summary, i.category, i.status, i.fetched_at ?? null],
      );
    }
    for (const r of set.runs) {
      await client.query(
        'insert into public.ingestion_runs (run_date, status, started_at, ended_at) values ($1, $2, $3, $4)',
        [r.run_date, r.status, r.started_at, r.ended_at],
      );
    }
    const latest = await latestRunId(client);
    if (latest) await storeOtherShare(client, latest, windowEnd);
  });
}

export async function seed(name: string, run: string): Promise<Record<string, unknown>> {
  if (!fixtureSetNames().includes(name)) {
    throw new UsageError(`Unknown fixture set ${name}. Known sets: ${fixtureSetNames().join(', ')}.`);
  }
  if (!RUN_MARKER.test(run)) throw new UsageError(`The run marker ${JSON.stringify(run)} must be letters, digits and hyphens.`);
  const now = new Date();
  const set = fixtureSet(name, { run, fixtures: requireEnv('FIXTURE_FEED_BASE_URL'), now });
  await withClient('MIGRATION_DATABASE_URL', (client) => loadSet(client, set, now));
  return set.manifest;
}
