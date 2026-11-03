// Parsing of one feed body into its entries (priitkustala/ai-news-backend#1, S-02): RSS 2.0,
// RSS 1.0 (RDF) and Atom, with the approved parser fast-xml-parser 5.11.2. The XML is
// validated first, because the parser itself accepts malformed input; DTD and entity
// processing is off (B-03): a DOCTYPE that declares an external entity is refused by the
// parser, an internal one is never expanded, and only the five predefined XML entities and
// numeric character references are decoded, in one pass.
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { SourceFailure } from './fetch.js';

export type FeedEntry = {
  title: string;
  link: string | null;
  summary: string | null;
  published: string | null;
  guid: string | null;
};

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

export function parseFeed(body: string): FeedEntry[] {
  const valid = XMLValidator.validate(body);
  if (valid !== true) {
    throw new SourceFailure('invalid-xml', `${valid.err.code} at line ${valid.err.line}, column ${valid.err.col}`);
  }
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(body) as Record<string, unknown>;
  } catch (error) {
    // The parser's message names the refused construct (for example an external entity), not content.
    throw new SourceFailure('invalid-xml', error instanceof Error ? error.message.slice(0, 120) : 'the feed could not be parsed');
  }
  const rss = doc.rss as Record<string, unknown> | undefined;
  if (rss && typeof rss === 'object') {
    const channel = (Array.isArray(rss.channel) ? rss.channel[0] : rss.channel) as Record<string, unknown> | undefined;
    return list(channel?.item).filter((i) => i && typeof i === 'object').map((i) => entryOf(i as Record<string, unknown>, false));
  }
  const rdf = doc['rdf:RDF'] as Record<string, unknown> | undefined;
  if (rdf && typeof rdf === 'object') {
    return list(rdf.item).filter((i) => i && typeof i === 'object').map((i) => entryOf(i as Record<string, unknown>, false));
  }
  const feed = doc.feed as Record<string, unknown> | undefined;
  if (feed && typeof feed === 'object') {
    return list(feed.entry).filter((e) => e && typeof e === 'object').map((e) => entryOf(e as Record<string, unknown>, true));
  }
  throw new SourceFailure('not-a-feed', 'the document has no RSS, RDF or Atom root element');
}
