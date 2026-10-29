// The data interface the client uses: the Data API and sign-in of the local Supabase
// interface over the exposed schema (Locked, Architecture; Local test environment, row
// Data interface). Scenarios read and write only through it, with the local publishable
// key and, where a persona is signed in, that persona's session. The database is never
// read. Header names, status codes and the Prefer header follow Supabase's Data API
// (PostgREST) (UNVERIFIED; check: 40c and 40d pass against the stack #40 builds, and the
// PostgREST error and preference pages are read at #40's Brief).
import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
import { lastJsonObject, runBackend } from './backend';
import { requireEnv } from './env';

export type Persona = 'owner' | 'second-user';
export type Row = Record<string, unknown>;
// malformed: a 200 answer whose body is not a JSON array of rows; never read as an empty result.
// Scenarios take rows only through expectRows below.
export type ReadResult = { status: number; rows: Row[]; malformed: boolean };
export type WriteResult = { status: number; rows: Row[] | undefined; body: string };

// The development sign-in (Locked, Local test environment) for a seeded persona: the
// command prints {"access_token": "..."} as its last line. The method is OD-21's.
export function signIn(persona: Persona): string {
  const result = runBackend(['sign-in', persona]);
  const token = lastJsonObject(result.stdout)?.access_token;
  if (result.exitCode !== 0 || typeof token !== 'string' || token === '') {
    throw new Error(`The development sign-in for ${persona} returned no session (exit ${result.exitCode}).`);
  }
  return token;
}

function headers(token?: string): Record<string, string> {
  const key = requireEnv('E2E_PUBLISHABLE_KEY', 'the local publishable key of the local Supabase interface');
  return token ? { apikey: key, Authorization: `Bearer ${token}` } : { apikey: key };
}

export function dataUrl(): string {
  return requireEnv('E2E_DATA_URL', 'the Data API address of the local Supabase interface').replace(/\/+$/, '');
}

// filter is a Data API row filter such as `item_id=eq.<id>`; without it the whole relation is read.
export async function readRelation(
  request: APIRequestContext,
  relation: string,
  token?: string,
  filter?: string,
): Promise<ReadResult> {
  const query = filter ? `select=*&${filter}` : 'select=*';
  const response = await request.get(`${dataUrl()}/${relation}?${query}`, { headers: headers(token) });
  if (response.status() !== 200) {
    return { status: response.status(), rows: [], malformed: false };
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const ok = Array.isArray(body) && body.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row));
  return { status: 200, rows: ok ? (body as Row[]) : [], malformed: !ok };
}

// The one way a scenario uses the rows of a read (round 20 R20-3): the read must be a
// successful, well-formed list (status 200, malformed false) before any absence, equality
// or count is taken from it, so an empty or invalid answer is never evidence. A refusal is
// judged by isRefusedOrEmpty instead, never through this helper.
export function expectRows(result: ReadResult, why: string): Row[] {
  expect(result.status, `${why}: the read answers 200`).toBe(200);
  expect(result.malformed, `${why}: the read answers a well-formed list of rows`).toBe(false);
  return result.rows;
}

// A read in a message: its status and its row count, or that it was malformed.
export function describeRead(result: ReadResult): string {
  return `${result.status}, ${result.malformed ? 'malformed body' : `${result.rows.length} rows`}`;
}

// A write that asks for the affected rows back (Prefer: return=representation), so that a
// write the row-level security filters to no row is told apart from one that changed a row.
export async function writeRelation(
  request: APIRequestContext,
  relation: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: Row,
  token?: string,
  filter?: string,
): Promise<WriteResult> {
  const response = await request.fetch(`${dataUrl()}/${relation}${filter ? `?${filter}` : ''}`, {
    method,
    headers: { ...headers(token), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    data: method === 'DELETE' ? undefined : body,
  });
  const text = await response.text();
  let rows: Row[] | undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    rows = Array.isArray(parsed) ? (parsed as Row[]) : undefined;
  } catch {
    rows = undefined;
  }
  return { status: response.status(), rows, body: text };
}

// A read the interface refuses (401 or 403) or answers with a well-formed empty list. A
// relation missing from the exposed schema (404), a malformed 200 body or a server error
// is not a refusal.
export function isRefusedOrEmpty(result: ReadResult): boolean {
  return result.status === 401 || result.status === 403 || (result.status === 200 && !result.malformed && result.rows.length === 0);
}

// An authorization refusal of a write: 401 or 403 from the interface. A malformed payload
// (400), an unknown relation (404), a conflict (409) or a server error (5xx) is not one.
export function isAuthorizationRefusal(result: WriteResult): boolean {
  return result.status === 401 || result.status === 403;
}

// A refused update or delete: an authorization refusal, or an answer that affected no row
// (the row-level security filtered the target out), confirmed by a readback by the caller.
export function affectedNoRow(result: WriteResult): boolean {
  return isAuthorizationRefusal(result) || (result.status >= 200 && result.status < 300 && (result.rows ?? []).length === 0);
}

export function titleOf(row: Row): string {
  return typeof row.title === 'string' ? row.title : '';
}

// The bookmark the client writes for an item (Locked, Data model: Bookmark: item id,
// created_at, title, link, summary as shown; one row per item), under the owner's session.
export function bookmarkFor(item: Row): Row {
  return { item_id: item.id, title: item.title, link: item.canonical_url, summary: item.summary ?? null };
}
