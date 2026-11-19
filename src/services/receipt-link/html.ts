// Shared pieces for reading server-rendered receipt pages: entity decoding, table rows, element
// text and prices. Each page has its own parser (toast.ts, square.ts).

export class ReceiptParseError extends Error {}

const NAMED_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
]);

export function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (entity, dec, hex, name) => {
    if (name) return NAMED_ENTITIES.get(name) ?? entity;
    const code = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

// Comments, or a start/end tag whose quoted attribute values may contain ">"
const TAG = /<!--[\s\S]*?-->|<(\/?)([a-z][a-z0-9]*)(?:"[^"]*"|'[^']*'|[^'"<>])*>/gi;

// A class attribute whose list holds cls as a whole name: "modern-totals", not "modern-totals-row"
const classAttr = (cls: string) => new RegExp(`\\bclass\\s*=\\s*["'](?:[^"']*\\s)?${cls}["'\\s]`, 'i');

// Where the class attribute of the first element from `from` on whose class list has cls starts,
// or -1
export function findClass(html: string, cls: string, from = 0): number {
  const at = html.slice(from).search(classAttr(cls));
  return at < 0 ? -1 : from + at;
}

// Splits the first table from start on into rows of cell text (tags dropped, <br> a space). End
// tags are optional, as in HTML: a new <tr> or <td> closes the open one. Reading stops at the
// first </table>.
export function readRows(html: string, start: number): string[][] {
  const rows: string[][] = [];
  let row: string[] | null = null;
  let cell: string | null = null;
  let textStart = start;

  const closeCell = () => {
    if (row && cell !== null) row.push(cell);
    cell = null;
  };
  const closeRow = () => {
    closeCell();
    if (row) rows.push(row);
    row = null;
  };

  TAG.lastIndex = start;
  for (let match = TAG.exec(html); match; match = TAG.exec(html)) {
    if (cell !== null) cell += html.slice(textStart, match.index);
    textStart = TAG.lastIndex;

    const name = match[2]?.toLowerCase();
    const isEnd = match[1] === '/';
    if (name === 'table' && isEnd) break;
    if (name === 'tr') {
      closeRow();
      if (!isEnd) row = [];
    } else if (name === 'td' || name === 'th') {
      closeCell();
      if (!isEnd) cell = '';
    } else if (name === 'br' && cell !== null) {
      cell += ' ';
    }
  }
  closeRow();
  return rows;
}

// The text of the first element from start on whose class list has cls (tags dropped, <br> a
// space), or null if there is none
export function readClassText(html: string, cls: string, start = 0): string | null {
  const hasClass = classAttr(cls);
  let open: string | null = null; // the element's tag name, once found
  let depth = 0;
  let text = '';
  let textStart = start;

  TAG.lastIndex = start;
  for (let match = TAG.exec(html); match; match = TAG.exec(html)) {
    if (open !== null) text += html.slice(textStart, match.index);
    textStart = TAG.lastIndex;

    const name = match[2]?.toLowerCase();
    if (!name) continue;
    const isEnd = match[1] === '/';
    if (open === null) {
      if (!isEnd && hasClass.test(match[0])) {
        open = name;
        depth = 1;
      }
    } else if (name === open) {
      depth += isEnd ? -1 : 1;
      if (depth === 0) return readText(text);
    } else if (name === 'br') {
      text += ' ';
    }
  }
  return null;
}

// Cell or element text as shown: entities decoded, whitespace collapsed
export function readText(raw: string): string {
  return decodeEntities(raw).replace(/\s+/g, ' ').trim();
}

const PRICE = /^(-)?\s*\$(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/;

export function toCents(text: string): number | null {
  const match = PRICE.exec(text);
  if (!match) return null;
  const cents = Number(match[2].replace(/,/g, '')) * 100 + Number(match[3]);
  return match[1] ? -cents : cents;
}
