#!/usr/bin/env node
// The command-line entry of ai-news-backend (E2E_BACKEND_COMMAND = node <repository>/dist/cli.js).
// Each subcommand prints its named output as one JSON object on the last line of standard
// output (tests/README-testids.md, Named commands and outputs); messages go to standard error.
import { loadLocalEnv, UsageError } from './env.js';
import { PERSONAS } from './auth.js';
import { MeasureError } from './measure/sample.js';
import { COMMANDS, log } from './commands.js';

const USAGE = `Usage: node dist/cli.js <command> [arguments]

Commands of the job and the local test environment:
  ingest <run-date> [--dry-run] [--runner cloud|laptop]
                                    run the ingestion job for a date (YYYY-MM-DD) on the sources of its runner: cloud
                                    (the scheduled job, the default) or laptop; --dry-run writes nothing
  notify <run-date>                 send the run date's one push notification to the owner's subscriptions (YYYY-MM-DD)
  summaries-pending [--limit N]     list the items without a usable summary, newest first (default 30), one JSON line each
  summaries-apply                   store model-written summaries read as JSON lines of id and text on standard input
  digest                            write a model digest for every pending feed item within a 15-minute budget (DIGEST_API_KEY; none: skipped)
  seed <fixture-set> <run-marker>   reset the local database to the base seed plus a fixture set
  sign-in <persona>                 development sign-in of a seeded persona (${PERSONAS.join(', ')}); prints its access token
  scan-secrets <path>...            scan a repository, a folder or a file for this stack's seeded secrets
                                    (counts and pattern names only) and the key kinds a built client carries
  measure [--sample-dir <folder>]   run the pipeline on the frozen validation sample (fixtures/validation-sample/, or the
                                    sample.json and labels.json of a folder git does not track) and print the measurement
                                    report: values only, no verdict (OD-26)
  draw-sample --sources <file> --out <folder>
                                    fetch each source of the file once and write a frozen 7-day sample (at most 20 items per
                                    source) with unlabelled labels.json and labelling-table.md into a new folder git does not
                                    track; prints source ids, counts, bytes and hashes only

Set-up of the local test environment:
  keys                              generate this stack's local keys into the git-ignored .env files (once)
  migrate                           apply the migrations, create the personas and load the base seed (safe to run again)
  apply-migrations [--dry-run]       apply only the pending migrations (no password, persona or seed); --dry-run applies them and rolls everything back
  seed-sources <file>               replace the configured sources with the rows of a sources file (the format of
                                    config/sources.json); loads no item (safe to run again)
  check-migration <sql-file>        apply a migration-shaped file as migrate would, report the owner-only check's
                                    verdict and findings, and roll everything back (scenarios of the guard)

Exit status: 0 done; 1 failed (for ingest: the run could not finish its writes; for measure: the sample cannot be measured;
for draw-sample: no source has an item inside the window); 2 usage;
3 ingest: the run is persisted as reported, but a read for the report failed after the commit.
scan-secrets exits 1 when it finds a seeded secret (the report is printed first).
notify exits 1 when subscriptions existed and none went through (the report is printed first).
`;

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE);
    return;
  }
  loadLocalEnv();
  const entry = COMMANDS.get(command);
  if (!entry) throw new UsageError(`Unknown command ${command}.\n${USAGE}`);
  await entry.run(entry.parse(args));
}

main(process.argv.slice(2)).catch((error: unknown) => {
  log(`${error instanceof UsageError ? 'usage' : error instanceof MeasureError ? 'measure' : 'error'}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
