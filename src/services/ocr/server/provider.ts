import type { ReceiptData } from '@/types';

// A receipt reader that runs on the server, behind /api/ocr
export interface ServerOCRProvider {
  readonly name: string;

  /**
   * Read a receipt image. Throws UnusableReceiptError when no items can be read; any other
   * error is the provider's own.
   */
  analyze(bytes: Uint8Array, mediaType: string): Promise<ReceiptData>;
}

export class UnusableReceiptError extends Error {}
