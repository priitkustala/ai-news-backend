// 86-AC-01a (@surface-data, project api): priitkustala/ai-news-backend#86 (LI-1), criterion AC-1.
// Migration 0018 recreates the owner-only check (app_private.exposed_schema_findings()) so that
// its reading rule reads only permissive policies: a restrictive policy is combined with AND and
// can only hide rows a permissive policy admits, so it cannot open a read. Probes in the form of
// 47-AC-7, applied with `check-migration` (the same step as `migrate`, then rolled back, so the
// live schema is unchanged). Names are unique to the run.
// Given the guard of 0018, when a probe adds a restrictive select policy for anon on bookmarks
// with an open condition, then it is let through; when a probe adds a permissive open select
// policy for authenticated on bookmarks, then it is still refused and rolled back.
import fs from 'node:fs';
import { test, expect, type TestInfo } from '@playwright/test';
import { runMarker } from '../../support/env';
import { lastJsonObject, runBackend } from '../../support/backend';

type CheckReport = {
  owner_only_check?: string;
  findings?: string[];
  after_check?: { policy_change?: number; ledger_entry?: boolean };
  after_rollback?: { schema_unchanged?: boolean; ledger_entry?: boolean };
};

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

test(
  '86-AC-01a: a restrictive read rule with an open condition is let through; a permissive one is still refused',
  { tag: ['@journey-access', '@surface-data', '@story-86'] },
  async ({}, testInfo) => {
    // Given: the guard of 0018; bookmarks is not a news relation
    const run = runMarker().replace(/-/g, '_');
    const restrictive = `g86_1r_${run}`;
    const permissive = `g86_1p_${run}`;

    // When: a later migration adds a restrictive select policy on bookmarks to anon using (true)
    const allowed = checkMigration(testInfo, restrictive,
      `create policy ${restrictive} on public.bookmarks as restrictive for select to anon\n  using (true);\n`);

    // Then: the check passes it with no finding naming the policy, and everything is rolled back
    expect(allowed.owner_only_check, `the owner-only check passes ${restrictive} (findings: ${JSON.stringify(allowed.findings)})`).toBe('passed');
    expect((allowed.findings ?? []).filter((f) => f.includes(restrictive)), 'no finding names the restrictive policy').toEqual([]);
    expect(allowed.after_check?.policy_change, 'the accepted migration added its policy inside the transaction').toBe(1);
    expect(allowed.after_rollback?.schema_unchanged, 'the live schema is unchanged').toBe(true);
    expect(allowed.after_rollback?.ledger_entry, 'the ledger is unchanged').toBe(false);

    // When: a later migration adds a permissive select policy on bookmarks to authenticated using (true)
    const refused = checkMigration(testInfo, permissive,
      `create policy ${permissive} on public.bookmarks for select to authenticated\n  using (true);\n`);

    // Then: the check still refuses it, names bookmarks and the policy for reading, and nothing is kept
    expect(refused.owner_only_check, `the owner-only check refuses ${permissive} (findings: ${JSON.stringify(refused.findings)})`).toBe('failed');
    expect(refused.findings ?? [], 'a finding names bookmarks and the permissive policy for reading').toContain(
      `bookmarks: policy ${permissive} (for select) for a client role does not require the owner for reading`);
    expect(refused.after_check?.policy_change, 'the refused migration leaves no policy').toBe(0);
    expect(refused.after_check?.ledger_entry, 'the refused migration leaves no ledger entry').toBe(false);
    expect(refused.after_rollback?.schema_unchanged, 'the live schema is unchanged').toBe(true);
    expect(refused.after_rollback?.ledger_entry, 'the ledger is unchanged').toBe(false);
  },
);
