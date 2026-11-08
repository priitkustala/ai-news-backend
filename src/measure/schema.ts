// The schema validation of fixture records (priitkustala/ai-news-backend#4, S-06; Locked AC-25:
// "every fixture yields a schema-valid record with labels from the fixed lists"). Plain
// TypeScript checks, no library (brief 06, Dependencies). Each check returns the names of the
// fields that fail, never their content (Locked R-21); an empty list is a pass.
//
// schema_valid: the fixture record as its file holds it (a sample label record or a hostile
// fixture) has its fields, its fixture_id is unique, and the record it yields through the
// pipeline is one the job could store: the collected entry has the feed entry's shape, and a
// kept item has the item row's shape (src/ingest/process.ts, ItemToStore: the id is the
// SHA-256 of the canonical address, the address is canonical, the title is plain text without
// control characters, the summary is plain text within its bound).
// labels_from_fixed_lists: the record's labels and the pipeline's decisions are values of the
// fixed lists: the five categories, the importance values, the relevance methods and the
// category methods. importance (the owner's must-read or skip, priitkustala/ai-news#75) is
// optional: absent is valid; any other value, an explicit null included, that is not must-read
// or skip is the error labels.importance.
import { createHash } from 'node:crypto';
import type { FeedEntry } from '../collect/parse.js';
import { SUMMARY_MAX_CHARS, type ItemToStore } from '../ingest/process.js';
import { canonicalUrl } from '../process/dedupe.js';
import { CATEGORIES } from '../process/category-rules.js';
import type { RawRecord } from './sample.js';

export const RELEVANCE_METHODS = ['source', 'keyword'] as const;
export const CATEGORY_METHODS = ['keyword', 'source-default', 'none'] as const;
export const LABEL_FIELDS = ['ai_relevant', 'category', 'duplicate_group', 'importance'] as const;
export const IMPORTANCE = ['must-read', 'skip'] as const;

export type RecordKind = 'sample' | 'hostile';

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const optionalText = (value: unknown) => value === undefined || value === null || typeof value === 'string';
const inList = (list: readonly string[], value: unknown) => typeof value === 'string' && list.includes(value);
// C0 control characters and DEL; a plain-text field carries none.
const CONTROL = /[\u0000-\u001f\u007f]/;
const MARKUP = /<[^>]*>/;

function httpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// The fixture record as its file holds it.
export function inputErrors(record: RawRecord, kind: RecordKind, duplicateId: boolean): string[] {
  const errors: string[] = [];
  if (!nonEmpty(record.fixture_id)) errors.push('fixture_id');
  else if (duplicateId) errors.push('fixture_id (not unique)');
  if (!nonEmpty(record.source_id)) errors.push('source_id');
  if (!record.labels || typeof record.labels !== 'object' || Array.isArray(record.labels)) errors.push('labels');
  if (kind === 'sample' && !httpUrl(record.link)) errors.push('link');
  if (kind === 'hostile') {
    if (typeof record.title !== 'string') errors.push('title');
    if (!optionalText(record.summary)) errors.push('summary');
  }
  return errors;
}

// The entry the collect step read for the record (FeedEntry).
export function entryErrors(entry: FeedEntry | null): string[] {
  if (!entry) return ['entry (the record yields no entry in its source\'s feed)'];
  const errors: string[] = [];
  if (typeof entry.title !== 'string') errors.push('entry.title');
  for (const field of ['link', 'summary', 'published', 'guid'] as const) if (!optionalText(entry[field])) errors.push(`entry.${field}`);
  return errors;
}

// The item the process step kept for the record (ItemToStore), when it kept one.
export function itemErrors(item: ItemToStore, sourceId: string): string[] {
  const errors: string[] = [];
  if (!httpUrl(item.canonical_url) || canonicalUrl(item.canonical_url) !== item.canonical_url) errors.push('item.canonical_url');
  if (item.id !== createHash('sha256').update(item.canonical_url).digest('hex')) errors.push('item.id');
  if (item.source_id !== sourceId) errors.push('item.source_id');
  if (!nonEmpty(item.title) || CONTROL.test(item.title)) errors.push('item.title');
  if (item.published_at !== null && (typeof item.published_at !== 'string' || Number.isNaN(Date.parse(item.published_at)))) errors.push('item.published_at');
  if (item.summary !== null && (typeof item.summary !== 'string' || item.summary === '' || item.summary.length > SUMMARY_MAX_CHARS
    || CONTROL.test(item.summary) || MARKUP.test(item.summary))) errors.push('item.summary');
  return errors;
}

// The labels and the pipeline's decisions against the fixed lists.
export function labelErrors(record: RawRecord, item: ItemToStore | null): string[] {
  const errors: string[] = [];
  const labels = record.labels as Record<string, unknown> | null | undefined;
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) errors.push('labels');
  else {
    if (typeof labels.ai_relevant !== 'boolean') errors.push('labels.ai_relevant');
    if (!inList(CATEGORIES, labels.category)) errors.push('labels.category');
    const group = labels.duplicate_group;
    if (group !== undefined && group !== null && !nonEmpty(group)) errors.push('labels.duplicate_group');
    if (labels.importance !== undefined && !inList(IMPORTANCE, labels.importance)) errors.push('labels.importance');
    for (const key of Object.keys(labels)) if (!(LABEL_FIELDS as readonly string[]).includes(key)) errors.push(`labels.${key} (not a label field)`);
  }
  if (item) {
    if (!inList(CATEGORIES, item.category)) errors.push('category');
    if (!inList(RELEVANCE_METHODS, item.relevance_method)) errors.push('relevance_method');
    if (!inList(CATEGORY_METHODS, item.category_method)) errors.push('category_method');
  }
  return errors;
}
