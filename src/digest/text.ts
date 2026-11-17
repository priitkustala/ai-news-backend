// The article digest's text rules (priitkustala/ai-news-backend#55): the plain text of an article
// page, which is sent to the model and never stored, and the check of the model's reply before it
// is stored as the item's digest, with the page bound or, for a reply written from the feed text
// only, the feed bound (priitkustala/ai-news-backend#88). rejectReason names why a reply is refused
// (priitkustala/ai-news#191). Pure; Node built-ins only.

// The stored digest's bounds, in characters after trimming. A digest from the feed text only
// (priitkustala/ai-news-backend#88) keeps the upper bound and has no lower bound.
export const DIGEST_MIN_CHARS = 600;
export const DIGEST_MAX_CHARS = 1200;
// A page with less text than this is not read as an article.
export const ARTICLE_MIN_CHARS = 500;
// The most characters of a page's text sent to the model.
export const ARTICLE_TEXT_MAX_CHARS = 12000;

const DIGEST_MIN_SENTENCES = 4;
const DIGEST_MAX_SENTENCES = 8;
const FEED_DIGEST_MIN_SENTENCES = 1;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g, (whole, decimal?: string, hex?: string, name?: string) => {
    if (name !== undefined) return NAMED_ENTITIES[name] ?? whole;
    const code = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? '', 16);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

// The page's text: script, style, noscript and template content and comments removed, tags
// stripped, entities decoded, white space collapsed, trimmed, cut at ARTICLE_TEXT_MAX_CHARS.
export function articleText(html: string): string {
  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
      .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= ARTICLE_TEXT_MAX_CHARS) return text;
  const cut = text.slice(0, ARTICLE_TEXT_MAX_CHARS);
  // Never end on half of a surrogate pair.
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut;
}

// A sentence ends at a full stop, an exclamation mark or a question mark followed by white space
// or the end of the text.
function sentenceCount(text: string): number {
  return (text.match(/[.!?](?=\s|$)/g) ?? []).length;
}

// Why a reply is refused, or null when it passes: the word NONE (none) and an address (http://,
// https:// or www., in any case; link) are refused; from the page, a length outside 600 to 1200
// characters (length) or a sentence count outside 4 to 8 (sentences) is refused; from the feed
// (priitkustala/ai-news-backend#88), a length over 1200 characters or a sentence count outside 1 to 8.
// The checks run in this order (priitkustala/ai-news#191).
export type RejectReason = 'none' | 'link' | 'length' | 'sentences';

export function rejectReason(reply: string, from: 'page' | 'feed' = 'page'): RejectReason | null {
  const text = reply.trim();
  if (text.toUpperCase() === 'NONE') return 'none';
  if (/https?:\/\/|www\./i.test(text)) return 'link';
  const length = Array.from(text).length;
  const minChars = from === 'feed' ? 0 : DIGEST_MIN_CHARS;
  if (length < minChars || length > DIGEST_MAX_CHARS) return 'length';
  const sentences = sentenceCount(text);
  const minSentences = from === 'feed' ? FEED_DIGEST_MIN_SENTENCES : DIGEST_MIN_SENTENCES;
  if (sentences < minSentences || sentences > DIGEST_MAX_SENTENCES) return 'sentences';
  return null;
}

// The reply as the digest to store, or null when rejectReason names a reason.
export function validDigest(reply: string, from: 'page' | 'feed' = 'page'): string | null {
  return rejectReason(reply, from) === null ? reply.trim() : null;
}
