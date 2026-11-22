// POSTs to one of the app's own API routes with the SHA-256 of the exact body bytes in
// x-amz-content-sha256. In production, CloudFront signs each request it forwards to the Lambda
// function URL, and the function URL accepts a signed POST only when the viewer supplied the hash
// of its body; CloudFront cannot compute it. The header changes nothing anywhere else, as in local
// development. The body is encoded here, rather than by fetch, so the bytes hashed are the bytes
// sent.

// SubtleCrypto exists only in a secure context. A page on plain http (next dev opened from another
// device on the LAN) sends no hash; production is always https behind CloudFront.
async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// A form is encoded as multipart/form-data, with its boundary in the content type; JSON as UTF-8
async function encode(body: FormData | object): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string }> {
  if (body instanceof FormData) {
    const encoded = new Response(body);
    const type = encoded.headers.get('content-type');
    if (!type?.startsWith('multipart/form-data; boundary=')) {
      throw new Error('Could not encode the form');
    }
    return { bytes: new Uint8Array(await encoded.arrayBuffer()), type };
  }
  return { bytes: new TextEncoder().encode(JSON.stringify(body)), type: 'application/json' };
}

export async function postWithHash(path: string, body: FormData | object): Promise<Response> {
  const { bytes, type } = await encode(body);
  const hash = await sha256Hex(bytes);
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': type, ...(hash ? { 'x-amz-content-sha256': hash } : {}) },
    body: bytes,
  });
}
