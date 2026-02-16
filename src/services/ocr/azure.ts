import { ReceiptData } from '@/types';
import { OCRProvider } from './provider';

export class AzureDocIntelProvider implements OCRProvider {
  readonly name = 'azure-doc-intel';

  async extractReceipt(image: Blob): Promise<ReceiptData> {
    const formData = new FormData();
    formData.append('image', image);

    const response = await fetch('/api/ocr', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      // Include fallback hint in error for the FallbackOCRProvider
      const error = new Error(data.error || 'Azure OCR request failed');
      if (data.fallback || response.status === 429 || response.status === 503) {
        // Mark as a fallback-eligible error
        (error as Error & { shouldFallback?: boolean }).shouldFallback = true;
      }
      throw error;
    }

    return data as ReceiptData;
  }
}
