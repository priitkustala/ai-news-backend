// Runs the backend's commands the way the scheduled workflow and the owner run them.
// E2E_BACKEND_COMMAND is the command line that starts the backend's command-line entry
// in this checkout; #40 writes it into e2e/README.md. The subcommands the scenarios
// call are listed in tests/README-testids.md (Named commands and outputs).
import { spawnSync } from 'node:child_process';
import { requireEnv } from './env';

export type CommandResult = { exitCode: number | null; stdout: string; stderr: string };

function quote(arg: string): string {
  return /^[A-Za-z0-9_./:=@-]+$/.test(arg) ? arg : `"${arg.replace(/(["\\$`])/g, '\\$1')}"`;
}

export function runBackend(args: string[], env: Record<string, string> = {}): CommandResult {
  const prefix = requireEnv('E2E_BACKEND_COMMAND', "the command line of the backend's command-line entry");
  const line = [prefix, ...args.map(quote)].join(' ');
  const result = spawnSync(line, {
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 10 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`Could not start "${line}": ${result.error.message}`);
  }
  return { exitCode: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

// The last line of standard output that parses as a JSON object, or undefined.
// Every named output of tests/README-testids.md is printed this way.
export function lastJsonObject(stdout: string): Record<string, unknown> | undefined {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const value: unknown = JSON.parse(lines[i]);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // not JSON; keep looking upwards
    }
  }
  return undefined;
}
