// 47-AC-7 (@surface-data, project api): priitkustala/ai-news-backend#47 (S-21a), criterion AC-7.
// The owner-only check (app_private.exposed_schema_findings(), run by `migrate` inside every
// migration's transaction) is amended by migration 0015: the news relations feed, categories,
// items and the last-updated columns of ingestion_runs may be read by anon, and an open select
// policy for anon and authenticated on items or ingestion_runs is exempt; everything else stays
// checked, and the check now also sees a privilege granted to anon on columns only. These rows
// apply migration-shaped probes with `check-migration`, in the form of 43-F-S05-1: it runs a file
// through the same step as `migrate` (its SQL, the owner-only check, its ledger entry) and rolls
// everything back, so the live schema is unchanged. Names are unique to the run.
// Given the amended guard, when a probe adds (a) a policy for anon on bookmarks, (b) a write
// privilege and policy for anon on items, (c) an open select for anon on push_subscriptions, (d) a
// column grant to anon on bookmarks, then each is reported and rolled back; when the probe adds
// (e) the news select policy on items, then it is accepted.
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
  return `g47_7${row}_${run.replace(/-/g, '_')}`;
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

// The refused probe leaves nothing, during the check or after it.
function expectNothingKept(report: CheckReport): void {
  expect(report.after_check?.policy_change, 'the refused migration leaves no policy').toBe(0);
  expect(report.after_check?.ledger_entry, 'the refused migration leaves no ledger entry').toBe(false);
  expect(report.after_rollback?.schema_unchanged, 'the live schema is unchanged').toBe(true);
  expect(report.after_rollback?.ledger_entry, 'the ledger is unchanged').toBe(false);
}

// The Then of a refused policy probe: a finding names the relation and the policy.
function expectPolicyRefused(report: CheckReport, relation: string, policy: string): void {
  expect(report.owner_only_check, `the owner-only check refuses ${policy} (findings: ${JSON.stringify(report.findings)})`).toBe('failed');
  const finding = (report.findings ?? []).find((f) => f.startsWith(`${relation}: policy ${policy} `));
  expect(finding, `a finding names ${relation} and ${policy}`).toBeDefined();
  expectNothingKept(report);
}

test(
  '47-AC-7a: an open select policy for anon on bookmarks is refused',
  { tag: ['@journey-access', '@surface-data', '@story-47'] },
  async ({}, testInfo) => {
    // Given: the amended guard; bookmarks is not a news relation
    const policy = policyName('a', runMarker());

    // When: a later migration adds a select policy on bookmarks to anon using (true)
    const report = checkMigration(testInfo, policy, `create policy ${policy} on public.bookmarks for select to anon\n  using (true);\n`);

    // Then: the check reports bookmarks and the policy, and the migration is rolled back
    expectPolicyRefused(report, 'bookmarks', policy);
  },
);

test(
  '47-AC-7b: an insert privilege and an insert policy for anon on items are refused',
  { tag: ['@journey-access', '@surface-data', '@story-47'] },
  async ({}, testInfo) => {
    // Given: the amended guard; items is a news relation, readable only
    const policy = policyName('b', runMarker());

    // When: a later migration grants insert on items to anon and adds an insert policy with check (true)
    const report = checkMigration(
      testInfo,
      policy,
      `grant insert on public.items to anon;\ncreate policy ${policy} on public.items for insert to anon\n  with check (true);\n`,
    );

    // Then: the check reports items and the policy, and the migration is rolled back
    expectPolicyRefused(report, 'items', policy);
  },
);

test(
  '47-AC-7c: a select privilege and an open select policy for anon on push_subscriptions are refused',
  { tag: ['@journey-access', '@surface-data', '@story-47'] },
  async ({}, testInfo) => {
    // Given: the amended guard; push_subscriptions is not a news relation
    const policy = policyName('c', runMarker());

    // When: a later migration grants select on push_subscriptions to anon and adds a select policy using (true)
    const report = checkMigration(
      testInfo,
      policy,
      `grant select on public.push_subscriptions to anon;\ncreate policy ${policy} on public.push_subscriptions for select to anon\n  using (true);\n`,
    );

    // Then: the check reports push_subscriptions and the policy, and the migration is rolled back
    expectPolicyRefused(report, 'push_subscriptions', policy);
  },
);

test(
  '47-AC-7d: a select privilege for anon on a column of bookmarks is refused',
  { tag: ['@journey-access', '@surface-data', '@story-47'] },
  async ({}, testInfo) => {
    // Given: the amended guard, which reads column privileges as well as table privileges
    const name = policyName('d', runMarker());

    // When: a later migration grants select on the column item_id of bookmarks to anon
    const report = checkMigration(testInfo, name, 'grant select (item_id) on public.bookmarks to anon;\n');

    // Then: the check reports the privilege granted to anon on bookmarks, and the migration is rolled back
    expect(report.owner_only_check, `the owner-only check refuses the column grant (findings: ${JSON.stringify(report.findings)})`).toBe('failed');
    expect(report.findings ?? [], 'a finding names the privilege granted to anon on bookmarks').toContain('bookmarks: privilege granted to anon');
    expectNothingKept(report);
  },
);

test(
  '47-AC-7e: a second open select policy for anon and authenticated on items is accepted',
  { tag: ['@journey-access', '@surface-data', '@story-47'] },
  async ({}, testInfo) => {
    // Given: the amended guard; items is a news relation
    const policy = policyName('e', runMarker());

    // When: a later migration adds the news select policy on items to anon, authenticated using (true)
    const report = checkMigration(testInfo, policy, `create policy ${policy} on public.items for select to anon, authenticated\n  using (true);\n`);

    // Then: the check passes it with no finding naming the policy, and check-migration still rolls
    // everything back (as 43-F-S05-3d reads an accepted probe)
    expect(report.owner_only_check, `the owner-only check passes ${policy} (findings: ${JSON.stringify(report.findings)})`).toBe('passed');
    expect((report.findings ?? []).filter((f) => f.includes(policy)), 'no finding names the news select policy').toEqual([]);
    expect(report.after_check?.policy_change, 'the accepted migration added its policy inside the transaction').toBe(1);
    expect(report.after_check?.ledger_entry, 'the accepted migration wrote its ledger entry inside the transaction').toBe(true);
    expect(report.after_rollback?.schema_unchanged, 'the live schema is unchanged').toBe(true);
    expect(report.after_rollback?.ledger_entry, 'the ledger is unchanged').toBe(false);
  },
);
