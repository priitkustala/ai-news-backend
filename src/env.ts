// The local environment of the command. `node dist/cli.js keys` writes local.env into the
// memory folder AI_NEWS_SECRETS_DIR (priitkustala/ai-news#92); it is loaded here when present,
// then the git-ignored .env.local of a checkout not yet moved fills what is missing, and a
// value already set in the process environment wins (the scheduled workflow sets its own).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const localEnvFile = path.join(repositoryRoot, '.env.local');

export function loadLocalEnv(): void {
  const secretsDir = process.env.AI_NEWS_SECRETS_DIR;
  const files = [...(secretsDir ? [path.join(secretsDir, 'local.env')] : []), localEnvFile];
  for (const file of files) if (fs.existsSync(file)) process.loadEnvFile(file);
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
