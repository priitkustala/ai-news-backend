#!/usr/bin/env node
// The command-line entry of ai-news-backend (E2E_BACKEND_COMMAND = node <repository>/dist/cli.js).
// Each subcommand prints its named output as one JSON object on the last line of standard
// output (tests/README-testids.md, Named commands and outputs); messages go to standard error.
import { loadLocalEnv, UsageError } from './env.js';
import { generateKeys } from './keys.js';
import { migrate } from './migrate.js';

const USAGE = `Usage: node dist/cli.js <command> [arguments]

Commands of the job and the local test environment:
  ingest <run-date> [--dry-run]     run the ingestion job for a date (YYYY-MM-DD); --dry-run writes nothing
  seed <fixture-set> <run-marker>   reset the local database to the base seed plus a fixture set
  sign-in <persona>                 development sign-in of a seeded persona; prints its access token

Set-up of the local test environment:
  keys                              generate this stack's local keys into the git-ignored .env files (once)
  migrate                           apply the migrations of db/migrations (safe to run again)
`;

const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const log = (line: string) => process.stderr.write(`${line}\n`);

class NotYetBuiltError extends Error {}

async function main(argv: string[]): Promise<void> {
  const [command] = argv;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE);
    return;
  }
  loadLocalEnv();
  switch (command) {
    case 'ingest':
    case 'seed':
    case 'sign-in':
      throw new NotYetBuiltError(`${command} is not built yet (priitkustala/ai-news#40).`);
    case 'keys': {
      const result = generateKeys();
      log(result.written.length > 0 ? `keys: wrote ${result.written.join(', ')}` : `keys: kept the existing ${result.kept.join(', ')}`);
      print(result);
      return;
    }
    case 'migrate':
      print(await migrate());
      return;
    default:
      throw new UsageError(`Unknown command ${command}.\n${USAGE}`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  log(`${error instanceof UsageError ? 'usage' : 'error'}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
