import { postWithHash } from '@/services/post';
import { ReceiptData } from '@/types';
import { OCRProvider } from './provider';

// Sends the receipt photo to /api/ocr, which reads it with the cloud provider. The photo is first
// downscaled to a JPEG in a canvas so a phone photo (often 8 MB or more) fits the route's 4 MB cap.

// 2000 px keeps 8-point receipt print about 25 px tall, well above what OCR needs, while a 1500 x
// 2000 JPEG at this quality is usually under 1 MB
export const MAX_LONG_EDGE = 2000;
const JPEG_QUALITY = 0.85;

// Statuses after which the browser's own OCR is worth trying
const FALLBACK_STATUSES = new Set([413, 422, 429, 502, 503]);

export type FallbackError = Error & { shouldFallback?: boolean };

export function markError(status: number, message: string, fallback?: boolean): FallbackError {
  const error: FallbackError = new Error(message);
  if (fallback || FALLBACK_STATUSES.has(status)) {
    error.shouldFallback = true;
  }
  return error;
}

// The size that fits within the long-edge limit, keeping the aspect ratio; never enlarges
export function fitWithin(width: number, height: number, maxEdge = MAX_LONG_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// A JPEG or PNG within the limit is sent as is; anything else is redrawn as a JPEG. When the
// browser cannot decode or draw the image, the original is sent and the server decides.
export async function downscale(image: Blob, maxEdge = MAX_LONG_EDGE): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image);
  } catch {
    return image;
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
    const unchanged = width === bitmap.width && height === bitmap.height;
    if (unchanged && (image.type === 'image/jpeg' || image.type === 'image/png')) {
      return image;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return image;
    context.drawImage(bitmap, 0, 0, width, height);

    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    );
    return jpeg ?? image;
  } finally {
    bitmap.close();
  }
}

export class CloudOCRProvider implements OCRProvider {
  readonly name = 'cloud';

  async extractReceipt(image: Blob, code: string): Promise<ReceiptData> {
    const formData = new FormData();
    formData.append('image', await downscale(image), 'receipt.jpg');
    formData.append('code', code);

    const response = await postWithHash('/api/ocr', formData);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw markError(response.status, data.error || 'Cloud OCR request failed', data.fallback);
    }
    return data as ReceiptData;
  }
}
