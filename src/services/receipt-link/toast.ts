import type { ReceiptData } from '@/types';
import { decodeEntities, readRows, ReceiptParseError, toCents } from './html';

// Parses the receipt page behind a Toast receipt link. The page is server-rendered: a two-column
// table inside .receipt-body holding, in order, the header rows, item rows ("name | $price", a
// counted line as "2 name | $18.00"), &nbsp;-indented modifier rows, discount rows priced
// "- $x.xx", the totals block ("… Subtotal", "Discount Total", "Subtotal", "Tax", "Tip", "Total")
// and then the payment rows. Reading stops at "Total", so payment rows are never parsed.

interface Line {
  name: string;
  cents: number;
}

// Reads the first table after .receipt-body
function readReceiptRows(html: string): string[][] {
  const start = html.search(/class\s*=\s*["'][^"']*\breceipt-body\b/i);
  if (start < 0) {
    throw new ReceiptParseError('Receipt table not found');
  }
  return readRows(html, start);
}

// A cell's text, and whether it starts with &nbsp; (how the page indents modifier rows)
function readCell(raw: string): { text: string; indented: boolean } {
  const text = decodeEntities(raw).replace(/^[ \t\n\f\r]+/, '');
  return {
    text: text.replace(/\s+/g, ' ').trim(),
    indented: text.startsWith('\u00a0'),
  };
}

export function parseToastReceipt(html: string): ReceiptData {
  const lines: Line[] = [];
  let item: Line | null = null; // the item that following modifiers belong to
  let inTotals = false;
  let subtotal: number | null = null;
  let total: number | null = null;

  for (const cells of readReceiptRows(html)) {
    if (cells.length !== 2) continue;

    const label = readCell(cells[0]);
    const cents = toCents(readCell(cells[1]).text);
    const key = label.text.toLowerCase();

    if (key === 'total') {
      total = cents;
      break;
    }
    if (key === 'subtotal') {
      subtotal = cents;
      inTotals = true;
      continue;
    }
    if (key.endsWith(' subtotal') || key === 'discount total') {
      inTotals = true;
      continue;
    }

    // Not items: the rest of the totals block (tax, tip), header rows, spacers, unpriced modifiers
    if (inTotals || cents === null || !label.text) continue;

    if (cents < 0) {
      // A discount is its own negative line; one indented under an item names that item
      const name = label.indented && item ? `${label.text} (${item.name})` : label.text;
      lines.push({ name, cents });
    } else if (label.indented) {
      if (!item) {
        throw new ReceiptParseError('Modifier found before any item');
      }
      item.cents += cents;
    } else {
      item = { name: label.text, cents };
      lines.push(item);
    }
  }

  if (subtotal === null || total === null) {
    throw new ReceiptParseError('Receipt totals not found');
  }

  const sum = lines.reduce((acc, line) => acc + line.cents, 0);
  if (lines.length === 0 || Math.abs(sum - subtotal) > 1) {
    throw new ReceiptParseError("Items don't add up to the subtotal");
  }

  return {
    items: lines.map((line) => ({ name: line.name, price: line.cents / 100 })),
    subtotal: subtotal / 100,
    total: total / 100,
  };
}
