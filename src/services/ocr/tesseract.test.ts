import { describe, it, expect } from 'vitest';
import { TesseractProvider } from './tesseract';

describe('TesseractProvider', () => {
  const provider = new TesseractProvider();

  describe('parseReceiptText', () => {
    // Access the private method for testing
    const parseReceiptText = (text: string) => {
      return (provider as unknown as { parseReceiptText: (text: string) => unknown }).parseReceiptText(text);
    };

    it('extracts simple line items with prices', () => {
      const text = `
        Coffee $4.50
        Sandwich $12.99
        Cookie $2.50
      `;
      const result = parseReceiptText(text);
      expect(result.items).toHaveLength(3);
      expect(result.items[0]).toEqual({ name: 'Coffee', price: 4.50 });
      expect(result.items[1]).toEqual({ name: 'Sandwich', price: 12.99 });
      expect(result.items[2]).toEqual({ name: 'Cookie', price: 2.50 });
    });

    it('extracts prices without dollar sign', () => {
      const text = `
        Coffee 4.50
        Sandwich 12.99
      `;
      const result = parseReceiptText(text);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].price).toBe(4.50);
      expect(result.items[1].price).toBe(12.99);
    });

    it('extracts subtotal correctly', () => {
      const text = `
        Coffee $4.50
        Sandwich $12.99
        Subtotal $17.49
        Tax $1.40
        Total $18.89
      `;
      const result = parseReceiptText(text);
      expect(result.subtotal).toBe(17.49);
      expect(result.total).toBe(18.89);
      expect(result.items).toHaveLength(2); // Tax should be skipped
    });

    it('handles "Sub Total" with space', () => {
      const text = `
        Item 1 $10.00
        Sub Total $10.00
        Total $10.80
      `;
      const result = parseReceiptText(text);
      expect(result.subtotal).toBe(10.00);
    });

    it('skips tax, tip, and payment lines', () => {
      const text = `
        Burger $15.00
        Tax $1.20
        Tip $3.00
        Gratuity $0.00
        Visa Card $19.20
        Total $19.20
      `;
      const result = parseReceiptText(text);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('Burger');
    });

    it('removes quantity prefixes from item names', () => {
      const text = `
        2x Coffee $9.00
        1 Sandwich $12.99
        3 x Cookies $7.50
      `;
      const result = parseReceiptText(text);
      expect(result.items[0].name).toBe('Coffee');
      expect(result.items[1].name).toBe('Sandwich');
      expect(result.items[2].name).toBe('Cookies');
    });

    it('calculates subtotal from items if not found', () => {
      const text = `
        Coffee $4.50
        Sandwich $12.50
      `;
      const result = parseReceiptText(text);
      expect(result.subtotal).toBe(17.00);
    });

    it('handles European comma decimal format', () => {
      const text = `
        Coffee $4,50
        Sandwich $12,99
      `;
      const result = parseReceiptText(text);
      expect(result.items[0].price).toBe(4.50);
      expect(result.items[1].price).toBe(12.99);
    });

    it('ignores lines without prices', () => {
      const text = `
        RESTAURANT NAME
        123 Main Street
        Coffee $4.50
        Thank you!
      `;
      const result = parseReceiptText(text);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('Coffee');
    });

    it('handles "Grand Total" variant', () => {
      const text = `
        Item $10.00
        Grand Total $10.80
      `;
      const result = parseReceiptText(text);
      expect(result.total).toBe(10.80);
    });

    it('handles "Amount Due" variant', () => {
      const text = `
        Item $10.00
        Amount Due $10.80
      `;
      const result = parseReceiptText(text);
      expect(result.total).toBe(10.80);
    });

    it('includes raw text in result', () => {
      const text = 'Coffee $4.50';
      const result = parseReceiptText(text);
      expect(result.raw).toBe(text);
    });

    it('handles empty text', () => {
      const result = parseReceiptText('');
      expect(result.items).toHaveLength(0);
      expect(result.subtotal).toBeNull();
      expect(result.total).toBeNull();
    });

    it('skips credit card types', () => {
      const text = `
        Coffee $4.50
        Mastercard $4.50
        AMEX $4.50
        Debit $4.50
      `;
      const result = parseReceiptText(text);
      expect(result.items).toHaveLength(1);
    });
  });
});
