import { ReceiptData } from '@/types';

export interface OCRProvider {
  /**
   * Extract receipt data from an image
   * @param image - The image blob to process
   * @param code - The share code of the expense the receipt belongs to
   * @returns Structured receipt data with items, subtotal, and total
   */
  extractReceipt(image: Blob, code: string): Promise<ReceiptData>;

  /**
   * Provider name for debugging/logging
   */
  readonly name: string;
}
