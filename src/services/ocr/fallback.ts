import { ReceiptData } from '@/types';
import { OCRProvider } from './provider';

export class FallbackOCRProvider implements OCRProvider {
  readonly name = 'fallback';
  private providers: OCRProvider[];

  constructor(providers: OCRProvider[]) {
    if (providers.length === 0) {
      throw new Error('FallbackOCRProvider requires at least one provider');
    }
    this.providers = providers;
  }

  async extractReceipt(image: Blob): Promise<ReceiptData> {
    let lastError: Error | null = null;

    for (const provider of this.providers) {
      try {
        console.log(`[OCR] Attempting extraction with ${provider.name}...`);
        const result = await provider.extractReceipt(image);
        console.log(`[OCR] Successfully extracted receipt with ${provider.name}`);
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[OCR] ${provider.name} failed: ${errorMessage}`);
        lastError = error instanceof Error ? error : new Error(errorMessage);

        // Check if this is a quota/rate limit error from Azure
        if (this.isQuotaError(error)) {
          console.log(`[OCR] Quota exceeded for ${provider.name}, trying next provider...`);
          continue;
        }

        // Check if credentials are not configured
        if (this.isConfigurationError(error)) {
          console.log(`[OCR] ${provider.name} not configured, trying next provider...`);
          continue;
        }

        // For other errors, also try the next provider
        console.log(`[OCR] Trying next provider...`);
        continue;
      }
    }

    // All providers failed
    throw new Error(
      `All OCR providers failed. Last error: ${lastError?.message || 'Unknown error'}`
    );
  }

  private isQuotaError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (
      message.includes('quota') ||
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('429') ||
      message.includes('exceeded')
    );
  }

  private isConfigurationError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (
      message.includes('not configured') ||
      message.includes('credentials') ||
      message.includes('unauthorized') ||
      message.includes('401')
    );
  }
}
