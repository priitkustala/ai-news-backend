// The source text of a feed entry as plain text (priitkustala/ai-news#211, SRC-1): the one entity
// decoder of the article digest (moved here from src/digest/text.ts, which imports it back) and
// sourceText, which the processing step applies to a feed summary once, before it is cut and
// stored, so no reader sees source markup. Pure; Node built-ins only.

// The named entities decoded; any other name stays as text.
export const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g, (whole, decimal?: string, hex?: string, name?: string) => {
    if (name !== undefined) return NAMED_ENTITIES[name] ?? whole;
    const code = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? '', 16);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

// The plain text of a source summary: tags stripped, then entities decoded, then footnote marks of
// the form \1\ removed, then runs of four or more of - _ = or * (rule lines) removed, then white
// space folded and trimmed.
export function sourceText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\\\d+\\/g, '')
    .replace(/[-_=*]{4,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
