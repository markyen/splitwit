import { OCRProvider } from './provider';
import { TesseractProvider } from './tesseract';

// Export the active OCR provider
// This can be swapped to a different provider (e.g., Claude, Textract) later

let ocrProvider: OCRProvider | null = null;

export function getOCRProvider(): OCRProvider {
  if (!ocrProvider) {
    ocrProvider = new TesseractProvider();
  }
  return ocrProvider;
}

// Export types
export type { OCRProvider };
export { TesseractProvider };
