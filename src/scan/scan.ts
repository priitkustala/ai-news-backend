// `scan-secrets <path>...` (priitkustala/ai-news#43, S-05, AC-20d and AC-20e): scans files for
// strings equal to this stack's seeded secrets (the database passwords, the Supabase secret key
// and, once a story seeds it, the Reddit app secret; the push signing key, pattern
// push-signing-key, priitkustala/ai-news#50) and reports the key kinds a built client
// carries. Values are read from the environment of this checkout (`.env.local`, written by
// `keys`); the report holds counts, pattern names and paths only, never a value.
//
// What a path stands for:
// - the top level of a git work tree: the repository, i.e. its tracked files and its untracked
//   files that are not git-ignored (`git ls-files --cached --others --exclude-standard`). The
//   git-ignored key files (`.env.local`, `.env.stack-*`) are where the secrets live by design
//   and never enter the repository, so they are not part of it; `node_modules/` and `dist/`
//   likewise;
// - any other folder (a built client, a log folder): every regular file under it, `.git` excepted;
// - a file (a captured job log): that file.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { UsageError } from '../env.js';

type Secret = { name: string; values: string[] };

export type ScanEntry = { path: string; mode: 'repository' | 'folder' | 'file'; files: number; secret_matches: number; client_keys: string[] };

export type ScanReport = {
  scanned: ScanEntry[];
  secret_matches: number;
  client_keys: string[];
  patterns: { name: string; configured: boolean; matches: number }[];
};

// The password part of a postgres:// address, without printing or logging it.
function urlPassword(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const password = decodeURIComponent(new URL(value).password);
    return password || undefined;
  } catch {
    return undefined;
  }
}

// Too short a value would match by accident; every generated value is far longer.
const MIN_SECRET_LENGTH = 12;

function secretsFromEnv(env: NodeJS.ProcessEnv): Secret[] {
  const keep = (values: (string | undefined)[]) =>
    [...new Set(values.filter((v): v is string => typeof v === 'string' && v.length >= MIN_SECRET_LENGTH))];
  return [
    {
      name: 'database-password',
      values: keep([urlPassword(env.MIGRATION_DATABASE_URL), urlPassword(env.DATABASE_URL), env.INGEST_DB_PASSWORD]),
    },
    { name: 'secret-key', values: keep([env.SECRET_KEY]) },
    { name: 'reddit-secret', values: keep([env.REDDIT_CLIENT_SECRET]) },
    { name: 'push-signing-key', values: keep([env.PUSH_VAPID_PRIVATE_KEY]) },
  ];
}

// Key kinds a client may carry: Supabase's opaque keys by their prefix, and the legacy JWT keys
// by the role claim they sign. Only `publishable` (or the legacy `anon`) belongs in a client.
const OPAQUE_KEY = /sb_(publishable|secret)_[A-Za-z0-9_-]{16,}/g;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{16,}/g;

function clientKeyKinds(text: string, publishable: string | undefined): Set<string> {
  const kinds = new Set<string>();
  for (const match of text.matchAll(OPAQUE_KEY)) kinds.add(match[1]);
  for (const match of text.matchAll(JWT)) {
    try {
      const role = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')).role;
      if (role === 'anon') kinds.add('anon-jwt');
      else if (role === 'service_role') kinds.add('service-role-jwt');
    } catch {
      // not a token of ours
    }
  }
  if (publishable && publishable.length >= MIN_SECRET_LENGTH && text.includes(publishable)) kinds.add('publishable');
  return kinds;
}

function countOccurrences(haystack: Buffer, needle: Buffer): number {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

function isWorkTreeTop(folder: string): boolean {
  return fs.existsSync(path.join(folder, '.git'));
}

function repositoryFiles(folder: string): string[] {
  const out = execFileSync('git', ['-C', folder, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return out
    .split('\0')
    .filter(Boolean)
    .map((file) => path.join(folder, file))
    // a tracked file deleted in the work tree, or a submodule, is not a file to read
    .filter((file) => fs.lstatSync(file, { throwIfNoEntry: false })?.isFile());
}

function folderFiles(folder: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true, recursive: true })) {
    const full = path.join(entry.parentPath, entry.name);
    if (full.split(path.sep).includes('.git')) continue;
    if (entry.isFile()) files.push(full);
  }
  return files;
}

export function scanSecrets(paths: string[], env: NodeJS.ProcessEnv = process.env, log: (line: string) => void = () => {}): ScanReport {
  if (paths.length === 0) throw new UsageError('scan-secrets takes one or more paths (a repository, a folder or a file).');
  const secrets = secretsFromEnv(env);
  // A scan without the seeded values to look for would pass vacuously.
  for (const required of ['database-password', 'secret-key']) {
    if (secrets.find((s) => s.name === required)!.values.length === 0) {
      throw new UsageError(`the ${required} of this stack is not set. Run \`node dist/cli.js keys\` once in this checkout.`);
    }
  }
  const needles = secrets.map((s) => ({ name: s.name, values: s.values.map((v) => Buffer.from(v, 'utf8')) }));
  const matchesByPattern = new Map(secrets.map((s) => [s.name, 0]));
  const publishable = env.PUBLISHABLE_KEY;

  const scanned: ScanEntry[] = [];
  for (const given of paths) {
    const target = path.resolve(given);
    const stat = fs.statSync(target, { throwIfNoEntry: false });
    if (!stat) throw new UsageError(`${given} does not exist.`);
    const mode = stat.isDirectory() ? (isWorkTreeTop(target) ? 'repository' : 'folder') : 'file';
    const files = mode === 'repository' ? repositoryFiles(target) : mode === 'folder' ? folderFiles(target) : [target];
    let matches = 0;
    const kinds = new Set<string>();
    for (const file of files) {
      const content = fs.readFileSync(file);
      for (const needle of needles) {
        const found = needle.values.reduce((sum, value) => sum + countOccurrences(content, value), 0);
        if (found > 0) {
          matches += found;
          matchesByPattern.set(needle.name, matchesByPattern.get(needle.name)! + found);
          // the file is named so that it can be cleaned; the value never is
          log(`scan-secrets: ${needle.name} found ${found} time(s) in ${path.relative(process.cwd(), file) || file}`);
        }
      }
      for (const kind of clientKeyKinds(content.toString('latin1'), publishable)) kinds.add(kind);
    }
    log(`scan-secrets: ${mode} ${target}: ${files.length} files, ${matches} secret matches`);
    scanned.push({ path: target, mode, files: files.length, secret_matches: matches, client_keys: [...kinds].sort() });
  }

  const allKinds = new Set(scanned.flatMap((entry) => entry.client_keys));
  return {
    scanned,
    secret_matches: scanned.reduce((sum, entry) => sum + entry.secret_matches, 0),
    client_keys: [...allKinds].sort(),
    patterns: secrets.map((s) => ({ name: s.name, configured: s.values.length > 0, matches: matchesByPattern.get(s.name)! })),
  };
}
