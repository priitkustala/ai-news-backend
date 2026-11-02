// `migrate`: applies the numbered SQL files of db/migrations that have not run yet, sets the
// job role's password from the local environment and has PostgREST reload its schema cache.
// Safe to run again.
import fs from 'node:fs';
import path from 'node:path';
import { repositoryRoot, requireEnv, UsageError } from './env.js';
import { inTransaction, withClient } from './db.js';

const MIGRATIONS = path.join(repositoryRoot, 'db', 'migrations');

export async function migrate(): Promise<Record<string, unknown>> {
  const ingestPassword = requireEnv('INGEST_DB_PASSWORD');
  // Role passwords cannot be bound as parameters; the generated value is base64url only.
  if (!/^[A-Za-z0-9_-]{16,}$/.test(ingestPassword)) throw new UsageError('INGEST_DB_PASSWORD must be base64url (from `keys`).');
  const files = fs.readdirSync(MIGRATIONS).filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();

  const applied = await withClient('MIGRATION_DATABASE_URL', async (client) => {
    await client.query('create schema if not exists app_private');
    await client.query('revoke all on schema app_private from public');
    await client.query(
      'create table if not exists app_private.schema_migrations (version text primary key, applied_at timestamptz not null default now())',
    );
    await client.query('revoke all on table app_private.schema_migrations from public, anon, authenticated');
    const done = new Set((await client.query<{ version: string }>('select version from app_private.schema_migrations')).rows.map((r) => r.version));
    const now: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
      await inTransaction(client, async () => {
        await client.query(sql);
        await client.query('insert into app_private.schema_migrations (version) values ($1)', [file]);
      });
      now.push(file);
    }
    await client.query(`alter role ingest_job with login password '${ingestPassword}'`);
    await client.query("notify pgrst, 'reload schema'");
    return now;
  });

  return { migrations_applied: applied, migrations_total: files.length };
}
