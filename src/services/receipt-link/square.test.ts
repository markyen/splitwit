// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseSquareReceipt } from './square';
import { extraRow, lineItem, modifier, squareReceiptPage, tender, totals, totalsRow } from '@/test/squareReceipt';

const totalsBlock = (subtotal: string, tax: string, tip: string | null, total: string) =>
  totals(
    [
      totalsRow('Purchase Subtotal', subtotal),
      totalsRow('State Tax (8.875%)', tax),
      tip === null ? '' : totalsRow('Tip', tip),
      totalsRow('Total', total),
    ].join('')
  );

describe('parseSquareReceipt', () => {
  it('reads each line and the totals, leaving out tax and tip', () => {
    const html = squareReceiptPage([
      lineItem('Item A', '$9.00'),
      lineItem('Item B', '$25.00'),
      totalsBlock('$34.00', '$3.02', '$6.80', '$43.82'),
    ].join(''));

    expect(parseSquareReceipt(html)).toEqual({
      items: [
        { name: 'Item A', price: 9 },
        { name: 'Item B', price: 25 },
      ],
      subtotal: 34,
      total: 43.82,
    });
  });

  it('names a line by .modern-item-name alone and prices it at its line total', () => {
    const html = squareReceiptPage([
      lineItem('Item A <span>x 2</span>', '$18.00', modifier('Option 1') + '<div class="modern-item-desc">Note</div>'),
      totalsBlock('$18.00', '$0.00', null, '$18.00'),
    ].join(''));

    expect(parseSquareReceipt(html).items).toEqual([{ name: 'Item A x 2', price: 18 }]);
  });

  it('folds a priced row after a line into it and keeps a negative line on its own', () => {
    const html = squareReceiptPage([
      lineItem('Item A', '$10.00', '', extraRow('Option 1', '$2.50') + extraRow('Option 2', '')),
      lineItem('Item B', '$1,000.00'),
      lineItem('Promo X', '-$2.00'),
      totalsBlock('$1,010.50', '$0.00', '$0.00', '$1,010.50'),
    ].join(''));

    expect(parseSquareReceipt(html).items).toEqual([
      { name: 'Item A', price: 12.5 },
      { name: 'Item B', price: 1000 },
      { name: 'Promo X', price: -2 },
    ]);
  });

  it('reads a plain Subtotal label and stops at the first Total', () => {
    const html = squareReceiptPage(
      [
        lineItem('Item A', '$8.00'),
        totals(
          [
            totalsRow('Subtotal', '$8.00'),
            totalsRow('Tax', '$0.80'),
            totalsRow('Total', '$8.80'),
            totalsRow('Total', '$99.99'),
          ].join('')
        ),
      ].join(''),
      tender('$8.80')
    );

    expect(parseSquareReceipt(html)).toEqual({
      items: [{ name: 'Item A', price: 8 }],
      subtotal: 8,
      total: 8.8,
    });
  });

  it('reads no line after the totals table', () => {
    const html = squareReceiptPage(
      [lineItem('Item A', '$5.00'), totalsBlock('$5.00', '$0.44', null, '$5.44')].join(''),
      lineItem('Refunded Item', '$5.00') + tender('$5.44')
    );

    expect(parseSquareReceipt(html).items).toEqual([{ name: 'Item A', price: 5 }]);
  });

  it('matches class names whole, not by prefix', () => {
    const html = squareReceiptPage([
      '<div class="modern-totals-row modern-line-item-x">not a table</div>',
      lineItem('Item A', '$5.00'),
      totalsBlock('$5.00', '$0.00', null, '$5.00'),
    ].join(''));

    expect(parseSquareReceipt(html).items).toEqual([{ name: 'Item A', price: 5 }]);
  });

  it('decodes entities in names', () => {
    const html = squareReceiptPage([
      lineItem('Item &amp; Side', '$4.00'),
      lineItem('Item &#39;E&#x27; &quot;F&quot; &lt;G&gt;', '$6.00'),
      totalsBlock('$10.00', '$0.00', null, '$10.00'),
    ].join(''));

    expect(parseSquareReceipt(html).items).toEqual([
      { name: 'Item & Side', price: 4 },
      { name: 'Item \'E\' "F" <G>', price: 6 },
    ]);
  });

  it('refuses a page without the totals, or totals without a Total', () => {
    expect(() => parseSquareReceipt(squareReceiptPage(lineItem('Item A', '$5.00')))).toThrow(
      'Receipt totals not found'
    );

    const noTotal = squareReceiptPage([lineItem('Item A', '$5.00'), totals(totalsRow('Purchase Subtotal', '$5.00'))].join(''));
    expect(() => parseSquareReceipt(noTotal)).toThrow('Receipt totals not found');

    const noSubtotal = squareReceiptPage([lineItem('Item A', '$5.00'), totals(totalsRow('Total', '$5.00'))].join(''));
    expect(() => parseSquareReceipt(noSubtotal)).toThrow('Receipt totals not found');
  });

  it('refuses a line whose name or price cannot be read', () => {
    const unpriced = squareReceiptPage([lineItem('Item A', 'Free'), totalsBlock('$0.00', '$0.00', null, '$0.00')].join(''));
    expect(() => parseSquareReceipt(unpriced)).toThrow('Receipt line not readable');

    const twoPrices = squareReceiptPage([lineItem('Item A', '<s>$6.00</s> $5.00'), totalsBlock('$5.00', '$0.00', null, '$5.00')].join(''));
    expect(() => parseSquareReceipt(twoPrices)).toThrow('Receipt line not readable');

    const unnamed = squareReceiptPage([lineItem('', '$5.00'), totalsBlock('$5.00', '$0.00', null, '$5.00')].join(''));
    expect(() => parseSquareReceipt(unnamed)).toThrow('Receipt line not readable');
  });

  it('refuses a receipt whose lines do not add up to the subtotal, or that has none', () => {
    const html = squareReceiptPage([
      lineItem('Item A', '$10.00'),
      lineItem('Item B', '$5.00'),
      totalsBlock('$15.02', '$1.00', '$0.00', '$16.02'),
    ].join(''));
    expect(() => parseSquareReceipt(html)).toThrow("Items don't add up to the subtotal");

    const empty = squareReceiptPage(totalsBlock('$0.00', '$0.00', null, '$0.00'));
    expect(() => parseSquareReceipt(empty)).toThrow("Items don't add up to the subtotal");
  });
});
