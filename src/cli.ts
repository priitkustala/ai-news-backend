#!/usr/bin/env node
// The command-line entry of ai-news-backend (E2E_BACKEND_COMMAND = node <repository>/dist/cli.js).
// Each subcommand prints its named output as one JSON object on the last line of standard
// output (tests/README-testids.md, Named commands and outputs); messages go to standard error.
import { loadLocalEnv, UsageError } from './env.js';

const USAGE = `Usage: node dist/cli.js <command> [arguments]

Commands of the job and the local test environment:
  ingest <run-date> [--dry-run]     run the ingestion job for a date (YYYY-MM-DD); --dry-run writes nothing
  seed <fixture-set> <run-marker>   reset the local database to the base seed plus a fixture set
  sign-in <persona>                 development sign-in of a seeded persona; prints its access token
`;

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
    default:
      throw new UsageError(`Unknown command ${command}.\n${USAGE}`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  log(`${error instanceof UsageError ? 'usage' : 'error'}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
