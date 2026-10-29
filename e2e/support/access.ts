// The owner-only access checks of AC-20 (43), kind invariant (sprint-02.md section 2.3,
// amendment 01): the bootstrap stack (#40) already carries the production-equivalent exposed
// schema, grants and row-level security (Locked, Local test environment; S-01, Invariants),
// so these pass once #40 is built and keep passing after every later story.
import { createHash, randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
import { requireEnv } from './env';
import {
  affectedNoRow,
  bookmarkFor,
  expectRows,
  isAuthorizationRefusal,
  isRefusedOrEmpty,
  readRelation,
  titleOf,
  writeRelation,
  type ReadResult,
  type Row,
  type WriteResult,
} from './data';

// The declared exposed schema (Locked, Architecture, Interface between job and client):
// always the five below; briefings and push_subscriptions only as OD-08 (OPEN) decides.
// E2E_OD08 names the decided state for the stack under test: undecided, briefing, push or
// both; #40 writes undecided, the Brief that takes OD-08 changes it. Every declared
// relation must be present: a 404 fails, it is never skipped.
const ALWAYS = ['feed', 'categories', 'items', 'bookmarks', 'ingestion_runs'];
const BY_OD08: Record<string, string[]> = {
  undecided: [],
  briefing: ['briefings'],
  push: ['push_subscriptions'],
  both: ['briefings', 'push_subscriptions'],
};
export function exposedRelations(): string[] {
  const choice = requireEnv('E2E_OD08', 'the OD-08 state of the stack under test: undecided, briefing, push or both');
  const extra = BY_OD08[choice];
  if (!extra) throw new Error(`E2E_OD08 is ${choice}; expected undecided, briefing, push or both.`);
  return [...ALWAYS, ...extra];
}

// The column that identifies one row of each relation, and a column a write changes
// (Locked, Data model; spellings UNVERIFIED as in tests/README-testids.md).
const KEY: Record<string, string> = {
  feed: 'id', categories: 'id', items: 'id', bookmarks: 'item_id', ingestion_runs: 'run_date',
  briefings: 'run_date', push_subscriptions: 'id',
};
const FIELD: Record<string, string> = {
  feed: 'title', categories: 'name', items: 'title', bookmarks: 'title', ingestion_runs: 'status',
  briefings: 'run_date', push_subscriptions: 'endpoint',
};
// Views of the exposed schema: a write to one is refused as a write to a read-only relation.
const VIEWS = ['feed', 'categories'];

export function keyFilter(relation: string, row: Row): string {
  return `${KEY[relation]}=eq.${encodeURIComponent(String(row[KEY[relation]]))}`;
}

// A relation-valid insert payload unique to this run: an owner row of the relation with its
// identifying fields replaced, so that a refusal cannot come from a duplicate or an unknown
// column. Fields the database generates (created_at) are dropped.
export function uniqueRow(relation: string, sample: Row, run: string): Row {
  const row: Row = { ...sample };
  delete row.created_at;
  const url = `https://fixtures.invalid/${run}/${relation}`;
  const date = `2099-${String(1 + (parseInt(run.slice(-2), 16) % 12)).padStart(2, '0')}-${String(1 + (parseInt(run.slice(-4, -2), 16) % 28)).padStart(2, '0')}`;
  switch (relation) {
    case 'items':
    case 'feed':
      row.canonical_url = url;
      row.id = createHash('sha256').update(url).digest('hex');
      row.title = `${run}-write`;
      break;
    case 'categories':
      row.id = `${run}-category`;
      row.name = `${run}-category`;
      break;
    case 'ingestion_runs':
    case 'briefings':
      row.run_date = date;
      if ('id' in row) row.id = typeof row.id === 'number' ? undefined : randomUUID();
      break;
    case 'push_subscriptions':
      row.id = typeof row.id === 'number' ? undefined : randomUUID();
      row.endpoint = url;
      break;
    default:
      throw new Error(`No unique payload is defined for ${relation}.`);
  }
  for (const name of Object.keys(row)) if (row[name] === undefined) delete row[name];
  return row;
}

// A seeded item whose title carries fragment, read with the owner's session.
export async function seededItem(request: APIRequestContext, owner: string, fragment: string): Promise<Row> {
  const items = expectRows(await readRelation(request, 'items', owner), 'prerequisite: the owner reads items');
  const item = items.find((row) => titleOf(row).includes(fragment));
  expect(item, `prerequisite: the seed loaded an item titled with ${fragment} (fixture set)`).toBeDefined();
  return item as Row;
}

// The filter that finds the row a unique payload would have created.
function payloadFilter(relation: string, payload: Row): string {
  const column = relation === 'bookmarks' ? 'item_id' : relation === 'push_subscriptions' ? 'endpoint' : KEY[relation];
  return `${column}=eq.${encodeURIComponent(String(payload[column]))}`;
}

// Owner rows in every declared relation, so that an empty answer to another persona is
// evidence of the security policy and never of an empty relation. The client-written
// relations get one row written as the client writes it, read back with the owner's
// session; a failed write or readback is a failed prerequisite, never the row's Then.
export async function ownerRowsEverywhere(
  request: APIRequestContext,
  owner: string,
  run: string,
  relations: string[],
): Promise<Record<string, Row[]>> {
  const item = await seededItem(request, owner, `${run}-a`);
  const bookmark = await writeRelation(request, 'bookmarks', 'POST', bookmarkFor(item), owner);
  expect(bookmark.status, `prerequisite: the owner's bookmark insert succeeds (${bookmark.body.slice(0, 200)})`).toBe(201);
  if (relations.includes('push_subscriptions')) {
    const sub = { endpoint: `https://fixtures.invalid/${run}/push`, keys: { p256dh: `${run}-p256dh`, auth: `${run}-auth` } };
    const push = await writeRelation(request, 'push_subscriptions', 'POST', sub, owner);
    expect(push.status, `prerequisite: the owner's push subscription insert succeeds (${push.body.slice(0, 200)})`).toBe(201);
  }
  const seen: Record<string, Row[]> = {};
  for (const relation of relations) {
    const rows = expectRows(await readRelation(request, relation, owner), `prerequisite: ${relation} is in the exposed schema and the owner reads it`);
    expect(rows.length, `prerequisite: ${relation} holds an owner row`).toBeGreaterThan(0);
    seen[relation] = rows;
  }
  return seen;
}

export type AccessProbe = {
  relation: string;
  read: ReadResult;
  insert: WriteResult;
  inserted: ReadResult;
  update: WriteResult;
  remove: WriteResult;
  target: Row;
  after: ReadResult;
};

// AC-20a and AC-20b, the When: with session (undefined: no sign-in), every declared relation
// is read, then written with a relation-valid insert unique to this run and with an update
// and a delete aimed at one owner row; the owner reads back what each write left. The
// scenario asserts the Then on the probes.
export async function probeAccess(
  request: APIRequestContext,
  owner: string,
  session: string | undefined,
  run: string,
): Promise<AccessProbe[]> {
  const relations = exposedRelations();
  const ownerRows = await ownerRowsEverywhere(request, owner, run, relations);
  const second = await seededItem(request, owner, `${run}-b`);
  const probes: AccessProbe[] = [];
  for (const relation of relations) {
    const target = ownerRows[relation][0];
    const read = await readRelation(request, relation, session);
    // A bookmark payload names the second seeded item, which no persona has bookmarked.
    const payload = relation === 'bookmarks' ? bookmarkFor(second) : uniqueRow(relation, target, run);
    const insert = await writeRelation(request, relation, 'POST', payload, session);
    const inserted = await readRelation(request, relation, owner, payloadFilter(relation, payload));
    const changed = { [FIELD[relation]]: relation === 'ingestion_runs' ? 'abandoned' : payload[FIELD[relation]] };
    const update = await writeRelation(request, relation, 'PATCH', changed, session, keyFilter(relation, target));
    const remove = await writeRelation(request, relation, 'DELETE', {}, session, keyFilter(relation, target));
    const after = await readRelation(request, relation, owner, keyFilter(relation, target));
    probes.push({ relation, read, insert, inserted, update, remove, target, after });
  }
  return probes;
}

// A refused insert: an authorization refusal (401 or 403), or 405 for a write to a view; a
// malformed-input, conflict or server answer is not a refusal.
export function insertRefused(probe: AccessProbe): boolean {
  return isAuthorizationRefusal(probe.insert) || (VIEWS.includes(probe.relation) && probe.insert.status === 405);
}

// A refused update or delete: refused, or no row affected, or 405 for a view.
export function changeRefused(probe: AccessProbe, result: WriteResult): boolean {
  return affectedNoRow(result) || (VIEWS.includes(probe.relation) && result.status === 405);
}

export { isRefusedOrEmpty };

