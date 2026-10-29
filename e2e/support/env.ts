// Values the scenarios need from the local test environment. None is guessed here:
// the environment bootstrap story (#40) writes each value into e2e/README.md
// (section Variables the scenarios read). An unset value fails the scenario with
// an error that names it.
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export function requireEnv(name: string, what: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set (${what}). The environment bootstrap story (#40) writes its value ` +
        'into e2e/README.md, section Variables the scenarios read.',
    );
  }
  return value;
}

// A marker unique to this run, put into the names of the data a scenario creates
// (regression contract, Scenario rules 4).
export function runMarker(): string {
  return `e2e-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

// Today's run date (YYYY-MM-DD) in the run time zone. The time zone is OD-09 (OPEN),
// so it is read from the environment and never assumed.
export function runDateToday(): string {
  const timeZone = requireEnv('E2E_RUN_TIME_ZONE', 'the run time zone of OD-09');
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
}

// The repository this e2e/ folder belongs to (support/ sits in <repository>/e2e/support).
export function repositoryRoot(): string {
  return path.resolve(__dirname, '..', '..');
}
