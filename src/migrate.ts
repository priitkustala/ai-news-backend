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

// The owner-only check of 0008, per operation since 0009, over the roles a client holds since
// 0010: every relation of public is a table with row-level security or a security_invoker view,
// anon holds no privilege, and every policy that reaches a client (for public, or for a role anon
// or authenticated is a member of, directly or through a chain of grants; 0010's comment) requires
// the owner in the expression that governs each operation it applies to (USING for reading, WITH
// CHECK or else USING for writing; 0009's comment). Before 0008 has run there is no check to run.
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

// A migration the owner-only check refuses; it carries the findings.
class OpenSchemaError extends Error {
  constructor(file: string, readonly findings: { relation: string; finding: string }[]) {
    super(`${file} leaves the exposed schema open, so it is rolled back: ${describeFindings(findings)}`);
  }
}

// One migration inside the caller's transaction: its SQL, the owner-only check, then its
// ledger entry. A finding throws before the entry is written, so the caller's rollback
// removes both the migration's objects and its entry.
async function applyMigration(client: Client, file: string, sql: string): Promise<void> {
  await client.query(sql);
  const findings = await exposedSchemaFindings(client);
  if (findings && findings.length > 0) throw new OpenSchemaError(file, findings);
  await client.query('insert into app_private.schema_migrations (version) values ($1)', [file]);
}

// The report of applyMigrations: names, codes and counts only, never an error's text or a
// value read from the database (priitkustala/ai-news-backend#58).
export type MigrationReport = {
  mode: 'dry-run' | 'apply';
  pending: string[];
  applied: string[];
  failed: string | null;
  error_code: string | null;
  files_total: number;
  ledger_total: number;
  owner_only_findings: number;
};

// An SQLSTATE (42601, 3D000) or a system code (ECONNREFUSED) as the error carries it; else unknown.
function errorCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z0-9_]{3,20}$/.test(code) ? code : 'unknown';
}

// `apply-migrations [--dry-run]`: applies only the files of the folder (db/migrations; tests pass
// another) that the ledger does not hold, each in its own transaction, then the owner-only check of
// the exposed schema and the schema reload of PostgREST; the first failure stops it. A dry run
// applies every pending file in one transaction, each through the same check, runs the final check,
// and always rolls back. It never throws: a failure is the report's failed file and error code.
export async function applyMigrations({ dryRun, dir = MIGRATIONS }: { dryRun: boolean; dir?: string }): Promise<MigrationReport> {
  const report: MigrationReport = {
    mode: dryRun ? 'dry-run' : 'apply',
    pending: [],
    applied: [],
    failed: null,
    error_code: null,
    files_total: 0,
    ledger_total: 0,
    owner_only_findings: 0,
  };
  let current: string | null = null;
  const fail = (error: unknown) => {
    // The first failure is the one reported.
    if (report.failed !== null || report.error_code !== null) return;
    report.failed = current;
    if (error instanceof OpenSchemaError) report.owner_only_findings = error.findings.length;
    else report.error_code = errorCode(error);
  };
  try {
    const files = fs.readdirSync(dir).filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
    report.files_total = files.length;
    await withClient('MIGRATION_DATABASE_URL', async (client) => {
      try {
        if (dryRun) await client.query('begin');
        try {
          await client.query('create schema if not exists app_private');
          await client.query('revoke all on schema app_private from public');
          await client.query(
            'create table if not exists app_private.schema_migrations (version text primary key, applied_at timestamptz not null default now())',
          );
          await client.query('revoke all on table app_private.schema_migrations from public, anon, authenticated');
          const done = new Set((await client.query<{ version: string }>('select version from app_private.schema_migrations')).rows.map((r) => r.version));
          report.pending = files.filter((file) => !done.has(file));
          for (const file of report.pending) {
            current = file;
            const sql = fs.readFileSync(path.join(dir, file), 'utf8');
            if (dryRun) {
              await applyMigration(client, file, sql);
            } else {
              await inTransaction(client, () => applyMigration(client, file, sql));
              report.applied.push(file);
            }
          }
          current = null;
          const findings = await exposedSchemaFindings(client);
          if (!findings) throw new Error('The owner-only check app_private.exposed_schema_findings() is missing after the migrations.');
          report.owner_only_findings = findings.length;
          if (findings.length === 0 && !dryRun) await client.query("notify pgrst, 'reload schema'");
        } finally {
          if (dryRun) await client.query('rollback');
        }
      } catch (error) {
        fail(error);
      }
      try {
        const ledger = await client.query<{ present: boolean }>("select to_regclass('app_private.schema_migrations') is not null as present");
        report.ledger_total = ledger.rows[0].present
          ? (await client.query<{ count: number }>('select count(*)::integer as count from app_private.schema_migrations')).rows[0].count
          : 0;
      } catch (error) {
        fail(error);
      }
    });
  } catch (error) {
    fail(error);
  }
  return report;
}

export async function migrate(): Promise<Record<string, unknown>> {
  const ingestPassword = requireEnv('INGEST_DB_PASSWORD');
  // Role passwords cannot be bound as parameters; the generated value is base64url only.
  if (!/^[A-Za-z0-9_-]{16,}$/.test(ingestPassword)) throw new UsageError('INGEST_DB_PASSWORD must be base64url (from `keys`).');

  const report = await applyMigrations({ dryRun: false });
  if (report.failed !== null || report.error_code !== null || report.owner_only_findings > 0) {
    throw new Error(
      `The migrations did not apply: failed ${report.failed ?? 'none'}, error code ${report.error_code ?? 'none'}, owner-only findings ${report.owner_only_findings}.`,
    );
  }

  const relations = await withClient('MIGRATION_DATABASE_URL', async (client) => {
    await client.query(`alter role ingest_job with login password '${ingestPassword}'`);
    const result = await client.query<{ count: number }>(
      "select count(*)::integer as count from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')",
    );
    return result.rows[0].count;
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
    migrations_applied: report.applied,
    migrations_total: report.files_total,
    owner_only_check: { relations, findings: 0 },
    personas: PERSONAS,
    base_seed: 'loaded',
  };
}

// The catalog state check-migration compares: the policies and relations of public, the roles
// and their memberships (a probe may add a role a client inherits, F-S05-3) and whether the
// ledger holds the probe's entry. Reported as counts and booleans only.
type CatalogState = { policies: number; fingerprint: string; roles: number; role_fingerprint: string; ledger: boolean };
async function catalogState(client: Client, file: string): Promise<CatalogState> {
  const result = await client.query<CatalogState>(
    `select (select count(*)::integer from pg_catalog.pg_policies where schemaname = 'public') as policies,
            md5(coalesce((select string_agg(concat_ws('|', tablename, policyname, permissive, roles::text, cmd, qual, with_check), ',' order by tablename, policyname)
                            from pg_catalog.pg_policies where schemaname = 'public'), '')
                || coalesce((select string_agg(concat_ws('|', c.relname, c.relkind, c.relrowsecurity, c.reloptions::text, c.relacl::text), ',' order by c.relname)
                               from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                              where n.nspname = 'public'), '')) as fingerprint,
            (select count(*)::integer from pg_catalog.pg_roles) as roles,
            md5(coalesce((select string_agg(r.rolname || '|' || r.rolinherit::text, ',' order by r.rolname) from pg_catalog.pg_roles r), '')
                || coalesce((select string_agg(concat_ws('|', g.rolname, m.rolname, a.admin_option, a.inherit_option, a.set_option), ',' order by g.rolname, m.rolname)
                               from pg_catalog.pg_auth_members a
                               join pg_catalog.pg_roles g on g.oid = a.roleid
                               join pg_catalog.pg_roles m on m.oid = a.member), '')) as role_fingerprint,
            exists (select 1 from app_private.schema_migrations where version = $1) as ledger`,
    [file],
  );
  return result.rows[0];
}

// `check-migration <sql-file>`: applies a migration-shaped file the way `migrate` applies each
// migration (applyMigration), inside a savepoint of a transaction that is always rolled back,
// and reports whether the owner-only check let it through. For the scenarios of the guard
// (priitkustala/ai-news#43, F-S05-1, F-S05-3); nothing it applies is kept.
export async function checkMigration(sqlFile: string): Promise<Record<string, unknown>> {
  if (!fs.existsSync(sqlFile) || !fs.statSync(sqlFile).isFile()) throw new UsageError(`check-migration: no file ${sqlFile}.`);
  const file = path.basename(sqlFile);
  const sql = fs.readFileSync(sqlFile, 'utf8');
  return withClient('MIGRATION_DATABASE_URL', async (client) => {
    if (!(await exposedSchemaFindings(client))) throw new Error('The owner-only check is missing: run migrate first.');
    const before = await catalogState(client, file);
    await client.query('begin');
    let findings: { relation: string; finding: string }[] = [];
    let afterCheck: CatalogState;
    try {
      await client.query('savepoint check_migration');
      try {
        await applyMigration(client, file, sql);
      } catch (error) {
        if (!(error instanceof OpenSchemaError)) throw error;
        findings = error.findings;
        await client.query('rollback to savepoint check_migration');
      }
      afterCheck = await catalogState(client, file);
    } finally {
      await client.query('rollback');
    }
    const after = await catalogState(client, file);
    return {
      migration: file,
      owner_only_check: findings.length > 0 ? 'failed' : 'passed',
      findings: findings.map((f) => `${f.relation}: ${f.finding}`),
      after_check: { policy_change: afterCheck.policies - before.policies, role_change: afterCheck.roles - before.roles, ledger_entry: afterCheck.ledger },
      after_rollback: {
        schema_unchanged: after.fingerprint === before.fingerprint,
        roles_unchanged: after.role_fingerprint === before.role_fingerprint,
        ledger_entry: after.ledger,
      },
    };
  });
}
