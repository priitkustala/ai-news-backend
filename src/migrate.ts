// `migrate`: applies the numbered SQL files of db/migrations that have not run yet, sets the
// job role's password from the local environment, has PostgREST reload its schema cache,
// creates the two synthetic personas in Supabase Auth, registers the test owner as the owner
// the policies admit, and loads the base seed. Safe to run again. Every migration is checked
// against the owner-only rule of the exposed schema before it commits (priitkustala/ai-news#43).
import fs from 'node:fs';
import path from 'node:path';
import { repositoryRoot, requireEnv, UsageError } from './env.js';
import { inTransaction, withClient, type Client } from './db.js';
import { ensurePersona, PERSONAS } from './auth.js';
import { loadSet } from './seed.js';
import { fixtureSet } from './seed-data.js';

const MIGRATIONS = path.join(repositoryRoot, 'db', 'migrations');

// The owner-only check of 0005: every relation of public is a table with row-level security
// or a security_invoker view, anon holds no privilege, and every client policy requires the
// owner. Before 0005 has run there is no check to run.
async function exposedSchemaFindings(client: Client): Promise<{ relation: string; finding: string }[] | undefined> {
  const exists = await client.query<{ present: boolean }>(
    "select to_regprocedure('app_private.exposed_schema_findings()') is not null as present",
  );
  if (!exists.rows[0].present) return undefined;
  return (await client.query<{ relation: string; finding: string }>('select relation, finding from app_private.exposed_schema_findings()')).rows;
}

function describeFindings(findings: { relation: string; finding: string }[]): string {
  return findings.map((f) => `${f.relation}: ${f.finding}`).join('; ');
}

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
        const findings = await exposedSchemaFindings(client);
        if (findings && findings.length > 0) {
          throw new Error(`${file} leaves the exposed schema open, so it is rolled back: ${describeFindings(findings)}`);
        }
        await client.query('insert into app_private.schema_migrations (version) values ($1)', [file]);
      });
      now.push(file);
    }
    await client.query(`alter role ingest_job with login password '${ingestPassword}'`);
    const findings = await exposedSchemaFindings(client);
    if (!findings) throw new Error('The owner-only check app_private.exposed_schema_findings() is missing after the migrations.');
    if (findings.length > 0) throw new Error(`The exposed schema is not owner-only: ${describeFindings(findings)}`);
    const relations = await client.query<{ count: number }>(
      "select count(*)::integer as count from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')",
    );
    await client.query("notify pgrst, 'reload schema'");
    return { now, relations: relations.rows[0].count };
  });

  const personaIds: Record<string, string> = {};
  for (const persona of PERSONAS) personaIds[persona] = await ensurePersona(persona);

  await withClient('MIGRATION_DATABASE_URL', async (client) => {
    await client.query(
      `insert into app_private.owner (singleton, user_id) values (true, $1)
       on conflict (singleton) do update set user_id = excluded.user_id`,
      [personaIds.owner],
    );
    await loadSet(client, fixtureSet('40g', { run: 'base', fixtures: requireEnv('FIXTURE_FEED_BASE_URL'), now: new Date() }));
  });

  return {
    migrations_applied: applied.now,
    migrations_total: files.length,
    owner_only_check: { relations: applied.relations, findings: 0 },
    personas: PERSONAS,
    base_seed: 'loaded',
  };
}
