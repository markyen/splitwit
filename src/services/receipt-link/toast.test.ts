// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseToastReceipt, decodeEntities } from './toast';
import { modifier, payment, row, spacer, toastReceiptPage } from '@/test/toastReceipt';

const totals = (subtotal: string, tax: string, tip: string | null, total: string) =>
  [
    spacer(),
    row('Item Subtotal', subtotal),
    spacer(),
    row('Subtotal', subtotal),
    row('Tax', tax),
    tip === null ? '' : row('Tip', tip),
    row('Total', total),
  ].join('\n');

describe('parseToastReceipt', () => {
  it('folds priced modifiers into their item and drops unpriced ones', () => {
    const html = toastReceiptPage([
      row('Item A', '$10.00'),
      modifier('Option 1'),
      modifier('Option 2', '$2.50'),
      modifier('Option 3', '$1.00'),
      row('Item B', '$5.00'),
      modifier('Option 4'),
      totals('$18.50', '$1.50', '$3.00', '$23.00'),
    ].join('\n'));

    expect(parseToastReceipt(html)).toEqual({
      items: [
        { name: 'Item A', price: 13.5 },
        { name: 'Item B', price: 5 },
      ],
      subtotal: 18.5,
      total: 23,
    });
  });

  it('keeps a counted line as one line at its line total', () => {
    const html = toastReceiptPage([
      row('2 Item C', '$18.00'),
      row('Item D', '$1,000.00'),
      totals('$1,018.00', '$0.00', '$0.00', '$1,018.00'),
    ].join('\n'));

    expect(parseToastReceipt(html).items).toEqual([
      { name: '2 Item C', price: 18 },
      { name: 'Item D', price: 1000 },
    ]);
  });

  it('turns an item discount and a check discount into negative lines', () => {
    const html = toastReceiptPage([
      row('Item A', '$10.00'),
      modifier('Promo X', '- $2.00'),
      row('Item B', '$20.00'),
      spacer(),
      row('Promo Y', '- $3.00'),
      spacer(),
      row('Item Subtotal', '$30.00'),
      row('Discount Total', '- $5.00'),
      spacer(),
      row('Subtotal', '$25.00'),
      row('Tax', '$2.00'),
      row('Tip', '$5.00'),
      row('Total', '$32.00'),
    ].join('\n'));

    expect(parseToastReceipt(html)).toEqual({
      items: [
        { name: 'Item A', price: 10 },
        { name: 'Promo X (Item A)', price: -2 },
        { name: 'Item B', price: 20 },
        { name: 'Promo Y', price: -3 },
      ],
      subtotal: 25,
      total: 32,
    });
  });

  it('reads a receipt with no tip row', () => {
    const html = toastReceiptPage([
      row('Item A', '$8.00'),
      totals('$8.00', '$0.80', null, '$8.80'),
    ].join('\n'));

    const result = parseToastReceipt(html);
    expect(result.items).toEqual([{ name: 'Item A', price: 8 }]);
    expect(result.total).toBe(8.8);
  });

  it('reads two payments, stopping at the first Total', () => {
    const html = toastReceiptPage(
      [row('Item A', '$12.00'), totals('$12.00', '$1.00', '$2.00', '$15.00')].join('\n'),
      [payment('$7.00'), payment('$8.00'), row('Total', '$99.99')].join('\n')
    );

    expect(parseToastReceipt(html)).toEqual({
      items: [{ name: 'Item A', price: 12 }],
      subtotal: 12,
      total: 15,
    });
  });

  it('refuses a receipt without a totals block', () => {
    const html = toastReceiptPage(row('Item A', '$12.00'), '');
    expect(() => parseToastReceipt(html)).toThrow('Receipt totals not found');

    const noTotal = toastReceiptPage([row('Item A', '$12.00'), row('Subtotal', '$12.00')].join('\n'), '');
    expect(() => parseToastReceipt(noTotal)).toThrow('Receipt totals not found');
  });

  it('refuses a receipt whose items do not sum to the subtotal', () => {
    const html = toastReceiptPage([
      row('Item A', '$10.00'),
      row('Item B', '$5.00'),
      totals('$15.02', '$1.00', '$0.00', '$16.02'),
    ].join('\n'));

    expect(() => parseToastReceipt(html)).toThrow("Items don't add up to the subtotal");
  });

  it('refuses a page without a receipt table', () => {
    expect(() => parseToastReceipt('<html><body><p>Not found</p></body></html>')).toThrow(
      'Receipt table not found'
    );
  });

  it('decodes entities in names and still sees &nbsp; indents', () => {
    const html = toastReceiptPage([
      row('Item &amp; Side', '$4.00'),
      row('Item &#39;E&#x27; &quot;F&quot; &lt;G&gt;', '$6.00'),
      row('&#160;Option 1', '$1.00'),
      totals('$11.00', '$0.00', '$0.00', '$11.00'),
    ].join('\n'));

    expect(parseToastReceipt(html).items).toEqual([
      { name: 'Item & Side', price: 4 },
      { name: 'Item \'E\' "F" <G>', price: 7 },
    ]);
  });
});

describe('decodeEntities', () => {
  it('leaves unknown and out-of-range entities as written', () => {
    expect(decodeEntities('&bogus; &constructor; &#0; &#x110000; &amp;amp;')).toBe(
      '&bogus; &constructor; &#0; &#x110000; &amp;'
    );
  });
});
