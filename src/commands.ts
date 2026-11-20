// The commands of the command line (priitkustala/ai-news-backend#96), one entry per command: parse
// takes the argument list and returns the command's options or throws the UsageError of its
// refusal, and run does the work with those options. A new command is a new entry here (and its
// line in the usage text of src/cli.ts); main in src/cli.ts is not touched. A Map and not a plain
// object, so that names such as constructor, toString or __proto__ find no entry.
import { UsageError } from './env.js';
import { generateKeys } from './keys.js';
import { applyMigrations, checkMigration, migrate } from './migrate.js';
import { seed } from './seed.js';
import { seedSources } from './seed-sources.js';
import { isPersona, PERSONAS, signIn } from './auth.js';
import { ingest, isRunner, parseRunDate, RUNNERS, type Runner } from './ingest/ingest.js';
import { scanSecrets } from './scan/scan.js';
import { notify } from './notify/notify.js';
import { measure } from './measure/measure.js';
import { drawSample } from './measure/draw.js';
import { sampleFolder } from './measure/sample.js';
import { summariesApply, summariesPending } from './summaries.js';
import { digest } from './digest/digest.js';

export const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
export const log = (line: string) => process.stderr.write(`${line}\n`);

export type Command<Options> = {
  parse(args: string[]): Options;
  run(options: Options): Promise<void>;
};

// Keeps each entry's own options type while the table holds them all.
const command = <Options>(entry: Command<Options>): Command<unknown> => entry;

export const COMMANDS: ReadonlyMap<string, Command<unknown>> = new Map([
  ['ingest', command({
    parse: (args) => {
      const dryRun = args.includes('--dry-run');
      const rest = args.filter((arg) => arg !== '--dry-run');
      let runner: Runner = 'cloud';
      const at = rest.indexOf('--runner');
      if (at >= 0) {
        const value = rest[at + 1];
        if (!isRunner(value) || rest.indexOf('--runner', at + 1) >= 0) {
          throw new UsageError(`ingest takes --runner once, followed by ${RUNNERS.join(' or ')}.`);
        }
        runner = value;
        rest.splice(at, 2);
      }
      if (rest.length !== 1) throw new UsageError('ingest takes one run date, the optional --dry-run flag and the optional --runner cloud|laptop.');
      return { runDate: parseRunDate(rest[0]), dryRun, runner };
    },
    run: async ({ runDate, dryRun, runner }) => {
      const report = await ingest(runDate, dryRun, log, runner);
      print(report);
      // A run that could not finish its own writes is a failure of the job, not of a source.
      if (report.error) process.exitCode = 1;
      // The run is persisted as reported, but a read for the report failed after the commit.
      else if (report.report_error) process.exitCode = 3;
    },
  })],
  ['notify', command({
    parse: (args) => {
      if (args.length !== 1) throw new UsageError('notify takes one run date.');
      return { runDate: parseRunDate(args[0]) };
    },
    run: async ({ runDate }) => {
      const report = await notify(runDate, log);
      print(report);
      if (report.status === 'failed') process.exitCode = 1;
    },
  })],
  ['summaries-pending', command({
    parse: (args) => {
      let limit: number | undefined;
      if (args.length === 2 && args[0] === '--limit' && /^[1-9][0-9]*$/.test(args[1]) && Number.isSafeInteger(Number(args[1]))) {
        limit = Number(args[1]);
      } else if (args.length !== 0) {
        throw new UsageError('summaries-pending takes no argument or --limit N with N a positive whole number.');
      }
      return { limit };
    },
    run: async ({ limit }) => {
      for (const row of await summariesPending(limit)) print(row);
    },
  })],
  ['summaries-apply', command({
    parse: (args) => {
      if (args.length !== 0) throw new UsageError('summaries-apply takes no argument; it reads JSON lines on standard input.');
      return {};
    },
    run: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      print(await summariesApply(Buffer.concat(chunks).toString('utf8'), log));
    },
  })],
  ['digest', command({
    parse: (args) => {
      if (args.length !== 0) throw new UsageError('digest takes no argument.');
      return {};
    },
    run: async () => {
      // done, skipped (no key) and stopped (the model's interface failed) all exit 0.
      print(await digest(log));
    },
  })],
  ['seed', command({
    parse: (args) => {
      if (args.length !== 2) throw new UsageError('seed takes a fixture set and a run marker.');
      return { fixtureSet: args[0], runMarker: args[1] };
    },
    run: async ({ fixtureSet, runMarker }) => {
      print(await seed(fixtureSet, runMarker));
    },
  })],
  ['seed-sources', command({
    parse: (args) => {
      if (args.length !== 1) throw new UsageError('seed-sources takes one sources file.');
      return { file: args[0] };
    },
    run: async ({ file }) => {
      print(await seedSources(file));
    },
  })],
  ['sign-in', command({
    parse: (args) => {
      const [persona] = args;
      if (args.length !== 1 || !isPersona(persona)) throw new UsageError(`sign-in takes one persona: ${PERSONAS.join(' or ')}.`);
      return { persona };
    },
    run: async ({ persona }) => {
      print({ access_token: await signIn(persona) });
    },
  })],
  ['scan-secrets', command({
    parse: (args) => ({ paths: args }),
    run: async ({ paths }) => {
      const report = scanSecrets(paths, process.env, log);
      print(report);
      if (report.secret_matches > 0) process.exitCode = 1;
    },
  })],
  ['measure', command({
    parse: (args) => {
      if (args.length === 0) return { folder: undefined };
      if (args.length !== 2 || args[0] !== '--sample-dir') throw new UsageError('measure takes no argument or exactly --sample-dir <folder>.');
      return { folder: args[1] };
    },
    run: async ({ folder }) => {
      if (folder === undefined) {
        print(measure(log));
        return;
      }
      print(measure(log, sampleFolder(folder)));
    },
  })],
  ['draw-sample', command({
    parse: (args) => {
      const sources = args.length === 4 && args[0] === '--sources' ? args[1] : args.length === 4 && args[2] === '--sources' ? args[3] : undefined;
      const out = args.length === 4 && args[0] === '--out' ? args[1] : args.length === 4 && args[2] === '--out' ? args[3] : undefined;
      if (sources === undefined || out === undefined) throw new UsageError('draw-sample takes exactly --sources <file> --out <folder>.');
      return { sources, out };
    },
    run: async ({ sources, out }) => {
      print(await drawSample(sources, out, log));
    },
  })],
  ['keys', command({
    parse: () => ({}),
    run: async () => {
      const result = generateKeys();
      log(result.written.length > 0 ? `keys: wrote ${result.written.join(', ')}` : `keys: kept the existing ${result.kept.join(', ')}`);
      print(result);
    },
  })],
  ['migrate', command({
    parse: () => ({}),
    run: async () => {
      print(await migrate());
    },
  })],
  ['apply-migrations', command({
    parse: (args) => {
      if (args.length > 1 || (args.length === 1 && args[0] !== '--dry-run')) throw new UsageError('apply-migrations takes no argument or --dry-run.');
      return { dryRun: args.length === 1 };
    },
    run: async ({ dryRun }) => {
      const report = await applyMigrations({ dryRun });
      print(report);
      if (report.failed !== null || report.error_code !== null || report.owner_only_findings > 0) process.exitCode = 1;
    },
  })],
  ['check-migration', command({
    parse: (args) => {
      if (args.length !== 1) throw new UsageError('check-migration takes one SQL file.');
      return { file: args[0] };
    },
    run: async ({ file }) => {
      print(await checkMigration(file));
    },
  })],
]);
