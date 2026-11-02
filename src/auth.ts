// Supabase Auth through the local gateway: the development sign-in of a seeded persona
// (password sign-in, OD-21) and the creation of the personas through Auth's admin
// interface (the secret key, which the gateway turns into the service_role token).
import fs from 'node:fs';
import path from 'node:path';
import { repositoryRoot, requireEnv, UsageError } from './env.js';

export type Persona = 'owner' | 'second-user';
export const PERSONAS: Persona[] = ['owner', 'second-user'];
type Credentials = { email: string; password: string };

export function personaCredentials(persona: Persona): Credentials {
  const file = path.join(repositoryRoot, 'db', 'seed', 'personas.json');
  const all = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Credentials>;
  const credentials = all[persona];
  if (!credentials) throw new UsageError(`Unknown persona ${persona}; expected one of ${PERSONAS.join(', ')}.`);
  return credentials;
}

export function isPersona(value: string): value is Persona {
  return (PERSONAS as string[]).includes(value);
}

async function authRequest(method: string, route: string, key: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${requireEnv('SUPABASE_URL')}/auth/v1${route}`, {
    method,
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: response.status, json };
}

// The development sign-in: a password sign-in of the persona; returns the session's access token.
export async function signIn(persona: Persona): Promise<string> {
  const { email, password } = personaCredentials(persona);
  const result = await authRequest('POST', '/token?grant_type=password', requireEnv('PUBLISHABLE_KEY'), { email, password });
  const accessToken = (result.json as { access_token?: unknown } | undefined)?.access_token;
  if (result.status !== 200 || typeof accessToken !== 'string') {
    throw new Error(`Supabase Auth refused the sign-in of ${persona} (HTTP ${result.status}).`);
  }
  return accessToken;
}

type AuthUser = { id: string; email?: string };

// Creates the persona's Auth user, or resets its password to the seeded one; returns its id.
export async function ensurePersona(persona: Persona): Promise<string> {
  const { email, password } = personaCredentials(persona);
  const key = requireEnv('SECRET_KEY');
  const listed = await authRequest('GET', '/admin/users?page=1&per_page=1000', key);
  if (listed.status !== 200) throw new Error(`Supabase Auth refused the user listing (HTTP ${listed.status}).`);
  const users = ((listed.json as { users?: AuthUser[] } | undefined)?.users ?? []);
  const existing = users.find((user) => user.email === email);
  const result = existing
    ? await authRequest('PUT', `/admin/users/${existing.id}`, key, { password, email_confirm: true })
    : await authRequest('POST', '/admin/users', key, { email, password, email_confirm: true });
  const id = (result.json as AuthUser | undefined)?.id;
  if (result.status < 200 || result.status > 299 || typeof id !== 'string') {
    throw new Error(`Supabase Auth could not ${existing ? 'update' : 'create'} the persona ${persona} (HTTP ${result.status}).`);
  }
  return id;
}
