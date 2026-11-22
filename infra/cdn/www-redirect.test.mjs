// node --test infra/cdn/www-redirect.test.mjs
// Runs the function's code as cdn.tf deploys it, with the apex filled in. The code is plain ES5, so
// Node runs it as CloudFront Functions would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./www-redirect.js', import.meta.url), 'utf8');
const handler = new Function(`${source.replace('APEX_HOST', 'splitwit.us')}\nreturn handler;`)();

function event(host, uri = '/', querystring = {}) {
  const headers = host === null ? {} : { host: { value: host } };
  return { request: { method: 'GET', uri, querystring, headers } };
}

test('the apex passes through untouched', () => {
  const e = event('splitwit.us', '/expense/ABCDEF');
  assert.equal(handler(e), e.request);
});

test('www redirects to the apex, keeping the path', () => {
  const response = handler(event('www.splitwit.us', '/expense/ABCDEF'));
  assert.equal(response.statusCode, 301);
  assert.equal(response.headers.location.value, 'https://splitwit.us/expense/ABCDEF');
});

test('the redirect carries HSTS, as the app sends it', () => {
  assert.equal(
    handler(event('www.splitwit.us')).headers['strict-transport-security'].value,
    'max-age=63072000; includeSubDomains; preload',
  );
});

test('the host is compared without case', () => {
  assert.equal(handler(event('WWW.Splitwit.US')).headers.location.value, 'https://splitwit.us/');
});

test('the query string is kept, repeated names included', () => {
  const response = handler(
    event('www.splitwit.us', '/a', {
      x: { value: '1' },
      tag: { value: 'a', multiValue: [{ value: 'a' }, { value: 'b' }] },
      flag: { value: '' },
    })
  );
  assert.equal(response.headers.location.value, 'https://splitwit.us/a?x=1&tag=a&tag=b&flag');
});

test('a path that looks like another host stays on the apex', () => {
  const location = handler(event('www.splitwit.us', '//evil.example/x')).headers.location.value;
  assert.equal(location, 'https://splitwit.us//evil.example/x');
  assert.equal(new URL(location).host, 'splitwit.us');
});

test('other hosts and a missing host pass through', () => {
  for (const host of ['evil.example', 'www.splitwit.us.evil.example', 'xwww.splitwit.us', null]) {
    const e = event(host);
    assert.equal(handler(e), e.request);
  }
});

test('the deployed code names the apex', () => {
  assert.equal(source.split('APEX_HOST').length, 2);
});
