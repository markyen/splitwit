import { OCRProvider } from './provider';
import { TesseractProvider } from './tesseract';
import { AzureDocIntelProvider } from './azure';
import { FallbackOCRProvider } from './fallback';

// Export the active OCR provider
// Uses Azure Document Intelligence as primary, with Tesseract.js as fallback

let ocrProvider: OCRProvider | null = null;

export function getOCRProvider(): OCRProvider {
  if (!ocrProvider) {
    // Create providers in priority order: Azure first, then Tesseract
    const providers: OCRProvider[] = [
      new AzureDocIntelProvider(),
      new TesseractProvider(),
    ];
    ocrProvider = new FallbackOCRProvider(providers);
  }
  return ocrProvider;
}

// Export types
export type { OCRProvider };
export { TesseractProvider, AzureDocIntelProvider, FallbackOCRProvider };
