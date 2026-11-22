// @vitest-environment node
// Node's FormData and Response encode multipart as a browser does; jsdom's FormData is not one
// they can encode.
import { createHash } from 'node:crypto';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { postWithHash } from './post';

function stubFetch() {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sent(fetchMock: ReturnType<typeof stubFetch>) {
  const [url, init] = fetchMock.mock.calls[0];
  const headers = new Headers(init?.headers);
  const bytes = init?.body as Uint8Array<ArrayBuffer>;
  return { url, init, headers, bytes };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postWithHash', () => {
  it('sends JSON with the SHA-256 of the bytes sent', async () => {
    const fetchMock = stubFetch();

    await postWithHash('/api/receipt-link', { url: 'https://example.com/r/1' });

    const { url, init, headers, bytes } = sent(fetchMock);
    expect(url).toBe('/api/receipt-link');
    expect(init?.method).toBe('POST');
    expect(headers.get('content-type')).toBe('application/json');
    expect(new TextDecoder().decode(bytes)).toBe('{"url":"https://example.com/r/1"}');
    expect(headers.get('x-amz-content-sha256')).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('hashes an empty object as its two bytes', async () => {
    const fetchMock = stubFetch();

    await postWithHash('/api/x', {});

    expect(sent(fetchMock).headers.get('x-amz-content-sha256')).toBe(
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
    );
  });

  it('sends without the hash where there is no SubtleCrypto, as on plain http', async () => {
    const fetchMock = stubFetch();
    vi.stubGlobal('crypto', {});

    await postWithHash('/api/receipt-link', { url: 'https://example.com/r/1' });

    const { headers, bytes } = sent(fetchMock);
    expect(headers.has('x-amz-content-sha256')).toBe(false);
    expect(headers.get('content-type')).toBe('application/json');
    expect(new TextDecoder().decode(bytes)).toBe('{"url":"https://example.com/r/1"}');
  });

  it('sends a form as multipart bytes that decode back to the same fields', async () => {
    const fetchMock = stubFetch();
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }), 'receipt.jpg');
    form.append('code', 'ABCDEF');

    await postWithHash('/api/ocr', form);

    const { headers, bytes } = sent(fetchMock);
    const type = headers.get('content-type') ?? '';
    expect(type).toMatch(/^multipart\/form-data; boundary=/);
    expect(headers.get('x-amz-content-sha256')).toBe(createHash('sha256').update(bytes).digest('hex'));

    const decoded = await new Response(bytes, { headers: { 'content-type': type } }).formData();
    expect(decoded.get('code')).toBe('ABCDEF');
    const image = decoded.get('image') as File;
    expect(image.type).toBe('image/jpeg');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
  });
});
