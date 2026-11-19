import { NextRequest, NextResponse } from 'next/server';
import type { ReceiptData } from '@/types';
import { ReceiptParseError } from '@/services/receipt-link/html';
import { parseSquareReceipt } from '@/services/receipt-link/square';
import { parseToastReceipt } from '@/services/receipt-link/toast';

// Reads a Toast or Square receipt link server-side (neither sends CORS headers). The link is a
// bearer link to someone's receipt: it is never logged or stored, and errors name only the failing
// step.

// Each link is matched in full, so any other scheme, host, port, userinfo, fragment or path is
// refused, and only the page's own address, rebuilt from the ids, is fetched. Ids are base64url
// (a 22-character id is a 128-bit value), which can't hold "/", "." or "%". A Square link sent by
// text carries a query ("?sms=1"); it is accepted in plain characters and left off the fetch.
const RECEIPT_LINKS: {
  pattern: RegExp;
  page: (ids: string[]) => string;
  parse: (html: string) => ReceiptData;
}[] = [
  {
    pattern: /^https:\/\/www\.toasttab\.com\/receipts\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_-]{1,64})$/,
    page: ([receipt, check]) => `https://www.toasttab.com/receipts/${receipt}/${check}`,
    parse: parseToastReceipt,
  },
  {
    pattern: /^https:\/\/squareup\.com\/r\/([A-Za-z0-9_-]{1,64})(?:\?[A-Za-z0-9_=&-]{1,200})?$/,
    page: ([receipt]) => `https://squareup.com/r/${receipt}`,
    parse: parseSquareReceipt,
  },
];

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 1_000_000;
const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

class StepError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const url = typeof body?.url === 'string' ? body.url : '';
    const link = RECEIPT_LINKS.find(({ pattern }) => pattern.test(url));
    const match = link?.pattern.exec(url);
    if (!link || !match) {
      throw new StepError('Not a Toast or Square receipt link', 400);
    }

    const html = await fetchReceiptPage(link.page(match.slice(1)));
    return NextResponse.json(link.parse(html));
  } catch (error) {
    let message = "Couldn't read the receipt page";
    let status = 500;
    if (error instanceof StepError) {
      message = error.message;
      status = error.status;
    } else if (error instanceof ReceiptParseError) {
      message = error.message;
      status = 422;
    }

    console.warn('[API /receipt-link] Failed:', message);
    return NextResponse.json({ error: message }, { status });
  }
}

async function fetchReceiptPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const failed = () =>
    controller.signal.aborted
      ? new StepError('Receipt page timed out', 504)
      : new StepError("Couldn't fetch the receipt page", 502);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      });
    } catch {
      throw failed();
    }

    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw new StepError('Receipt page redirected', 502);
    }
    if (!response.ok || !response.body) {
      throw new StepError("Couldn't fetch the receipt page", 502);
    }
    if (!/^text\/html\s*(;|$)/i.test(response.headers.get('content-type') ?? '')) {
      throw new StepError("Receipt page isn't HTML", 502);
    }
    if (Number(response.headers.get('content-length')) > MAX_BODY_BYTES) {
      throw new StepError('Receipt page is too large', 502);
    }

    // Read incrementally so an oversized body is cut off at the cap, not buffered whole
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    let size = 0;
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        throw failed();
      }
      if (chunk.done) break;

      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        throw new StepError('Receipt page is too large', 502);
      }
      html += decoder.decode(chunk.value, { stream: true });
    }
    return html + decoder.decode();
  } finally {
    // Also releases a body left unread on an error path
    clearTimeout(timer);
    controller.abort();
  }
}
