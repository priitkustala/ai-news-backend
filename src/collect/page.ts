// The reader of a vendor's own news page, the source kind `page` (priitkustala/ai-news-backend#41).
// The page publishes no feed: its posts are the anchors to /news/ addresses of one HTML listing,
// each with the post's title and a date written as text ("Mon D, YYYY"). Only the title, the
// link and the date are kept, never the page's other text (B-12, B-27). Before the page, the
// host's robots file is read once and its rule for this job's agent is respected. A page that
// answers but yields no readable post is the source's failure, so a changed layout is a visible
// source error and never an empty success. Every failure and rejection names a kind and numbers
// only, never the page's content (Locked R-21). The HTML scan is hand-written: no dependency, so
// this module imports only the fetch module and Node built-ins.
import { fetchFeed, SourceFailure } from './fetch.js';
import type { FeedEntry } from './parse.js';

export const ROBOTS_AGENT = 'ai-news-backend';

export type PageSource = { id: string; feed_url: string };
export type PageResult =
  | { source_id: string; ok: true; entries: FeedEntry[]; rejected: string[]; attempts: number }
  | { source_id: string; ok: false; error: string };

// ---------------------------------------------------------------------------------------
// A tolerant HTML scan into an element tree: comments, declarations and the content of script
// and style are skipped; an unmatched end tag is ignored; void elements hold nothing.

type Element = { name: string; attrs: Record<string, string>; children: (Element | string)[]; parent: Element | null };

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'template', 'textarea', 'noscript']);

function tagEnd(html: string, from: number): number {
  let quote = '';
  for (let i = from; i < html.length; i += 1) {
    const c = html[i];
    if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return -1;
}

function attributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

function scan(html: string): Element {
  const root: Element = { name: '#root', attrs: {}, children: [], parent: null };
  let current = root;
  let at = 0;
  const text = (to: number) => { if (to > at) current.children.push(html.slice(at, to)); };
  while (at < html.length) {
    const lt = html.indexOf('<', at);
    if (lt === -1) { text(html.length); break; }
    text(lt);
    at = lt;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      at = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt);
      at = end === -1 ? html.length : end + 1;
      continue;
    }
    const close = html[lt + 1] === '/';
    const name = /^[A-Za-z][A-Za-z0-9-]*/.exec(html.slice(lt + (close ? 2 : 1), lt + 64))?.[0]?.toLowerCase();
    if (!name) { current.children.push('<'); at = lt + 1; continue; }
    const end = tagEnd(html, lt + 1);
    if (end === -1) { at = html.length; break; }
    at = end + 1;
    if (close) {
      for (let open: Element | null = current; open && open !== root; open = open.parent) {
        if (open.name === name) { current = open.parent ?? root; break; }
      }
      continue;
    }
    const inner = html.slice(lt + 1 + name.length, end);
    const element: Element = { name, attrs: attributes(inner), children: [], parent: current };
    current.children.push(element);
    if (RAW.has(name)) {
      const stop = html.toLowerCase().indexOf(`</${name}`, at);
      const after = stop === -1 ? -1 : html.indexOf('>', stop);
      at = after === -1 ? html.length : after + 1;
      continue;
    }
    if (!VOID.has(name) && !inner.trimEnd().endsWith('/')) current = element;
  }
  return root;
}

const PREDEFINED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// The five predefined XML entities and numeric character references, in one pass.
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (whole, ref: string) => {
    if (ref[0] !== '#') return PREDEFINED[ref];
    const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}

// The visible text of an element; `gap` is put between elements (a space for the date search,
// so that a heading and a date written without whitespace between them stay apart).
function textOf(node: Element, gap = '', skip?: (e: Element) => boolean): string {
  const parts: string[] = [];
  const walk = (n: Element) => {
    for (const child of n.children) {
      if (typeof child === 'string') parts.push(child);
      else if (skip?.(child)) parts.push(gap);
      else { parts.push(gap); walk(child); parts.push(gap); }
    }
  };
  walk(node);
  return decodeEntities(parts.join('')).replace(/\s+/g, ' ').trim();
}

function descendants(node: Element, out: Element[] = []): Element[] {
  for (const child of node.children) if (typeof child !== 'string') { out.push(child); descendants(child, out); }
  return out;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DATE = /(?<![A-Za-z])(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? (\d{1,2}), (\d{4})(?!\d)/i;

// The first "Mon D, YYYY" in a text, as that day at 00:00 UTC (an ISO instant), or null.
function dateIn(text: string): string | null {
  const m = DATE.exec(text);
  if (!m) return null;
  const [year, month, day] = [Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()), Number(m[2])];
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCDate() === day && date.getUTCMonth() === month ? date.toISOString() : null;
}

// The post address of an anchor: its href resolved against the page, on the page's own origin,
// with a path under /news/ (not /news/ itself); the fragment dropped. Otherwise null.
function postAddress(anchor: Element, pageUrl: URL): string | null {
  const href = anchor.attrs.href;
  if (!href) return null;
  const url = URL.parse(href.trim(), pageUrl);
  if (!url || url.origin !== pageUrl.origin || !url.pathname.startsWith('/news/') || url.pathname.length <= '/news/'.length) return null;
  url.hash = '';
  return url.href;
}

// The title of a post anchor: the text of its first heading, or else its whole visible text
// with any date taken out.
function titleOf(anchor: Element): string {
  const heading = descendants(anchor).find((e) => /^h[1-6]$/.test(e.name));
  const title = heading ? textOf(heading) : textOf(anchor, ' ').replace(new RegExp(DATE.source, 'gi'), ' ');
  return title.replace(/\s+/g, ' ').trim();
}

// The date of a post anchor's card: the anchor itself when it holds a date, otherwise the
// nearest enclosing element that holds a date and no other post address. A branch holding another
// link to the same address is that link's own card, so its date is not this anchor's.
function cardDate(anchor: Element, address: string, addresses: Map<Element, string>): string | null {
  const holdsAnchor = (e: Element) => { for (let n: Element | null = anchor; n; n = n.parent) if (n === e) return true; return false; };
  const otherLink = (e: Element) => !holdsAnchor(e) && (addresses.has(e) || descendants(e).some((d) => addresses.has(d)));
  for (let card: Element | null = anchor; card && card.name !== '#root'; card = card.parent) {
    if (card !== anchor && descendants(card).some((e) => addresses.has(e) && addresses.get(e) !== address)) return null;
    const date = dateIn(textOf(card, ' ', otherLink));
    if (date) return date;
  }
  return null;
}

// The posts of a news page, in page order, each address once and decided by its first link (a
// later link to the same address fills nothing); a post link with no title or no date is not an item and is counted in `rejected` by kind.
export function parsePageItems(html: string, pageUrl: string): { entries: FeedEntry[]; rejected: string[] } {
  const base = new URL(pageUrl);
  const anchors = descendants(scan(html)).filter((e) => e.name === 'a');
  const addresses = new Map<Element, string>();
  for (const anchor of anchors) {
    const address = postAddress(anchor, base);
    if (address) addresses.set(anchor, address);
  }
  const posts = new Map<string, { title: string; published: string | null }>();
  for (const [anchor, address] of addresses) {
    if (!posts.has(address)) posts.set(address, { title: titleOf(anchor), published: cardDate(anchor, address, addresses) });
  }
  const entries: FeedEntry[] = [];
  let untitled = 0;
  let undated = 0;
  for (const [link, { title, published }] of posts) {
    if (!title) untitled += 1;
    else if (!published) undated += 1;
    else entries.push({ title, link, summary: null, published, guid: null });
  }
  const rejected: string[] = [];
  if (untitled) rejected.push(`page: ${untitled} link(s) without a title`);
  if (undated) rejected.push(`page: ${undated} link(s) without a date`);
  return { entries, rejected };
}

// ---------------------------------------------------------------------------------------
// Robots (RFC 9309 in the form this job needs): a group applies when its agent token is a prefix
// of the agent name (case-insensitive), the longest such token wins, and the group * applies only
// when no named group does; a group ends at its first rule line, even one with an empty value.
// Within the group the longest matching Allow or Disallow path wins,
// Allow on a tie; no matching rule allows; an empty Disallow allows. `*` in a path matches any
// characters and a final `$` anchors the end.

type Rule = { allow: boolean; path: string };

function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$');
  const body = (anchored ? rule.slice(0, -1) : rule).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
}

export function robotsAllows(robotsText: string, path: string, agent = ROBOTS_AGENT): boolean {
  const groups: { agents: string[]; rules: Rule[]; ruled: boolean }[] = [];
  let group: { agents: string[]; rules: Rule[]; ruled: boolean } | null = null;
  for (const raw of robotsText.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const [key, value] = [m[1].toLowerCase(), m[2].trim()];
    if (key === 'user-agent') {
      if (!group || group.ruled) { group = { agents: [], rules: [], ruled: false }; groups.push(group); }
      group.agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && group) {
      group.ruled = true;
      if (value !== '') group.rules.push({ allow: key === 'allow', path: value });
    }
  }
  const name = agent.toLowerCase();
  const token = (g: { agents: string[] }) => Math.max(-1, ...g.agents.filter((a) => a !== '' && a !== '*' && name.startsWith(a)).map((a) => a.length));
  const longest = Math.max(-1, ...groups.map(token));
  const chosen = longest > 0 ? groups.filter((g) => token(g) === longest) : groups.filter((g) => g.agents.includes('*'));
  let best: Rule | null = null;
  for (const rule of chosen.flatMap((g) => g.rules)) {
    if (!ruleMatches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

// ---------------------------------------------------------------------------------------

// One run's collection of a page source: its host's robots file once (missing allows), then the
// page once, through the same fetch as a feed (redirect rule, timeout, size bound, retry).
export async function collectPage(source: PageSource): Promise<PageResult> {
  const fail = (error: string): PageResult => ({ source_id: source.id, ok: false, error });
  const page = new URL(source.feed_url);
  try {
    const { body } = await fetchFeed(new URL('/robots.txt', page).href, { headers: { accept: 'text/plain' } });
    if (!robotsAllows(body, page.pathname + page.search)) return fail('robots: the page is disallowed');
  } catch (error) {
    if (!(error instanceof SourceFailure && error.kind === 'http-404')) return fail('robots: the file could not be read');
  }
  try {
    const { body, attempts } = await fetchFeed(source.feed_url, { headers: { accept: 'text/html' } });
    const { entries, rejected } = parsePageItems(body, source.feed_url);
    if (entries.length === 0) return fail('layout: the page held no readable post');
    return { source_id: source.id, ok: true, entries, rejected, attempts };
  } catch (error) {
    return fail(error instanceof SourceFailure ? error.message : 'unexpected: the source could not be collected');
  }
}
