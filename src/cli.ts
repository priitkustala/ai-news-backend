#!/usr/bin/env node
// The command-line entry of ai-news-backend (E2E_BACKEND_COMMAND = node <repository>/dist/cli.js).
// Each subcommand prints its named output as one JSON object on the last line of standard
// output (tests/README-testids.md, Named commands and outputs); messages go to standard error.
import { loadLocalEnv, UsageError } from './env.js';
import { generateKeys } from './keys.js';
import { checkMigration, migrate } from './migrate.js';
import { seed } from './seed.js';
import { isPersona, PERSONAS, signIn } from './auth.js';
import { ingest, parseRunDate } from './ingest/ingest.js';
import { scanSecrets } from './scan/scan.js';
import { notify } from './notify/notify.js';
import { measure } from './measure/measure.js';
import { drawSample } from './measure/draw.js';
import { MeasureError, sampleFolder } from './measure/sample.js';

const USAGE = `Usage: node dist/cli.js <command> [arguments]

Commands of the job and the local test environment:
  ingest <run-date> [--dry-run]     run the ingestion job for a date (YYYY-MM-DD); --dry-run writes nothing
  notify <run-date>                 send the run date's one push notification to the owner's subscriptions (YYYY-MM-DD)
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
  check-migration <sql-file>        apply a migration-shaped file as migrate would, report the owner-only check's
                                    verdict and findings, and roll everything back (scenarios of the guard)

Exit status: 0 done; 1 failed (for ingest: the run could not finish its writes; for measure: the sample cannot be measured;
for draw-sample: no source has an item inside the window); 2 usage;
3 ingest: the run is persisted as reported, but a read for the report failed after the commit.
scan-secrets exits 1 when it finds a seeded secret (the report is printed first).
notify exits 1 when subscriptions existed and none went through (the report is printed first).
`;

const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const log = (line: string) => process.stderr.write(`${line}\n`);

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE);
    return;
  }
  loadLocalEnv();
  switch (command) {
    case 'ingest': {
      const dryRun = args.includes('--dry-run');
      const rest = args.filter((arg) => arg !== '--dry-run');
      if (rest.length !== 1) throw new UsageError('ingest takes one run date and the optional --dry-run flag.');
      const report = await ingest(parseRunDate(rest[0]), dryRun, log);
      print(report);
      // A run that could not finish its own writes is a failure of the job, not of a source.
      if (report.error) process.exitCode = 1;
      // The run is persisted as reported, but a read for the report failed after the commit.
      else if (report.report_error) process.exitCode = 3;
      return;
    }
    case 'notify': {
      if (args.length !== 1) throw new UsageError('notify takes one run date.');
      const report = await notify(parseRunDate(args[0]), log);
      print(report);
      if (report.status === 'failed') process.exitCode = 1;
      return;
    }
    case 'seed': {
      if (args.length !== 2) throw new UsageError('seed takes a fixture set and a run marker.');
      print(await seed(args[0], args[1]));
      return;
    }
    case 'sign-in': {
      const [persona] = args;
      if (args.length !== 1 || !isPersona(persona)) throw new UsageError(`sign-in takes one persona: ${PERSONAS.join(' or ')}.`);
      print({ access_token: await signIn(persona) });
      return;
    }
    case 'scan-secrets': {
      const report = scanSecrets(args, process.env, log);
      print(report);
      if (report.secret_matches > 0) process.exitCode = 1;
      return;
    }
    case 'measure': {
      if (args.length === 0) {
        print(measure(log));
        return;
      }
      if (args.length !== 2 || args[0] !== '--sample-dir') throw new UsageError('measure takes no argument or exactly --sample-dir <folder>.');
      print(measure(log, sampleFolder(args[1])));
      return;
    }
    case 'draw-sample': {
      const sources = args.length === 4 && args[0] === '--sources' ? args[1] : args.length === 4 && args[2] === '--sources' ? args[3] : undefined;
      const out = args.length === 4 && args[0] === '--out' ? args[1] : args.length === 4 && args[2] === '--out' ? args[3] : undefined;
      if (sources === undefined || out === undefined) throw new UsageError('draw-sample takes exactly --sources <file> --out <folder>.');
      print(await drawSample(sources, out, log));
      return;
    }
    case 'keys': {
      const result = generateKeys();
      log(result.written.length > 0 ? `keys: wrote ${result.written.join(', ')}` : `keys: kept the existing ${result.kept.join(', ')}`);
      print(result);
      return;
    }
    case 'migrate':
      print(await migrate());
      return;
    case 'check-migration': {
      if (args.length !== 1) throw new UsageError('check-migration takes one SQL file.');
      print(await checkMigration(args[0]));
      return;
    }
    default:
      throw new UsageError(`Unknown command ${command}.\n${USAGE}`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  log(`${error instanceof UsageError ? 'usage' : error instanceof MeasureError ? 'measure' : 'error'}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
