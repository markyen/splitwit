// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { toCents, toReceiptData } from './textract';
import { UnusableReceiptError } from './provider';
import { lineItem, rowOnly, summary, textractResponse } from '@/test/textractReceipt';

describe('toCents', () => {
  it.each([
    ['10.00', 1000],
    ['$10.00', 1000],
    ['$ 10.00', 1000],
    ['$1,234.50', 123450],
    ['1,234,567.89', 123456789],
    ['-5.00', -500],
    ['-$5.00', -500],
    ['5.00-', -500],
    [' 3.25 ', 325],
  ])('reads %s', (text, cents) => {
    expect(toCents(text)).toBe(cents);
  });

  it.each(['', 'free', '10', '10.5', '10.000', '1,23.00', '$', '10.00 USD', '(5.00)', '5..00', undefined])(
    'drops %s',
    (text) => {
      expect(toCents(text)).toBeNull();
    }
  );
});

describe('toReceiptData', () => {
  it('maps a plain receipt', () => {
    const receipt = toReceiptData(
      textractResponse(
        [[lineItem('Item A', '4.00'), lineItem('Item B', '6.00')]],
        summary({ SUBTOTAL: '10.00', TAX: '1.00', GRATUITY: '2.00', TOTAL: '13.00' })
      )
    );

    expect(receipt).toEqual({
      items: [
        { name: 'Item A', price: 4 },
        { name: 'Item B', price: 6 },
      ],
      subtotal: 10,
      tax: 1,
      tip: 2,
      total: 13,
    });
  });

  it('keeps a priced modifier row as its own line', () => {
    const receipt = toReceiptData(
      textractResponse([[lineItem('Item A', '4.00'), lineItem('Extra Topping', '1.50')]], summary({ SUBTOTAL: '5.50' }))
    );

    expect(receipt.items).toEqual([
      { name: 'Item A', price: 4 },
      { name: 'Extra Topping', price: 1.5 },
    ]);
  });

  it('keeps a counted line as one line at its line total', () => {
    const receipt = toReceiptData(
      textractResponse([[lineItem('Item C', '18.00', { QUANTITY: '2', UNIT_PRICE: '9.00' })]], summary({}))
    );

    expect(receipt.items).toEqual([{ name: '2 Item C', price: 18 }]);
  });

  it('does not repeat a count the name already carries', () => {
    const receipt = toReceiptData(textractResponse([[lineItem('2 Item C', '18.00', { QUANTITY: '2' })]], summary({})));

    expect(receipt.items).toEqual([{ name: '2 Item C', price: 18 }]);
  });

  it('keeps a discount as a negative line', () => {
    const receipt = toReceiptData(
      textractResponse(
        [[lineItem('Item A', '10.00'), lineItem('Discount', '-2.00'), lineItem('Item B', '5.00-')]],
        summary({ SUBTOTAL: '3.00' })
      )
    );

    expect(receipt.items).toEqual([
      { name: 'Item A', price: 10 },
      { name: 'Discount', price: -2 },
      { name: 'Item B', price: -5 },
    ]);
    expect(receipt.subtotal).toBe(3);
  });

  it('leaves tip and tax out when the receipt has none', () => {
    const receipt = toReceiptData(textractResponse([[lineItem('Item A', '10.00')]], summary({ SUBTOTAL: '10.00', TOTAL: '10.00' })));

    expect(receipt).toEqual({ items: [{ name: 'Item A', price: 10 }], subtotal: 10, total: 10 });
    expect('tip' in receipt).toBe(false);
    expect('tax' in receipt).toBe(false);
  });

  it('computes the subtotal from the items when none is printed', () => {
    const receipt = toReceiptData(
      textractResponse([[lineItem('Item A', '4.10'), lineItem('Item B', '6.20')]], summary({ TOTAL: '11.00' }))
    );

    expect(receipt.subtotal).toBe(10.3);
    expect(receipt.total).toBe(11);
  });

  it('refuses a receipt with no line items', () => {
    expect(() => toReceiptData(textractResponse([], summary({ TOTAL: '11.00' })))).toThrow(UnusableReceiptError);
    expect(() => toReceiptData(textractResponse([[]]))).toThrow(UnusableReceiptError);
    expect(() => toReceiptData({})).toThrow(UnusableReceiptError);
  });

  it('reads a price with a currency sign and thousands commas', () => {
    const receipt = toReceiptData(textractResponse([[lineItem('Item A', '$1,234.50')]], summary({ TOTAL: '$1,234.50' })));

    expect(receipt.items).toEqual([{ name: 'Item A', price: 1234.5 }]);
    expect(receipt.total).toBe(1234.5);
  });

  it('drops lines and totals whose prices cannot be read', () => {
    const receipt = toReceiptData(
      textractResponse(
        [[lineItem('Item A', '4.00'), lineItem('Item B', 'free'), lineItem('Item C', '12'), rowOnly('Item D 3.00')]],
        summary({ SUBTOTAL: 'n/a', TOTAL: '4.00 USD', TAX: '0.40' })
      )
    );

    expect(receipt).toEqual({ items: [{ name: 'Item A', price: 4 }], subtotal: 4, total: null, tax: 0.4 });
  });

  it('falls back to the row text when a line has no ITEM', () => {
    const receipt = toReceiptData(
      textractResponse([[{ LineItemExpenseFields: [{ Type: { Text: 'PRICE' }, ValueDetection: { Text: '3.00' } }, { Type: { Text: 'EXPENSE_ROW' }, ValueDetection: { Text: 'Item D  3.00' } }] }]], summary({}))
    );

    expect(receipt.items).toEqual([{ name: 'Item D 3.00', price: 3 }]);
  });

  it('reads every line item group in order', () => {
    const receipt = toReceiptData(
      textractResponse(
        [[lineItem('Item A', '4.00')], [lineItem('Item B', '6.00'), lineItem('Item C', '1.00')]],
        summary({ SUBTOTAL: '11.00' })
      )
    );

    expect(receipt.items.map((item) => item.name)).toEqual(['Item A', 'Item B', 'Item C']);
    expect(receipt.subtotal).toBe(11);
  });
});
