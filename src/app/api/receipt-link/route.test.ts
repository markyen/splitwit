// @vitest-environment node
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { row, spacer, toastReceiptPage } from '@/test/toastReceipt';
import { lineItem, squareReceiptPage, totals, totalsRow } from '@/test/squareReceipt';

const LINK = 'https://www.toasttab.com/receipts/TestReceiptId0000000000/TestCheckId00';

const PAGE = toastReceiptPage([
  row('Item A', '$10.00'),
  spacer(),
  row('Subtotal', '$10.00'),
  row('Tax', '$1.00'),
  row('Total', '$11.00'),
].join('\n'));

const SQUARE_LINK = 'https://squareup.com/r/TestSquareId00000000000';

const SQUARE_PAGE = squareReceiptPage(
  [
    lineItem('Item B', '$20.00'),
    totals([totalsRow('Purchase Subtotal', '$20.00'), totalsRow('Tip', '$4.00'), totalsRow('Total', '$24.00')].join('')),
  ].join('')
);

const fetchMock = vi.fn<typeof fetch>();

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/receipt-link', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );

const htmlResponse = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

const abortError = () => new DOMException('The operation was aborted', 'AbortError');

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

describe('POST /api/receipt-link', () => {
  it('fetches the page without following redirects and returns the parsed receipt', async () => {
    fetchMock.mockResolvedValue(htmlResponse(PAGE));

    const response = await post({ url: LINK });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [{ name: 'Item A', price: 10 }],
      subtotal: 10,
      total: 11,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(LINK);
    expect(init).toMatchObject({ redirect: 'manual', cache: 'no-store' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('accepts ids with the base64url characters - and _', async () => {
    fetchMock.mockResolvedValue(htmlResponse(PAGE));
    const link = 'https://www.toasttab.com/receipts/Test-Receipt_Id000000000/Test_Check-00';

    const response = await post({ url: link });

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe(link);
  });

  it('fetches a Square link\'s page without its query and returns the parsed receipt', async () => {
    fetchMock.mockImplementation(async () => htmlResponse(SQUARE_PAGE));

    for (const url of [SQUARE_LINK, `${SQUARE_LINK}?sms=1`]) {
      const response = await post({ url });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        items: [{ name: 'Item B', price: 20 }],
        subtotal: 20,
        total: 24,
      });
    }
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([SQUARE_LINK, SQUARE_LINK]);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ redirect: 'manual', cache: 'no-store' });
  });

  it('reads a Toast page with the Toast parser and a Square page with the Square parser', async () => {
    fetchMock.mockResolvedValue(htmlResponse(PAGE));
    expect((await post({ url: SQUARE_LINK })).status).toBe(422);

    fetchMock.mockResolvedValue(htmlResponse(SQUARE_PAGE));
    expect((await post({ url: LINK })).status).toBe(422);
  });

  it.each([
    ['another scheme', 'http://squareup.com/r/AbC123'],
    ['another host', 'https://www.squareup.com/r/AbC123'],
    ['a lookalike host', 'https://squareup.com.example.com/r/AbC123'],
    ['a port', 'https://squareup.com:443/r/AbC123'],
    ['userinfo', 'https://user@squareup.com/r/AbC123'],
    ['another path', 'https://squareup.com/receipts/AbC123'],
    ['an extra path', 'https://squareup.com/r/AbC123/more'],
    ['a trailing slash', 'https://squareup.com/r/AbC123/'],
    ['a missing id', 'https://squareup.com/r/'],
    ['an encoded path', 'https://squareup.com/r/%2E%2E'],
    ['an empty query', 'https://squareup.com/r/AbC123?'],
    ['a query with other characters', 'https://squareup.com/r/AbC123?next=/x'],
    ['a fragment', 'https://squareup.com/r/AbC123?sms=1#x'],
  ])('refuses a Square link with %s', async (_case, url) => {
    const response = await post({ url });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Not a Toast or Square receipt link' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['another scheme', 'http://www.toasttab.com/receipts/AbC123/XyZ789'],
    ['another host', 'https://toasttab.com/receipts/AbC123/XyZ789'],
    ['a lookalike host', 'https://www.toasttab.com.example.com/receipts/AbC123/XyZ789'],
    ['a different case', 'https://WWW.TOASTTAB.COM/receipts/AbC123/XyZ789'],
    ['a port', 'https://www.toasttab.com:443/receipts/AbC123/XyZ789'],
    ['userinfo', 'https://user:pass@www.toasttab.com/receipts/AbC123/XyZ789'],
    ['a query', 'https://www.toasttab.com/receipts/AbC123/XyZ789?x=1'],
    ['a fragment', 'https://www.toasttab.com/receipts/AbC123/XyZ789#x'],
    ['an extra path', 'https://www.toasttab.com/receipts/AbC123/XyZ789/more'],
    ['a trailing slash', 'https://www.toasttab.com/receipts/AbC123/XyZ789/'],
    ['a missing id', 'https://www.toasttab.com/receipts/AbC123'],
    ['a non-base64url id', 'https://www.toasttab.com/receipts/AbC.123/XyZ789'],
    ['an encoded path', 'https://www.toasttab.com/receipts/%2E%2E/XyZ789'],
    ['a trailing newline', 'https://www.toasttab.com/receipts/AbC123/XyZ789\n'],
    ['surrounding text', `see ${LINK}`],
  ])('refuses a link with %s', async (_case, url) => {
    const response = await post({ url });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Not a Toast or Square receipt link' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing url', {}],
    ['a non-string url', { url: 42 }],
    ['a body that is not JSON', 'not json'],
  ])('refuses %s', async (_case, body) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([301, 302, 303, 307, 308])('refuses a %i redirect', async (status) => {
    fetchMock.mockResolvedValue(
      new Response(null, { status, headers: { location: 'https://example.com/' } })
    );

    const response = await post({ url: LINK });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Receipt page redirected' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes on the parser refusing the page', async () => {
    fetchMock.mockResolvedValue(htmlResponse(PAGE.replace(/<tr><td style="">Total<\/td>.*?<\/tr>/, '')));

    const response = await post({ url: LINK });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'Receipt totals not found' });
  });

  it('refuses an error status and a failed fetch', async () => {
    fetchMock.mockResolvedValueOnce(new Response('gone', { status: 404 }));
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    for (let i = 0; i < 2; i++) {
      const response = await post({ url: LINK });
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "Couldn't fetch the receipt page" });
    }
  });

  it('refuses a page that is not HTML', async () => {
    fetchMock.mockResolvedValue(
      new Response(PAGE, { headers: { 'content-type': 'application/json' } })
    );

    const response = await post({ url: LINK });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Receipt page isn't HTML" });
  });

  it('refuses a page declared larger than 1 MB', async () => {
    fetchMock.mockResolvedValue(htmlResponse(PAGE, { 'content-length': '1000001' }));

    const response = await post({ url: LINK });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Receipt page is too large' });
  });

  it('stops reading an undeclared body at 1 MB', async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(64 * 1024).fill(0x20));
      },
    });
    fetchMock.mockResolvedValue(htmlResponse(endless));

    const response = await post({ url: LINK });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Receipt page is too large' });
    expect(pulls).toBeLessThan(20);
  });

  it('times out after 10 seconds waiting for a response', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(abortError()));
        })
    );

    const pending = post({ url: LINK });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: 'Receipt page timed out' });
  });

  it('times out after 10 seconds reading a stalled body', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchMock.mockImplementation(async (_url, init) => {
      const stalled = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('<html>'));
          init?.signal?.addEventListener('abort', () => controller.error(abortError()));
        },
      });
      return htmlResponse(stalled);
    });

    const pending = post({ url: LINK });
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await pending;

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: 'Receipt page timed out' });
  });

  it('never logs the link or the page', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined)
    );
    fetchMock.mockResolvedValueOnce(htmlResponse(PAGE));
    fetchMock.mockResolvedValueOnce(htmlResponse(PAGE.replace('$11.00', 'none')));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: LINK } }));
    fetchMock.mockRejectedValueOnce(new TypeError(`fetch failed for ${LINK}`));

    for (let i = 0; i < 4; i++) {
      await post({ url: LINK });
    }
    await post({ url: `${LINK}?leak=1` });
    fetchMock.mockResolvedValueOnce(htmlResponse(SQUARE_PAGE.replace('$24.00', 'none')));
    await post({ url: `${SQUARE_LINK}?sms=1` });

    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain('TestReceiptId');
    expect(logged).not.toContain('TestSquareId');
    expect(logged).not.toContain('Item B');
    expect(logged).not.toContain('Item A');
    expect(logged).not.toContain('Test Bistro');
  });
});
