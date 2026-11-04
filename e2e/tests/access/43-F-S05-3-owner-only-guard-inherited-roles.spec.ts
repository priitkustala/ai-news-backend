// F-S05-3 (repair round 3 of story 43, @surface-data, project api): Astra's round 2 finding on the
// owner-only check of the exposed schema (app_private.exposed_schema_findings(), run by `migrate`
// inside every migration's transaction). The check chose the policies it reads by the literal
// role names public, anon and authenticated, while PostgreSQL applies a policy to every role that
// holds the privileges of a role the policy names. A policy for a role that authenticated or anon
// is granted, directly or through a chain, reached the clients and passed the check. These rows
// apply migration-shaped probes with `check-migration`, which runs a file through the same step
// as `migrate` (its SQL, the owner-only check, its ledger entry) and rolls everything back, so the
// live schema and the roles are unchanged. The roles are synthetic and unique to the run.
// Given the migrated exposed schema, when a later migration adds an open policy for a role a
// client inherits, then the owner-only check reports it and the migration is rolled back with its
// roles, memberships, policy and ledger entry; an open policy for a server-only role that no
// client inherits stays allowed.
import fs from 'node:fs';
import { test, expect, type TestInfo } from '@playwright/test';
import { runMarker } from '../../support/env';
import { lastJsonObject, runBackend } from '../../support/backend';

type CheckReport = {
  migration?: string;
  owner_only_check?: string;
  findings?: string[];
  after_check?: { policy_change?: number; role_change?: number; ledger_entry?: boolean };
  after_rollback?: { schema_unchanged?: boolean; roles_unchanged?: boolean; ledger_entry?: boolean };
};

// A role or policy name unique to this run (the run marker with underscores, so it needs no quoting).
function probeName(row: string, run: string): string {
  return `f_s05_3${row}_${run.replace(/-/g, '_')}`;
}

// Writes the probe as a migration file of this test's output folder and checks it.
function checkMigration(testInfo: TestInfo, name: string, sql: string): CheckReport {
  const file = testInfo.outputPath(`9999_${name}.sql`);
  fs.mkdirSync(testInfo.outputDir, { recursive: true });
  fs.writeFileSync(file, sql);
  const result = runBackend(['check-migration', file]);
  expect(result.exitCode, `prerequisite: check-migration ran the probe (${result.stderr.trim()})`).toBe(0);
  const report = lastJsonObject(result.stdout) as CheckReport | undefined;
  expect(report, 'prerequisite: check-migration printed its report').toBeDefined();
  return report as CheckReport;
}

// Nothing of the probe survives the check-migration run: no policy, role, membership or ledger entry.
function expectNothingKept(report: CheckReport): void {
  expect(report.after_rollback?.schema_unchanged, 'the live schema is unchanged').toBe(true);
  expect(report.after_rollback?.roles_unchanged, 'the roles and their memberships are unchanged').toBe(true);
  expect(report.after_rollback?.ledger_entry, 'the ledger is unchanged').toBe(false);
}

// The Then of the refusal rows: the check refuses the probe on a finding that names its policy for
// the operation it leaves open, and the refused migration leaves nothing, during the check or after.
function expectRefused(report: CheckReport, relation: string, policy: string, operation: 'reading' | 'writing'): void {
  expect(report.owner_only_check, `the owner-only check refuses ${policy} (findings: ${JSON.stringify(report.findings)})`).toBe('failed');
  const finding = (report.findings ?? []).find((f) => f.startsWith(`${relation}: policy ${policy} `));
  expect(finding, `a finding names ${relation} and ${policy}`).toBeDefined();
  expect(finding, `the finding names the operation left open`).toContain(operation);
  expect(report.after_check?.policy_change, 'the refused migration leaves no policy').toBe(0);
  expect(report.after_check?.role_change, 'the refused migration leaves no role').toBe(0);
  expect(report.after_check?.ledger_entry, 'the refused migration leaves no ledger entry').toBe(false);
  expectNothingKept(report);
}

test(
  'F-S05-3a: an open read policy on items for a role that authenticated inherits is refused',
  { tag: ['@journey-access', '@surface-data', '@story-43'] },
  async ({}, testInfo) => {
    // Given: the migrated exposed schema; items grants authenticated SELECT under row-level security
    const run = runMarker();
    const role = probeName('a_reader', run);
    const policy = probeName('a_open', run);

    // When: a later migration adds Astra's counterexample: a nologin role granted to authenticated
    // with INHERIT (per grant: this stack refuses `alter role authenticated`, a reserved role) and a
    // default-permissive read policy on items for that role only
    const report = checkMigration(
      testInfo,
      policy,
      `create role ${role} nologin;\ngrant ${role} to authenticated with inherit true;\n` +
        `create policy ${policy} on public.items for select to ${role}\n  using (true);\n`,
    );

    // Then: the check reports the policy for reading, and the role, the membership, the policy and
    // the ledger entry are rolled back
    expectRefused(report, 'items', policy, 'reading');
  },
);

test(
  'F-S05-3b: an open write policy on bookmarks for a role that authenticated inherits is refused',
  { tag: ['@journey-access', '@surface-data', '@story-43'] },
  async ({}, testInfo) => {
    // Given: the migrated exposed schema; bookmarks is client-writable (authenticated INSERT)
    const run = runMarker();
    const role = probeName('b_writer', run);
    const policy = probeName('b_open', run);

    // When: a later migration adds the inverse write form: a nologin role granted to authenticated
    // and an insert policy on bookmarks for that role whose WITH CHECK has no owner check
    const report = checkMigration(
      testInfo,
      policy,
      `create role ${role} nologin;\ngrant ${role} to authenticated with inherit true;\n` +
        `create policy ${policy} on public.bookmarks for insert to ${role}\n  with check (true);\n`,
    );

    // Then: the check reports the policy for writing, and everything the probe added is rolled back
    expectRefused(report, 'bookmarks', policy, 'writing');
  },
);

test(
  'F-S05-3c: an open policy on items for a role anon reaches through a chain of grants is refused',
  { tag: ['@journey-access', '@surface-data', '@story-43'] },
  async ({}, testInfo) => {
    // Given: the migrated exposed schema
    const run = runMarker();
    const inner = probeName('c_inner', run);
    const outer = probeName('c_outer', run);
    const policy = probeName('c_open', run);

    // When: a later migration grants a role to a role that is granted to anon (transitive
    // membership) and adds an open read policy on items for the inner role
    const report = checkMigration(
      testInfo,
      policy,
      `create role ${inner} nologin;\ncreate role ${outer} nologin;\n` +
        `grant ${inner} to ${outer} with inherit true;\ngrant ${outer} to anon with inherit true;\n` +
        `create policy ${policy} on public.items for select to ${inner}\n  using (true);\n`,
    );

    // Then: the check reports the policy for reading, and everything the probe added is rolled back
    expectRefused(report, 'items', policy, 'reading');
  },
);

test(
  'F-S05-3d: an open policy on items for a server-only role that no client inherits stays allowed',
  { tag: ['@journey-access', '@surface-data', '@story-43'] },
  async ({}, testInfo) => {
    // Given: the migrated exposed schema
    const run = runMarker();
    const role = probeName('d_job', run);
    const policy = probeName('d_open', run);

    // When: a later migration adds a nologin server-only role, granted to no role and with no
    // membership chain from anon, authenticated or public, and an open read policy on items for it
    // (the shape of the ingest job's own policies)
    const report = checkMigration(
      testInfo,
      policy,
      `create role ${role} nologin;\ncreate policy ${policy} on public.items for select to ${role}\n  using (true);\n`,
    );

    // Then: the check passes it with no finding naming the policy, and check-migration still rolls
    // everything back
    expect(report.owner_only_check, `the owner-only check passes ${policy} (findings: ${JSON.stringify(report.findings)})`).toBe('passed');
    expect((report.findings ?? []).filter((f) => f.includes(policy)), 'no finding names the server-only policy').toEqual([]);
    expect(report.after_check?.policy_change, 'the accepted migration added its policy inside the transaction').toBe(1);
    expect(report.after_check?.role_change, 'the accepted migration added its role inside the transaction').toBe(1);
    expect(report.after_check?.ledger_entry, 'the accepted migration wrote its ledger entry inside the transaction').toBe(true);
    expectNothingKept(report);
  },
);
