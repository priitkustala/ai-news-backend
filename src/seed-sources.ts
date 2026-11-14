// `seed-sources <file>` (priitkustala/ai-news-backend#36): replaces the configured sources with
// the rows of a sources file in the format of config/sources.json, so the staging project runs
// the real ingestion of the committed list. The file is parsed as draw-sample parses it, so a bad
// file is refused with its usage error before any connection. Runs with the migration role, like
// the seed; touches no item, run or other table, and is safe to run again. Items of a replaced
// source whose id is not in the new file are deleted by the next ingest's retention (B-22). Items
// of a source whose id is also in the new file stay, and a caller that wants them gone removes
// them itself.
import { inTransaction, withClient } from './db.js';
import { readSources } from './measure/draw.js';

export type SeedSourcesReport = { sources: string[]; count: number };

export async function seedSources(file: string): Promise<SeedSourcesReport> {
  const { sources } = readSources(file);
  await withClient('MIGRATION_DATABASE_URL', async (client) => {
    await inTransaction(client, async () => {
      await client.query('delete from app_private.sources');
      for (const s of sources) {
        await client.query(
          `insert into app_private.sources (id, name, feed_url, source_type, community, default_categories, image_policy, display_policy, source_weight)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [s.id, s.name, s.feed_url, s.source_type, null, s.default_categories, 'placeholder', s.display_policy, s.source_weight],
        );
      }
    });
  });
  return { sources: sources.map((s) => s.id), count: sources.length };
}
