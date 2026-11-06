// Parsing of one feed body into its entries (priitkustala/ai-news-backend#1, S-02): RSS 2.0,
// RSS 1.0 (RDF) and Atom, with the approved parser fast-xml-parser 5.11.2. No DTD is
// processed (B-03): a document that carries a DOCTYPE declaration is refused before the
// validator or the parser sees it, so their DTD readers never run. The XML is then
// validated, because the parser itself accepts malformed input; entity processing stays off,
// and only the five predefined XML entities and numeric character references are decoded,
// in one pass. An item whose parsed node is larger than ITEM_MAX_BYTES is rejected and
// recorded by its size alone (S-11, priitkustala/ai-news#47; B-03), never stored.
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { SourceFailure } from './fetch.js';

export type FeedEntry = {
  title: string;
  link: string | null;
  summary: string | null;
  published: string | null;
  guid: string | null;
};

// The per-item limit (owner's answer, 2026-11-06): 2 MiB, measured on the serialised parsed
// item node, so every field of the item counts, not only the ones kept.
export const ITEM_MAX_BYTES = 2 * 1024 * 1024;

// The kept entries of a feed and the reason of each rejected item: kind and numbers only,
// never the feed's content (Locked R-21).
export type ParsedFeed = { entries: FeedEntry[]; rejected: string[] };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  htmlEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

const PREDEFINED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (whole, ref: string) => {
    if (ref[0] !== '#') return PREDEFINED[ref];
    const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}

type Node = unknown;
const list = (value: Node): Node[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);

// The text content of an element: a plain value, or the #text of an element with attributes.
function text(value: Node): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && '#text' in first) return String((first as Record<string, unknown>)['#text']);
  return null;
}

function clean(value: string | null): string | null {
  if (value === null) return null;
  const result = decodeXmlEntities(value).replace(/\s+/g, ' ').trim();
  return result === '' ? null : result;
}

// Atom: the alternate link (rel absent or "alternate"); RSS: the link element, or a
// permalink guid when the link is absent.
function atomLink(value: Node): string | null {
  const links = list(value).filter((l): l is Record<string, unknown> => !!l && typeof l === 'object');
  const chosen = links.find((l) => l['@_rel'] === undefined || l['@_rel'] === 'alternate');
  return typeof chosen?.['@_href'] === 'string' ? chosen['@_href'] : null;
}

function entryOf(raw: Record<string, unknown>, atom: boolean): FeedEntry {
  const guid = clean(text(atom ? raw.id : raw.guid));
  const guidNode = Array.isArray(raw.guid) ? raw.guid[0] : raw.guid;
  const permalink = guidNode && typeof guidNode === 'object' && (guidNode as Record<string, unknown>)['@_isPermaLink'] === 'false' ? null : guid;
  const link = atom ? clean(atomLink(raw.link)) : clean(text(raw.link)) ?? permalink;
  return {
    title: clean(text(raw.title)) ?? '',
    link,
    summary: clean(text(atom ? raw.summary ?? raw.content : raw.description ?? raw['content:encoded'])),
    published: clean(text(atom ? raw.published ?? raw.updated : raw.pubDate ?? raw['dc:date'])),
    guid,
  };
}

// Whether the document declares a DOCTYPE: a `<!DOCTYPE` outside comments, CDATA sections
// and processing instructions (inside those it is text, and is kept). Anywhere else a
// literal `<` starts markup, so this is the declaration itself. An unterminated comment,
// CDATA section or instruction ends the scan; the validator then refuses the document.
export function declaresDoctype(body: string): boolean {
  let at = 0;
  while ((at = body.indexOf('<', at)) !== -1) {
    const skip = body.startsWith('<!--', at) ? '-->' : body.startsWith('<![CDATA[', at) ? ']]>' : body.startsWith('<?', at) ? '?>' : null;
    if (skip) {
      const end = body.indexOf(skip, at + 2);
      if (end === -1) return false;
      at = end + skip.length;
      continue;
    }
    if (body.slice(at, at + 9).toUpperCase() === '<!DOCTYPE') return true;
    at += 1;
  }
  return false;
}

export function parseFeedItems(body: string): ParsedFeed {
  if (declaresDoctype(body)) {
    throw new SourceFailure('invalid-xml', 'the document declares a DOCTYPE; DTDs are not processed');
  }
  const valid = XMLValidator.validate(body);
  if (valid !== true) {
    throw new SourceFailure('invalid-xml', `${valid.err.code} at line ${valid.err.line}, column ${valid.err.col}`);
  }
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(body) as Record<string, unknown>;
  } catch {
    // A fixed message: the parser's own text could quote the feed (R-21: the log and the run
    // report carry no feed content).
    throw new SourceFailure('invalid-xml', 'the parser refused the document');
  }
  const parsed: ParsedFeed = { entries: [], rejected: [] };
  const take = (nodes: Node, atom: boolean) => {
    for (const node of list(nodes)) {
      if (!node || typeof node !== 'object') continue;
      const size = Buffer.byteLength(JSON.stringify(node), 'utf8');
      if (size > ITEM_MAX_BYTES) parsed.rejected.push(`oversized: the item is ${size} bytes, over the limit of ${ITEM_MAX_BYTES} bytes`);
      else parsed.entries.push(entryOf(node as Record<string, unknown>, atom));
    }
    return parsed;
  };
  const rss = doc.rss as Record<string, unknown> | undefined;
  if (rss && typeof rss === 'object') {
    const channel = (Array.isArray(rss.channel) ? rss.channel[0] : rss.channel) as Record<string, unknown> | undefined;
    return take(channel?.item, false);
  }
  const rdf = doc['rdf:RDF'] as Record<string, unknown> | undefined;
  if (rdf && typeof rdf === 'object') return take(rdf.item, false);
  const feed = doc.feed as Record<string, unknown> | undefined;
  if (feed && typeof feed === 'object') return take(feed.entry, true);
  throw new SourceFailure('not-a-feed', 'the document has no RSS, RDF or Atom root element');
}

// The kept entries only (the measurement script's form, src/measure).
export function parseFeed(body: string): FeedEntry[] {
  return parseFeedItems(body).entries;
}
