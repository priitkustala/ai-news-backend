// The local environment of the command. `node dist/cli.js keys` writes the git-ignored
// .env.local at the repository root; it is loaded here when present, and a value already
// set in the process environment wins (the scheduled workflow sets its own).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const localEnvFile = path.join(repositoryRoot, '.env.local');

export function loadLocalEnv(): void {
  if (fs.existsSync(localEnvFile)) process.loadEnvFile(localEnvFile);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new UsageError(`${name} is not set. Run \`node dist/cli.js keys\` once in this checkout, or set it.`);
  }
  return value;
}

// An error the command reports as one line on standard error, without a stack.
export class UsageError extends Error {}
