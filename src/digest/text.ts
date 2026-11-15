// The article digest's text rules (priitkustala/ai-news-backend#55): the plain text of an article
// page, which is sent to the model and never stored, and the check of the model's reply before it
// is stored as the item's digest. Pure; Node built-ins only.

// The stored digest's bounds, in characters after trimming.
export const DIGEST_MIN_CHARS = 600;
export const DIGEST_MAX_CHARS = 1200;
// A page with less text than this is not read as an article.
export const ARTICLE_MIN_CHARS = 500;
// The most characters of a page's text sent to the model.
export const ARTICLE_TEXT_MAX_CHARS = 12000;

const DIGEST_MIN_SENTENCES = 4;
const DIGEST_MAX_SENTENCES = 8;

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

// The reply as the digest to store, or null: the word NONE, a link, a length outside 600 to 1200
// characters or a sentence count outside 4 to 8 is refused.
export function validDigest(reply: string): string | null {
  const text = reply.trim();
  if (text.toUpperCase() === 'NONE') return null;
  if (/http/i.test(text)) return null;
  const length = Array.from(text).length;
  if (length < DIGEST_MIN_CHARS || length > DIGEST_MAX_CHARS) return null;
  const sentences = sentenceCount(text);
  if (sentences < DIGEST_MIN_SENTENCES || sentences > DIGEST_MAX_SENTENCES) return null;
  return text;
}
