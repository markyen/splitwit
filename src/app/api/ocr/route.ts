import { NextRequest, NextResponse } from 'next/server';
import { getExpense } from '@/services/expenses';
import { ServerOCRProvider, UnusableReceiptError } from '@/services/ocr/server/provider';
import { TextractProvider } from '@/services/ocr/server/textract';

// Reads a receipt photo with the cloud provider named by OCR_PROVIDER ("textract", or "none" to
// send every scan to the browser's Tesseract). The image stays in memory and is never logged or
// stored; the one log line per request carries numbers and an exception name only. The route is
// open, so it is gated cheaply: a JPEG or PNG of at most 4 MB, read incrementally, and the share
// code of an expense that exists.

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

// Share codes are 6 characters from A-Z and 2-9, as the Firestore rules require
const SHARE_CODE = /^[A-Z2-9]{6}$/;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);

class StepError extends Error {
  constructor(message: string, readonly status: number, readonly fallback = false) {
    super(message);
  }
}

// The status for a provider failure, from the exception's name only
function providerStatus(name: string): StepError {
  if (name === 'ThrottlingException' || name === 'ProvisionedThroughputExceededException') {
    return new StepError('Cloud OCR is busy', 429, true);
  }
  // AccessDeniedException from Textract (a role without the permission, or the spend stop's deny);
  // CredentialsProviderError when the default chain finds no credentials, as in local development
  if (name.startsWith('AccessDenied') || name === 'CredentialsProviderError') {
    return new StepError('Cloud OCR is not available here', 503, true);
  }
  return new StepError('Cloud OCR failed', 502, true);
}

function getProvider(): ServerOCRProvider {
  const name = process.env.OCR_PROVIDER ?? 'none';
  if (name === 'textract') return new TextractProvider();
  throw new StepError('Cloud OCR not configured', 503, true);
}

// JPEG starts FF D8 FF; PNG starts 89 50 4E 47 0D 0A 1A 0A
function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((byte, i) => bytes[i] === byte)) {
    return 'image/png';
  }
  return null;
}

// Reads the body up to the cap, stopping as soon as it is exceeded
async function readBody(request: NextRequest): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get('content-length')) > MAX_IMAGE_BYTES) {
    throw new StepError('Image is too large', 413, true);
  }
  if (!request.body) {
    throw new StepError('No image provided', 400);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        throw new StepError('Image is too large', 413, true);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function readForm(request: NextRequest): Promise<{ image: File; code: string }> {
  const body = await readBody(request);
  let form: FormData;
  try {
    form = await new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': request.headers.get('content-type') ?? '' },
      body,
    }).formData();
  } catch {
    throw new StepError('No image provided', 400);
  }

  const image = form.get('image');
  const code = form.get('code');
  if (!(image instanceof File) || image.size === 0) {
    throw new StepError('No image provided', 400);
  }
  if (typeof code !== 'string' || !code) {
    throw new StepError('No share code provided', 400);
  }
  return { image, code };
}

export async function POST(request: NextRequest) {
  const started = Date.now();
  const providerName = process.env.OCR_PROVIDER ?? 'none';
  let status = 200;
  let bytes = 0;
  let items = 0;
  let exception: string | undefined;

  try {
    const provider = getProvider();
    const { image, code } = await readForm(request);
    bytes = image.size;

    if (!SHARE_CODE.test(code)) {
      throw new StepError('Expense not found', 404);
    }

    const imageBytes = new Uint8Array(await image.arrayBuffer());
    const mediaType = sniffImageType(imageBytes);
    if (!mediaType || !IMAGE_TYPES.has(image.type) || image.type !== mediaType) {
      throw new StepError('Image must be a JPEG or PNG', 415);
    }

    let expense;
    try {
      expense = await getExpense(code);
    } catch (error) {
      exception = error instanceof Error ? error.name : 'unknown';
      throw new StepError("Couldn't check the share code", 502, true);
    }
    if (!expense) {
      throw new StepError('Expense not found', 404);
    }

    let receipt;
    try {
      receipt = await provider.analyze(imageBytes, mediaType);
    } catch (error) {
      if (error instanceof UnusableReceiptError) {
        throw new StepError('No items found in receipt', 422, true);
      }
      exception = error instanceof Error ? error.name : 'unknown';
      throw providerStatus(exception);
    }

    items = receipt.items.length;
    return NextResponse.json(receipt);
  } catch (error) {
    const step = error instanceof StepError ? error : new StepError('Cloud OCR failed', 500, true);
    status = step.status;
    if (!(error instanceof StepError)) {
      exception = error instanceof Error ? error.name : 'unknown';
    }
    return NextResponse.json(
      step.fallback ? { error: step.message, fallback: true } : { error: step.message },
      { status }
    );
  } finally {
    console.info(
      `[API /ocr] status=${status} provider=${providerName} ms=${Date.now() - started} bytes=${bytes} items=${items}` +
        (exception ? ` exception=${exception}` : '')
    );
  }
}
