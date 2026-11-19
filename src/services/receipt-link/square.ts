import type { ReceiptData } from '@/types';
import { findClass, readClassText, readRows, readText, ReceiptParseError, toCents } from './html';

// Parses the receipt page behind a Square receipt link. The page is server-rendered: one
// .modern-line-item table per line, its first row "name | $price" (the name in .modern-item-name,
// the price the line's total), then the .modern-totals table ("Purchase Subtotal", taxes, "Tip",
// "Total") and then the payment details. Only line items before the totals table are read, and
// reading the totals stops at "Total", so payment rows are never parsed. A priced row after a
// line's first folds into that line; a negative line (a discount) stays its own line.

interface Line {
  name: string;
  cents: number;
}

export function parseSquareReceipt(html: string): ReceiptData {
  const totalsAt = findClass(html, 'modern-totals');
  if (totalsAt < 0) {
    throw new ReceiptParseError('Receipt totals not found');
  }

  const lines: Line[] = [];
  for (let at = findClass(html, 'modern-line-item'); at >= 0 && at < totalsAt; ) {
    const next = findClass(html, 'modern-line-item', at + 1);
    const end = next >= 0 && next < totalsAt ? next : totalsAt;
    const [first, ...more] = readRows(html, at);
    const name = readClassText(html.slice(at, end), 'modern-item-name');
    const cents = first?.length === 2 ? toCents(readText(first[1])) : null;
    if (!name || cents === null) {
      throw new ReceiptParseError('Receipt line not readable');
    }

    const line = { name, cents };
    for (const cells of more) {
      const extra = cells.length === 2 ? toCents(readText(cells[1])) : null;
      if (extra !== null) line.cents += extra;
    }
    lines.push(line);
    at = next;
  }

  let subtotal: number | null = null;
  let total: number | null = null;
  for (const cells of readRows(html, totalsAt)) {
    if (cells.length !== 2) continue;

    const key = readText(cells[0]).toLowerCase();
    const cents = toCents(readText(cells[1]));
    if (key === 'total') {
      total = cents;
      break;
    }
    if (subtotal === null && (key === 'subtotal' || key.endsWith(' subtotal'))) {
      subtotal = cents;
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
