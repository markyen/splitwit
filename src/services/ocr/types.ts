import { ReceiptData } from '@/types';

export interface OCRProvider {
  /**
   * Extract receipt data from an image
   * @param image - The image blob to process
   * @returns Structured receipt data with items, subtotal, and total
   */
  extractReceipt(image: Blob): Promise<ReceiptData>;
}
