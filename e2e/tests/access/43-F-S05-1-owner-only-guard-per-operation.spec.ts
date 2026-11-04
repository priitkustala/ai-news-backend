// F-S05-1 (repair round 2 of story 43, @surface-data, project api): Astra's round 1 finding on the
// owner-only check of the exposed schema (app_private.exposed_schema_findings(), run by `migrate`
// inside every migration's transaction). The check searched the combined text of a policy's USING
// and WITH CHECK for the owner function, so a policy that admits every signed-in reader for one
// operation passed it. These rows apply migration-shaped probes with `check-migration`, which runs
// a file through the same step as `migrate` (its SQL, the owner-only check, its ledger entry) and
// rolls everything back, so the live schema is unchanged.
// Given the migrated exposed schema, when a later migration adds a client policy that does not
// require the owner for each operation it governs, then the owner-only check reports it and the
// migration is rolled back with its policy and its ledger entry.
import fs from 'node:fs';
import { test, expect, type TestInfo } from '@playwright/test';
import { runMarker } from '../../support/env';
import { lastJsonObject, runBackend } from '../../support/backend';

type CheckReport = {
  migration?: string;
  owner_only_check?: string;
  findings?: string[];
  after_check?: { policy_change?: number; ledger_entry?: boolean };
  after_rollback?: { schema_unchanged?: boolean; ledger_entry?: boolean };
};

// A policy name unique to this run (the run marker with underscores, so it needs no quoting).
function policyName(row: string, run: string): string {
  return `f_s05_1${row}_${run.replace(/-/g, '_')}`;
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

// The Then of every row: the check refuses the probe on a finding that names its policy for the
// operation it leaves open, and nothing of the probe survives, during the check or after it.
function expectRefused(report: CheckReport, relation: string, policy: string, operation: 'reading' | 'writing'): void {
  expect(report.owner_only_check, `the owner-only check refuses ${policy} (findings: ${JSON.stringify(report.findings)})`).toBe('failed');
  const finding = (report.findings ?? []).find((f) => f.startsWith(`${relation}: policy ${policy} `));
  expect(finding, `a finding names ${relation} and ${policy}`).toBeDefined();
  expect(finding, `the finding names the operation left open`).toContain(operation);
  expect(report.after_check?.policy_change, 'the refused migration leaves no policy').toBe(0);
  expect(report.after_check?.ledger_entry, 'the refused migration leaves no ledger entry').toBe(false);
  expect(report.after_rollback?.schema_unchanged, 'the live schema is unchanged').toBe(true);
  expect(report.after_rollback?.ledger_entry, 'the ledger is unchanged').toBe(false);
}

test(
  'F-S05-1a: a policy on items that reads with using (true) and checks the owner only on writes is refused',
  { tag: ['@journey-access', '@surface-data', '@story-43'] },
  async ({}, testInfo) => {
    // Given: the migrated exposed schema; items grants authenticated SELECT under row-level security
    const policy = policyName('a', runMarker());

    // When: a later migration adds Astra's counterexample, for all operations: every signed-in
    // reader passes USING, the owner function appears only in WITH CHECK
    const report = checkMigration(
      testInfo,
      policy,
      `create policy ${policy} on public.items for all to authenticated\n  using (true)\n  with check ((select app_private.is_owner()));\n`,
    );

    // Then: the check reports the policy for reading, and the policy and the ledger entry are rolled back
    expectRefused(report, 'items', policy, 'reading');
  },
);

test(
  'F-S05-1b: a policy on bookmarks that reads as the owner and writes with check (true) is refused',
  { tag: ['@journey-access', '@surface-data', '@story-43'] },
  async ({}, testInfo) => {
    // Given: the migrated exposed schema; bookmarks is client-writable (authenticated INSERT)
    const policy = policyName('b', runMarker());

    // When: a later migration adds the inverse form: the owner in USING, an unrestricted WITH CHECK
    const report = checkMigration(
      testInfo,
      policy,
      `create policy ${policy} on public.bookmarks for all to authenticated\n  using ((select app_private.is_owner()))\n  with check (true);\n`,
    );

    // Then: the check reports the policy for writing, and the policy and the ledger entry are rolled back
    expectRefused(report, 'bookmarks', policy, 'writing');
  },
);

test(
  'F-S05-1c: a policy that mentions is_owner inside an OR or a negation without requiring it is refused',
  { tag: ['@journey-access', '@surface-data', '@story-43'] },
  async ({}, testInfo) => {
    // Given: the migrated exposed schema
    const run = runMarker();
    const either = policyName('c_or', run);
    const negated = policyName('c_not', run);

    // When: a later migration adds a read policy on items whose USING is the owner OR any sign-in,
    // and another whose USING is the negation of the owner
    const orReport = checkMigration(
      testInfo,
      either,
      `create policy ${either} on public.items for select to authenticated\n  using ((select app_private.is_owner()) or (select auth.uid()) is not null);\n`,
    );
    const notReport = checkMigration(
      testInfo,
      negated,
      `create policy ${negated} on public.items for select to authenticated\n  using (not (select app_private.is_owner()));\n`,
    );

    // Then: the check reports each policy for reading, and each is rolled back with its ledger entry
    expectRefused(orReport, 'items', either, 'reading');
    expectRefused(notReport, 'items', negated, 'reading');
  },
);
