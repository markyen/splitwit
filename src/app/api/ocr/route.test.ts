// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { fakeFirestore } from '@/test/fakeFirestore';
import { lineItem, summary, textractResponse } from '@/test/textractReceipt';

const sendMock = vi.fn();
const getExpenseMock = vi.fn();
const clientConfigs: unknown[] = [];

vi.mock('@aws-sdk/client-textract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-textract')>();
  return {
    ...actual,
    TextractClient: class {
      send = sendMock;
      constructor(config: unknown) {
        clientConfigs.push(config);
      }
    },
  };
});

vi.mock('@/services/expenses', () => ({
  getExpense: (code: string) => getExpenseMock(code),
}));

// The scan limits' counters live in the in-memory Firestore
vi.mock('@/services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  const { fakeFirestore } = await import('@/test/fakeFirestore');
  return { ...actual, ...fakeFirestore.module };
});

import { OCR_LIMITS } from '@/services/ocr/server/limits';
import { POST, MAX_IMAGE_BYTES } from './route';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const GIF = new TextEncoder().encode('GIF89a0000');
const CODE = 'ABCDEF';

const RECEIPT = textractResponse(
  [[lineItem('Item A', '4.00'), lineItem('Item B', '6.00')]],
  summary({ SUBTOTAL: '10.00', TAX: '1.00', TOTAL: '11.00' })
);

const namedError = (name: string, message = `${name} body text`) => Object.assign(new Error(message), { name });

function post(parts: { image?: Blob | null; code?: string | null } = {}) {
  const form = new FormData();
  const image = parts.image === undefined ? new Blob([JPEG], { type: 'image/jpeg' }) : parts.image;
  if (image) form.append('image', image, 'receipt.jpg');
  const code = parts.code === undefined ? CODE : parts.code;
  if (code !== null) form.append('code', code);
  return POST(new NextRequest('http://localhost/api/ocr', { method: 'POST', body: form }));
}

const expectError = async (response: Response, status: number, fallback?: true) => {
  expect(response.status).toBe(status);
  const body = await response.json();
  expect(typeof body.error).toBe('string');
  expect(body.fallback).toBe(fallback);
  return body;
};

beforeEach(() => {
  fakeFirestore.reset();
  vi.stubEnv('OCR_PROVIDER', 'textract');
  vi.stubEnv('TEXTRACT_REGION', 'us-east-1');
  getExpenseMock.mockResolvedValue({ title: null, total: null, receiptUrl: null });
  sendMock.mockResolvedValue(RECEIPT);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  sendMock.mockReset();
  getExpenseMock.mockReset();
});

describe('POST /api/ocr', () => {
  it('returns the receipt read by Textract for a JPEG with a known code', async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        { name: 'Item A', price: 4 },
        { name: 'Item B', price: 6 },
      ],
      subtotal: 10,
      tax: 1,
      total: 11,
    });
    expect(getExpenseMock).toHaveBeenCalledWith(CODE);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0];
    expect(command.input.Document.Bytes).toEqual(JPEG);
  });

  it('accepts a PNG', async () => {
    const response = await post({ image: new Blob([PNG], { type: 'image/png' }) });

    expect(response.status).toBe(200);
  });

  it.each(['none', undefined, 'other'])('returns 503 with fallback when OCR_PROVIDER is %s', async (value) => {
    if (value === undefined) vi.stubEnv('OCR_PROVIDER', undefined as unknown as string);
    else vi.stubEnv('OCR_PROVIDER', value);

    await expectError(await post(), 503, true);
    expect(sendMock).not.toHaveBeenCalled();
    expect(getExpenseMock).not.toHaveBeenCalled();
  });

  it("uses the SDK's default credential chain, with only the region configured", async () => {
    expect((await post()).status).toBe(200);

    expect(clientConfigs.length).toBeGreaterThan(0);
    for (const config of clientConfigs) {
      expect(config).toEqual({ region: 'us-east-1' });
    }
  });

  it('returns 400 without an image', async () => {
    await expectError(await post({ image: null }), 400);
    await expectError(await post({ image: new Blob([], { type: 'image/jpeg' }) }), 400);
  });

  it('returns 400 without a code', async () => {
    await expectError(await post({ code: null }), 400);
    await expectError(await post({ code: '' }), 400);
  });

  it('returns 400 for a body that is not a form', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/ocr', { method: 'POST', body: JSON.stringify({ image: 'x' }) })
    );

    await expectError(response, 400);
  });

  it('returns 404 for an unknown or malformed code without calling Textract', async () => {
    getExpenseMock.mockResolvedValue(null);
    await expectError(await post(), 404);

    getExpenseMock.mockClear();
    await expectError(await post({ code: 'abc' }), 404);
    await expectError(await post({ code: 'ABCDE0' }), 404);
    expect(getExpenseMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(fakeFirestore.attempts).toBe(0);
    expect(fakeFirestore.paths()).toEqual([]);
  });

  it('returns 415 for a type other than JPEG or PNG, by declared type and by bytes', async () => {
    await expectError(await post({ image: new Blob([GIF], { type: 'image/gif' }) }), 415);
    await expectError(await post({ image: new Blob([GIF], { type: 'image/jpeg' }) }), 415);
    await expectError(await post({ image: new Blob([JPEG], { type: 'image/webp' }) }), 415);
    await expectError(await post({ image: new Blob([PNG], { type: 'image/jpeg' }) }), 415);
    expect(getExpenseMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns 413 for a body declared over 4 MB', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/ocr', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(MAX_IMAGE_BYTES + 1) },
        body: 'tiny',
      })
    );

    await expectError(response, 413, true);
  });

  it('returns 413 for an image over 4 MB', async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(JPEG);

    await expectError(await post({ image: new Blob([big], { type: 'image/jpeg' }) }), 413, true);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('stops reading an undeclared stream at 4 MB', async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(256 * 1024).fill(0x20));
      },
    });
    const response = await POST(
      new NextRequest('http://localhost/api/ocr', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
        body: endless,
        duplex: 'half',
      })
    );

    await expectError(response, 413, true);
    expect(pulls).toBeLessThan(20);
  });

  it('returns 422 with fallback when Textract finds no items', async () => {
    sendMock.mockResolvedValue(textractResponse([], summary({ TOTAL: '11.00' })));

    await expectError(await post(), 422, true);
  });

  it.each([
    ['ThrottlingException', 429],
    ['ProvisionedThroughputExceededException', 429],
    ['AccessDeniedException', 503],
    ['AccessDenied', 503],
    ['CredentialsProviderError', 503],
    ['UnsupportedDocumentException', 502],
    ['BadDocumentException', 502],
    ['InvalidParameterException', 502],
    ['InternalServerError', 502],
    ['TypeError', 502],
  ])('maps %s to %i with fallback', async (name, status) => {
    sendMock.mockRejectedValue(namedError(name));

    await expectError(await post(), status, true);
  });

  it('returns 502 with fallback when the code cannot be checked', async () => {
    getExpenseMock.mockRejectedValue(namedError('FirebaseError'));

    await expectError(await post(), 502, true);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('logs one line per request with numbers and the exception name only', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined)
    );
    const marker = 'MARKER-7f3a9c-RECEIPT-TEXT';
    const image = new Blob([JPEG, new TextEncoder().encode(marker)], { type: 'image/jpeg' });

    sendMock.mockResolvedValueOnce(RECEIPT);
    sendMock.mockRejectedValueOnce(namedError('ThrottlingException', `rate exceeded for ${marker} Item A Test Bistro`));
    sendMock.mockRejectedValueOnce(new Error(`plain failure ${marker}`));
    sendMock.mockResolvedValueOnce(textractResponse([], summary({})));
    getExpenseMock.mockResolvedValueOnce({ title: null, total: null, receiptUrl: null });
    getExpenseMock.mockResolvedValueOnce({ title: null, total: null, receiptUrl: null });
    getExpenseMock.mockResolvedValueOnce({ title: null, total: null, receiptUrl: null });
    getExpenseMock.mockResolvedValueOnce({ title: null, total: null, receiptUrl: null });
    getExpenseMock.mockRejectedValueOnce(namedError('FirebaseError', `permission denied for ${marker}`));

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await post({ image })).status);
    }
    statuses.push((await post({ image, code: `${marker}` })).status);
    statuses.push((await post({ image: new Blob([GIF, new TextEncoder().encode(marker)], { type: 'image/gif' }) })).status);

    expect(statuses).toEqual([200, 429, 502, 422, 502, 404, 415]);
    const calls = spies.flatMap((spy) => spy.mock.calls);
    expect(calls).toHaveLength(7);
    const logged = JSON.stringify(calls);
    expect(logged).not.toContain(marker);
    expect(logged).not.toContain('Item A');
    expect(logged).not.toContain('Test Bistro');
    expect(logged).not.toContain('rate exceeded');
    expect(logged).not.toContain('permission denied');
    expect(logged).toContain('exception=ThrottlingException');
    expect(logged).toContain('status=200');
    expect(logged).toContain('items=2');
  });
});

describe('POST /api/ocr scan limits', () => {
  const EXPENSE_USAGE = `expenses/${CODE}/usage/ocr`;
  const GLOBAL_USAGE = 'usage/ocr';
  const WINDOW_MS = OCR_LIMITS.windowSeconds * 1000;
  const T0 = Date.UTC(2030, 0, 1, 12);
  const at = (ms: number) => fakeFirestore.timestamp(ms);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts both counts on the first call', async () => {
    expect((await post()).status).toBe(200);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(fakeFirestore.get(EXPENSE_USAGE)).toEqual({ windowStart: at(T0), count: 1 });
    expect(fakeFirestore.get(GLOBAL_USAGE)).toEqual({ windowStart: at(T0), count: 1 });
  });

  it('calls Textract for the last call under both limits, and counts it', async () => {
    fakeFirestore.seed(EXPENSE_USAGE, { windowStart: at(T0 - 60_000), count: OCR_LIMITS.perExpense - 1 });
    fakeFirestore.seed(GLOBAL_USAGE, { windowStart: at(T0 - 120_000), count: OCR_LIMITS.global - 1 });

    expect((await post()).status).toBe(200);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(fakeFirestore.get(EXPENSE_USAGE)).toEqual({ windowStart: at(T0 - 60_000), count: OCR_LIMITS.perExpense });
    expect(fakeFirestore.get(GLOBAL_USAGE)).toEqual({ windowStart: at(T0 - 120_000), count: OCR_LIMITS.global });
  });

  it.each([
    ['expense', EXPENSE_USAGE, OCR_LIMITS.perExpense],
    ['global', GLOBAL_USAGE, OCR_LIMITS.global],
  ])('returns 429 with Retry-After at the %s limit, without calling Textract', async (limit, path, max) => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    fakeFirestore.seed(path, { windowStart: at(T0 - 10 * 60_000), count: max });

    const response = await post();

    const body = await expectError(response, 429, true);
    expect(body.error).toBe('Too many scans, try again later');
    expect(response.headers.get('retry-after')).toBe(String(OCR_LIMITS.windowSeconds - 10 * 60));
    expect(sendMock).not.toHaveBeenCalled();
    expect(fakeFirestore.paths()).toEqual([path]);
    expect(fakeFirestore.get(path)).toEqual({ windowStart: at(T0 - 10 * 60_000), count: max });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toContain(`status=429`);
    expect(info.mock.calls[0][0]).toContain(`limit=${limit}`);
  });

  it('starts a new window once the old one is over', async () => {
    for (let i = 0; i < OCR_LIMITS.perExpense; i++) {
      expect((await post()).status).toBe(200);
    }

    vi.setSystemTime(T0 + WINDOW_MS - 1000);
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('1');
    expect(fakeFirestore.get(EXPENSE_USAGE)).toEqual({ windowStart: at(T0), count: OCR_LIMITS.perExpense });

    vi.setSystemTime(T0 + WINDOW_MS);
    expect((await post()).status).toBe(200);

    expect(sendMock).toHaveBeenCalledTimes(OCR_LIMITS.perExpense + 1);
    expect(fakeFirestore.get(EXPENSE_USAGE)).toEqual({ windowStart: at(T0 + WINDOW_MS), count: 1 });
    expect(fakeFirestore.get(GLOBAL_USAGE)).toEqual({ windowStart: at(T0 + WINDOW_MS), count: 1 });
  });

  it.each([
    ['expense', EXPENSE_USAGE, OCR_LIMITS.perExpense, () => CODE],
    ['global', GLOBAL_USAGE, OCR_LIMITS.global, (i: number) => `ABCDE${'ABCDEFGHJK'[i]}`],
  ])('lets parallel requests take only the calls left under the %s limit', async (_limit, path, max, codeFor) => {
    fakeFirestore.seed(path, { windowStart: at(T0), count: max - 3 });

    const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => post({ code: codeFor(i) })));

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 200, 200, 429, 429, 429, 429, 429, 429, 429]);
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(fakeFirestore.get(path)).toEqual({ windowStart: at(T0), count: max });
    // The requests did overlap: some commits found a count changed since their read, and retried
    expect(fakeFirestore.conflicts).toBeGreaterThan(0);
  });

  it('returns 502 with fallback when the counts cannot be read or written', async () => {
    fakeFirestore.failure = namedError('FirebaseError');

    await expectError(await post(), 502, true);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('has the window that firestore.rules waits out before a count may restart', () => {
    const rules = readFileSync(new URL('../../../../firestore.rules', import.meta.url), 'utf8');

    expect(rules).toContain(`duration.value(${OCR_LIMITS.windowSeconds}, 's')`);
  });
});
