import { afterEach, describe, it, expect, vi } from 'vitest';
import { postWithHash } from '@/services/post';
import { CloudOCRProvider, downscale, fitWithin, markError, MAX_LONG_EDGE } from './cloud';

// The encoding and the hash are post.test.ts's; here, what is posted and what is made of the reply
vi.mock('@/services/post', () => ({ postWithHash: vi.fn() }));
const postMock = vi.mocked(postWithHash);

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

// The image decode and the canvas, which jsdom does not implement
function stubImage(width: number, height: number) {
  const bitmap = { width, height, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  const context = { drawImage: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  );
  const drawn: { width: number; height: number }[] = [];
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation(function (this: HTMLCanvasElement, callback, type) {
      drawn.push({ width: this.width, height: this.height });
      callback(new Blob(['jpeg'], { type: String(type) }));
    });
  return { bitmap, context, toBlob, drawn };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  postMock.mockReset();
});

describe('fitWithin', () => {
  it('never enlarges', () => {
    expect(fitWithin(800, 1200)).toEqual({ width: 800, height: 1200 });
  });

  it('shrinks the long edge to the limit and keeps the aspect ratio', () => {
    expect(fitWithin(3000, 4000)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(5000, 1000, 1000)).toEqual({ width: 1000, height: 200 });
  });
});

describe('downscale', () => {
  it('leaves a small JPEG alone', async () => {
    const { context, toBlob } = stubImage(800, 1200);
    const image = new Blob([JPEG_BYTES], { type: 'image/jpeg' });

    expect(await downscale(image)).toBe(image);
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(toBlob).not.toHaveBeenCalled();
  });

  it('shrinks a large image to a JPEG within the limit', async () => {
    const { bitmap, context, toBlob, drawn } = stubImage(3000, 4000);
    const image = new Blob([JPEG_BYTES], { type: 'image/jpeg' });

    const result = await downscale(image);

    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1500, 2000);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', expect.any(Number));
    expect(result.type).toBe('image/jpeg');
    expect(drawn).toEqual([{ width: 1500, height: 2000 }]);
    expect(Math.max(drawn[0].width, drawn[0].height)).toBe(MAX_LONG_EDGE);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('redraws a small image of another type as a JPEG', async () => {
    const { toBlob } = stubImage(800, 1200);

    const result = await downscale(new Blob(['webp'], { type: 'image/webp' }));

    expect(toBlob).toHaveBeenCalled();
    expect(result.type).toBe('image/jpeg');
  });

  it('sends the original when the browser cannot decode it', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')));
    const image = new Blob(['heic'], { type: 'image/heic' });

    expect(await downscale(image)).toBe(image);
  });
});

describe('markError', () => {
  it.each([413, 422, 429, 502, 503])('marks a %i as fallback-eligible', (status) => {
    expect(markError(status, 'x').shouldFallback).toBe(true);
  });

  it.each([400, 404, 415, 500])('leaves a %i unmarked unless the body says so', (status) => {
    expect(markError(status, 'x').shouldFallback).toBeUndefined();
    expect(markError(status, 'x', true).shouldFallback).toBe(true);
  });
});

describe('CloudOCRProvider', () => {
  it('posts the downscaled image and the share code, and marks the error from the status', async () => {
    stubImage(800, 1200);
    postMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Cloud OCR is busy', fallback: true }), { status: 429 })
    );

    const provider = new CloudOCRProvider();
    await expect(provider.extractReceipt(new Blob([JPEG_BYTES], { type: 'image/jpeg' }), 'ABCDEF')).rejects.toMatchObject({
      message: 'Cloud OCR is busy',
      shouldFallback: true,
    });

    const [url, body] = postMock.mock.calls[0];
    expect(url).toBe('/api/ocr');
    const form = body as FormData;
    expect(form.get('code')).toBe('ABCDEF');
    expect(form.get('image')).toBeInstanceOf(Blob);
  });

  it('returns the receipt on success', async () => {
    stubImage(800, 1200);
    const receipt = { items: [{ name: 'Item A', price: 10 }], subtotal: 10, total: 11 };
    postMock.mockResolvedValue(new Response(JSON.stringify(receipt), { status: 200 }));

    expect(await new CloudOCRProvider().extractReceipt(new Blob([JPEG_BYTES], { type: 'image/jpeg' }), 'ABCDEF')).toEqual(receipt);
  });
});
