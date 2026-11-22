import { OCRProvider } from './provider';
import { TesseractProvider } from './tesseract';
import { CloudOCRProvider } from './cloud';
import { FallbackOCRProvider } from './fallback';

// The active OCR provider: the cloud route first, then Tesseract.js in the browser

let ocrProvider: OCRProvider | null = null;

export function getOCRProvider(): OCRProvider {
  if (!ocrProvider) {
    const providers: OCRProvider[] = [new CloudOCRProvider(), new TesseractProvider()];
    ocrProvider = new FallbackOCRProvider(providers);
  }
  return ocrProvider;
}

export type { OCRProvider };
export { TesseractProvider, CloudOCRProvider, FallbackOCRProvider };
