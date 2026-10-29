// The job's published interface: the `ingest` command with a run date and `--dry-run`
// (Locked, Architecture), the seed of the local test environment (Locked, Local test
// environment), the measurement script (AC-25) and the repository scan (AC-20).
// Output shapes: tests/README-testids.md, Named commands and outputs.
import { lastJsonObject, runBackend, type CommandResult } from './backend';

export type SourceError = { source_id: string; error: string };
export type Rejected = { source_id: string; reason: string };
export type JobRequest = { source_id: string; source_type: string; host: string };
export type RunReport = {
  run_id?: string;
  run_date?: string;
  status?: string;
  dry_run?: boolean;
  fetched_count?: number;
  processed_count?: number;
  item_count?: number;
  source_errors?: SourceError[];
  rejected?: Rejected[];
  requests?: JobRequest[];
};

export type IngestResult = CommandResult & { report: RunReport | undefined; log: string };

export function ingest(runDate: string, options: { dryRun?: boolean } = {}): IngestResult {
  const args = ['ingest', runDate, ...(options.dryRun ? ['--dry-run'] : [])];
  const result = runBackend(args);
  return {
    ...result,
    report: lastJsonObject(result.stdout) as RunReport | undefined,
    log: `${result.stdout}\n${result.stderr}`,
  };
}

// Loads the fixture set of one coverage row (its Given) with the run marker in the
// names it creates; prints the fixture manifest as its last line. Isolation (round 19
// F6): each set is a complete Given: the seed resets the run records, the source
// configuration and the stored items of the local database to the base seed plus that
// set, so what a scenario sees is its own set whatever ran before it; scenarios run one at
// a time (the staged proposal workers 1 in pull-requests.md). The manifest echoes
// fixture_set and run, so a scenario never runs on another scenario's set. A seed that
// cannot load the set is a set-up failure, never a pass.
export function seed(fixtureSet: string, run: string): Record<string, unknown> {
  const result = runBackend(['seed', fixtureSet, run]);
  if (result.exitCode !== 0) {
    throw new Error(
      `The seed command could not load fixture set ${fixtureSet} (exit ${result.exitCode}): ${result.stderr.trim()}`,
    );
  }
  const manifest = lastJsonObject(result.stdout) ?? {};
  if (manifest.fixture_set !== fixtureSet || manifest.run !== run) {
    throw new Error(`The seed manifest does not echo fixture set ${fixtureSet} and run ${run}: ${JSON.stringify(manifest)}`);
  }
  return manifest;
}

export type MeasureResult = CommandResult & { report: Record<string, unknown> | undefined };

export function measure(): MeasureResult {
  const result = runBackend(['measure']);
  return { ...result, report: lastJsonObject(result.stdout) };
}

export type ScanReport = {
  scanned?: { path: string; files: number }[];
  secret_matches?: number;
  client_keys?: string[];
};

export type ScanResult = CommandResult & { report: ScanReport | undefined };

export function scanSecrets(paths: string[]): ScanResult {
  const result = runBackend(['scan-secrets', ...paths]);
  return { ...result, report: lastJsonObject(result.stdout) as ScanReport | undefined };
}
