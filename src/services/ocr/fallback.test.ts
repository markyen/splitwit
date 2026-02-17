import { describe, it, expect, vi } from 'vitest';
import { FallbackOCRProvider } from './fallback';
import { OCRProvider } from './provider';
import { ReceiptData } from '@/types';

const createMockProvider = (
  name: string,
  result?: ReceiptData,
  error?: Error
): OCRProvider => ({
  name,
  extractReceipt: vi.fn().mockImplementation(async () => {
    if (error) throw error;
    return result;
  }),
});

const mockReceiptData: ReceiptData = {
  items: [{ name: 'Coffee', price: 4.50 }],
  subtotal: 4.50,
  total: 4.86,
  raw: 'Coffee $4.50',
};

describe('FallbackOCRProvider', () => {
  it('uses the first provider when it succeeds', async () => {
    const primary = createMockProvider('primary', mockReceiptData);
    const fallback = createMockProvider('fallback', mockReceiptData);

    const provider = new FallbackOCRProvider([primary, fallback]);
    const result = await provider.extractReceipt(new Blob());

    expect(result).toEqual(mockReceiptData);
    expect(primary.extractReceipt).toHaveBeenCalledTimes(1);
    expect(fallback.extractReceipt).not.toHaveBeenCalled();
  });

  it('falls back to second provider when first fails', async () => {
    const primary = createMockProvider('primary', undefined, new Error('Primary failed'));
    const fallback = createMockProvider('fallback', mockReceiptData);

    const provider = new FallbackOCRProvider([primary, fallback]);
    const result = await provider.extractReceipt(new Blob());

    expect(result).toEqual(mockReceiptData);
    expect(primary.extractReceipt).toHaveBeenCalledTimes(1);
    expect(fallback.extractReceipt).toHaveBeenCalledTimes(1);
  });

  it('falls back on quota exceeded errors', async () => {
    const primary = createMockProvider('primary', undefined, new Error('Quota exceeded'));
    const fallback = createMockProvider('fallback', mockReceiptData);

    const provider = new FallbackOCRProvider([primary, fallback]);
    const result = await provider.extractReceipt(new Blob());

    expect(result).toEqual(mockReceiptData);
    expect(fallback.extractReceipt).toHaveBeenCalled();
  });

  it('falls back on rate limit errors', async () => {
    const primary = createMockProvider('primary', undefined, new Error('429 Too Many Requests'));
    const fallback = createMockProvider('fallback', mockReceiptData);

    const provider = new FallbackOCRProvider([primary, fallback]);
    const result = await provider.extractReceipt(new Blob());

    expect(result).toEqual(mockReceiptData);
    expect(fallback.extractReceipt).toHaveBeenCalled();
  });

  it('falls back on configuration errors', async () => {
    const primary = createMockProvider('primary', undefined, new Error('Credentials not configured'));
    const fallback = createMockProvider('fallback', mockReceiptData);

    const provider = new FallbackOCRProvider([primary, fallback]);
    const result = await provider.extractReceipt(new Blob());

    expect(result).toEqual(mockReceiptData);
    expect(fallback.extractReceipt).toHaveBeenCalled();
  });

  it('throws when all providers fail', async () => {
    const primary = createMockProvider('primary', undefined, new Error('Primary failed'));
    const fallback = createMockProvider('fallback', undefined, new Error('Fallback failed'));

    const provider = new FallbackOCRProvider([primary, fallback]);

    await expect(provider.extractReceipt(new Blob())).rejects.toThrow(
      'All OCR providers failed'
    );
  });

  it('includes last error message when all providers fail', async () => {
    const primary = createMockProvider('primary', undefined, new Error('Primary failed'));
    const fallback = createMockProvider('fallback', undefined, new Error('Fallback failed'));

    const provider = new FallbackOCRProvider([primary, fallback]);

    await expect(provider.extractReceipt(new Blob())).rejects.toThrow(
      'Fallback failed'
    );
  });

  it('requires at least one provider', () => {
    expect(() => new FallbackOCRProvider([])).toThrow(
      'FallbackOCRProvider requires at least one provider'
    );
  });

  it('has correct name', () => {
    const provider = new FallbackOCRProvider([
      createMockProvider('test', mockReceiptData),
    ]);
    expect(provider.name).toBe('fallback');
  });

  it('tries providers in order', async () => {
    const callOrder: string[] = [];

    const first: OCRProvider = {
      name: 'first',
      extractReceipt: vi.fn().mockImplementation(async () => {
        callOrder.push('first');
        throw new Error('First failed');
      }),
    };

    const second: OCRProvider = {
      name: 'second',
      extractReceipt: vi.fn().mockImplementation(async () => {
        callOrder.push('second');
        throw new Error('Second failed');
      }),
    };

    const third: OCRProvider = {
      name: 'third',
      extractReceipt: vi.fn().mockImplementation(async () => {
        callOrder.push('third');
        return mockReceiptData;
      }),
    };

    const provider = new FallbackOCRProvider([first, second, third]);
    await provider.extractReceipt(new Blob());

    expect(callOrder).toEqual(['first', 'second', 'third']);
  });
});
