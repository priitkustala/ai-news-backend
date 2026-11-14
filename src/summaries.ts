// Stored summaries (priitkustala/ai-news-backend#37): the backend lists the items whose stored
// summary is missing or too short to show, and stores a model-written summary that a host script
// hands back for them. The host script, not the backend, reads the article and asks the model; this
// file makes no network call of any kind and reaches only the database, on the job's role.
// Nothing written to standard error carries a text or a title: counts and ids only.
import { inTransaction, withClient } from './db.js';

// A stored summary shorter than this, after trimming, is not usable: the item is listed as pending,
// a model-written summary may replace it, and an ingest copy this short does not erase a model one.
export const USABLE_SUMMARY_MIN_CHARS = 40;
// The longest model-written summary summaries-apply stores, in characters after trimming.
export const MODEL_SUMMARY_MAX_CHARS = 600;
// How many pending items summaries-pending lists when no limit is given.
export const PENDING_DEFAULT_LIMIT = 30;

export type PendingRow = {
  id: string;
  title: string;
  link: string;
  source_name: string | null;
  category: string;
  feed_text: string | null;
};

export type ApplyReport = { applied: number; skipped: number; refused: number };

// The items without a usable summary, newest first, at most limit. Writes nothing.
export async function summariesPending(limit: number = PENDING_DEFAULT_LIMIT): Promise<PendingRow[]> {
  return withClient('DATABASE_URL', async (client) => {
    const result = await client.query<PendingRow>(
      `select i.id, i.title, i.canonical_url as link, s.name as source_name, i.category, i.summary as feed_text
         from public.items i
         left join app_private.sources s on s.id = i.source_id
        where char_length(btrim(coalesce(i.summary, ''))) < $1
        order by coalesce(i.published_at, i.fetched_at) desc, i.id
        limit $2`,
      [USABLE_SUMMARY_MIN_CHARS, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      link: row.link,
      source_name: row.source_name,
      category: row.category,
      feed_text: row.feed_text,
    }));
  });
}

type Line = { number: number; id: string; text: string };

// Reads JSON lines of { id, text }: stores each text as the item's summary with method model when the
// item has no usable summary (applied), leaves an item with a usable one as it is (skipped), and
// refuses a malformed line, an empty text, a text over the maximum or an unknown id. One transaction:
// a database error rolls the whole call back.
export async function summariesApply(input: string, log: (line: string) => void): Promise<ApplyReport> {
  const report: ApplyReport = { applied: 0, skipped: 0, refused: 0 };
  const lines: Line[] = [];
  input.split(/\r?\n/).forEach((raw, index) => {
    const number = index + 1;
    if (raw.trim() === '') return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = undefined;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      report.refused += 1;
      log(`summaries-apply: line ${number} refused: not a JSON object`);
      return;
    }
    const { id, text } = value as { id?: unknown; text?: unknown };
    if (typeof id !== 'string' || typeof text !== 'string') {
      report.refused += 1;
      log(`summaries-apply: line ${number} refused: no string id and text`);
      return;
    }
    const trimmed = text.trim();
    const length = Array.from(trimmed).length;
    if (length === 0 || length > MODEL_SUMMARY_MAX_CHARS) {
      report.refused += 1;
      log(`summaries-apply: line ${number} refused (id ${id}): text of ${length} characters, allowed 1 to ${MODEL_SUMMARY_MAX_CHARS}`);
      return;
    }
    lines.push({ number, id, text: trimmed });
  });
  if (lines.length === 0) return report;

  await withClient('DATABASE_URL', (client) => inTransaction(client, async () => {
    for (const line of lines) {
      const updated = await client.query(
        `update public.items set summary = $2, summary_method = 'model'
          where id = $1 and char_length(btrim(coalesce(summary, ''))) < $3`,
        [line.id, line.text, USABLE_SUMMARY_MIN_CHARS],
      );
      if (updated.rowCount === 1) {
        report.applied += 1;
        continue;
      }
      const present = await client.query('select 1 from public.items where id = $1', [line.id]);
      if ((present.rowCount ?? 0) > 0) {
        report.skipped += 1;
        log(`summaries-apply: line ${line.number} skipped (id ${line.id}): the stored summary is usable`);
      } else {
        report.refused += 1;
        log(`summaries-apply: line ${line.number} refused (id ${line.id}): no such item`);
      }
    }
  }));
  return report;
}
