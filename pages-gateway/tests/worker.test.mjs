import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { handleRequest } from '../worker.mjs';

const publicOrigin = 'https://sarinbotsaas.pages.dev';
const backendOrigin = 'https://app-pilot.alsdevstudio.com';
const configuration = {
  SARIN_PUBLIC_ORIGIN: publicOrigin,
  SARIN_APP_ORIGIN: backendOrigin,
  SARIN_APP_ACCESS_CLIENT_ID: 'synthetic-app.access',
  SARIN_APP_ACCESS_CLIENT_SECRET: 'synthetic-gateway-secret',
};
const request = (path, init) => new Request(`${publicOrigin}${path}`, init);
const forbiddenFetch = async () => { assert.fail('This request must not reach the network.'); };
function assertPrivate(response, status) {
  assert.equal(response.status, status);
  for (const name of ['Cache-Control', 'CDN-Cache-Control', 'Cloudflare-CDN-Cache-Control']) assert.equal(response.headers.get(name), 'no-store');
  assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin-allow-popups');
}

test('unconfigured gateway serves only known GET/HEAD landing assets', async () => {
  for (const path of ['/', '/index.html', '/index.txt', '/robots.txt', '/sitemap.xml', '/favicon.ico', '/sarin-face-32.png', '/brand/sarin-flight.png', '/_next/static/chunks/landing.js']) {
    const env = { ASSETS: { fetch: async asset => new Response(`asset:${new URL(asset.url).pathname}`) } };
    const response = await handleRequest(request(path), env, forbiddenFetch);
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), `asset:${path}`);
  }
  const head = await handleRequest(request('/', { method: 'HEAD' }), { SARIN_PUBLIC_ORIGIN: publicOrigin, ASSETS: { fetch: async asset => new Response(null, { headers: { 'x-method': asset.method } }) } }, forbiddenFetch);
  assert.equal(head.headers.get('x-method'), 'HEAD');
});

test('unconfigured application routes return a real no-store 503', async () => {
  for (const path of ['/dashboard', '/dashboard/billing', '/b/my-shop', '/admin', '/dashboard/onboarding', '/api/session', '/api/sarin/chat', '/unknown', '/.env', '/_worker.js', '/_next/image?url=private', '/brand/not-approved.png']) {
    const response = await handleRequest(request(path), { ASSETS: { fetch: forbiddenFetch } }, forbiddenFetch);
    assertPrivate(response, 503);
    assert.match(await response.text(), /disponible/i);
  }
  assertPrivate(await handleRequest(request('/', { method: 'POST', body: 'never forwarded' }), { ASSETS: { fetch: forbiddenFetch } }, forbiddenFetch), 503);
});

test('partial or malformed gateway configuration fails closed even for the landing', async () => {
  const bad = [
    { SARIN_APP_ORIGIN: backendOrigin },
    { ...configuration, SARIN_APP_ACCESS_CLIENT_SECRET: '' },
    { ...configuration, SARIN_PUBLIC_ORIGIN: undefined },
    { ...configuration, SARIN_PUBLIC_ORIGIN: 'https://other.pages.dev' },
    { ...configuration, SARIN_APP_ACCESS_CLIENT_ID: 'line\nbreak' },
    { ...configuration, SARIN_APP_ACCESS_CLIENT_SECRET: ' spaced-secret ' },
  ];
  for (const origin of ['http://app-pilot.alsdevstudio.com', 'https://alsdevstudio.com', 'https://app-pilot.alsdevstudio.com.evil.invalid', 'https://evil.invalid', 'https://ia-sarin.alsdevstudio.com', 'https://user:pass@app-pilot.alsdevstudio.com', 'https://app-pilot.alsdevstudio.com:8443', 'https://app-pilot.alsdevstudio.com/v1/chat/completions', 'https://app-pilot.alsdevstudio.com?token=secret', 'https://app-pilot.alsdevstudio.com#fragment']) bad.push({ ...configuration, SARIN_APP_ORIGIN: origin });
  for (const values of bad) assertPrivate(await handleRequest(request('/'), { ...values, ASSETS: { fetch: forbiddenFetch } }, forbiddenFetch), 503);
});

test('configured gateway forwards HTML, Next assets and API paths to one backend preserving query encoding', async () => {
  for (const path of ['/', '/dashboard', '/b/my-shop', '/dashboard/onboarding', '/_next/static/chunks/app.js', '/_next/image?url=%2Fbrand%2Fsarin.png&w=64&q=75', '/api/businesses/shop/appointments?date=2030-01-07&tag=a%2Fb+space', '//evil.invalid/escape']) {
    let calls = 0;
    const response = await handleRequest(request(path), { ...configuration, ASSETS: { fetch: forbiddenFetch } }, async upstream => {
      calls++;
      assert.equal(upstream.url, `${backendOrigin}${path}`);
      assert.equal(upstream.redirect, 'manual');
      assert.equal(upstream.cache, 'no-store');
      return new Response('backend output');
    });
    assertPrivate(response, 200);
    assert.equal(await response.text(), 'backend output');
    assert.equal(calls, 1);
  }
});

test('gateway replaces spoofed proxy and Access headers while retaining Firebase auth and app cookies', async () => {
  const input = request('/api/session', { headers: {
    Authorization: 'Bearer synthetic-firebase-token', Cookie: 'app_session=synthetic; CF_Authorization=attacker; CF_AppSession=attacker; preference=dark',
    Origin: publicOrigin, Host: 'attacker.invalid', Forwarded: 'host=attacker.invalid;proto=http', 'X-Forwarded-Host': 'attacker.invalid', 'X-Forwarded-Proto': 'http', 'X-Forwarded-For': 'fake-ip', 'X-Real-IP': 'fake-ip', 'CF-Connecting-IP': 'fake-ip',
    'CF-Access-Client-Id': 'attacker', 'CF-Access-Client-Secret': 'attacker', 'CF-Access-Jwt-Assertion': 'attacker', 'CF-Access-Authenticated-User-Email': 'attacker', 'CF-Container-Target-Port': '22',
  } });
  const response = await handleRequest(input, configuration, async upstream => {
    assert.equal(upstream.headers.get('authorization'), 'Bearer synthetic-firebase-token');
    assert.equal(upstream.headers.get('cookie'), 'app_session=synthetic; preference=dark');
    assert.equal(upstream.headers.get('origin'), publicOrigin);
    assert.equal(upstream.headers.get('host'), 'app-pilot.alsdevstudio.com');
    assert.equal(upstream.headers.get('x-forwarded-host'), 'sarinbotsaas.pages.dev');
    assert.equal(upstream.headers.get('x-forwarded-proto'), 'https');
    assert.equal(upstream.headers.get('cf-access-client-id'), 'synthetic-app.access');
    assert.equal(upstream.headers.get('cf-access-client-secret'), 'synthetic-gateway-secret');
    for (const name of ['forwarded', 'x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'cf-access-jwt-assertion', 'cf-access-authenticated-user-email', 'cf-container-target-port']) assert.equal(upstream.headers.get(name), null);
    return new Response('authorized');
  });
  assertPrivate(response, 200);
});

test('foreign browser origins cannot mutate while same-origin and originless HMAC webhooks pass', async () => {
  for (const origin of ['https://evil.invalid', 'null', `${publicOrigin}.evil.invalid`, `${publicOrigin}/`]) {
    assertPrivate(await handleRequest(request('/api/sarin/chat', { method: 'POST', headers: { Origin: origin }, body: '{}' }), configuration, forbiddenFetch), 403);
  }
  for (const origin of [publicOrigin, undefined]) {
    const input = request('/api/whatsapp/webhook', { method: 'POST', headers: { ...(origin ? { Origin: origin } : {}), 'X-Hub-Signature-256': 'sha256=synthetic' }, body: '{"signed":true}' });
    const response = await handleRequest(input, configuration, async upstream => {
      assert.equal(upstream.headers.get('x-hub-signature-256'), 'sha256=synthetic');
      assert.equal(await upstream.text(), '{"signed":true}');
      return new Response('accepted');
    });
    assert.equal(response.status, 200);
  }
  assertPrivate(await handleRequest(new Request('https://preview.pages.dev/dashboard'), configuration, forbiddenFetch), 503);
});

test('POST forwards its body as a stream exactly once and streams the response without buffering', async () => {
  let uploadController, downloadController, calls = 0;
  const upload = new ReadableStream({ start(controller) { uploadController = controller; } });
  const download = new ReadableStream({ start(controller) { downloadController = controller; } });
  const input = request('/api/sarin/chat', { method: 'POST', body: upload, duplex: 'half', headers: { Origin: publicOrigin } });
  const response = await handleRequest(input, configuration, async upstream => {
    calls++;
    assert.equal(upstream.method, 'POST');
    const reader = upstream.body.getReader();
    uploadController.enqueue(new TextEncoder().encode('first'));
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'first');
    uploadController.enqueue(new TextEncoder().encode('second'));
    uploadController.close();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'second');
    assert.equal((await reader.read()).done, true);
    return new Response(download);
  });
  assertPrivate(response, 200);
  downloadController.enqueue(new TextEncoder().encode('streamed'));
  downloadController.close();
  assert.equal(await response.text(), 'streamed');
  assert.equal(calls, 1);
});

test('backend errors, transport failures and Access denials expose no upstream response or retry', async () => {
  for (const result of [new Response('private upstream diagnostic', { status: 503 }), new Response('Access private hostname', { status: 403, headers: { 'content-type': 'text/html' } }), new Response('challenge', { headers: { 'cf-mitigated': 'challenge' } }), new Error('synthetic-gateway-secret'), new DOMException('private timeout detail', 'TimeoutError')]) {
    let calls = 0;
    const response = await handleRequest(request('/api/session'), configuration, async () => { calls++; if (result instanceof Error) throw result; return result; });
    assertPrivate(response, 503);
    assert.equal(calls, 1);
    assert.doesNotMatch(await response.text(), /private|synthetic-gateway-secret|alsdevstudio|Access/);
  }
  const json = await handleRequest(request('/api/session'), configuration, async () => Response.json({ error: 'Session required' }, { status: 401 }));
  assertPrivate(json, 401);
  assert.deepEqual(await json.json(), { error: 'Session required' });
});

test('safe application redirects retain public origin and all external or Access redirects fail closed', async () => {
  for (const [location, want] of [[`${backendOrigin}/dashboard?next=%2Fb%2Fshop#calendar`, `${publicOrigin}/dashboard?next=%2Fb%2Fshop#calendar`], ['/dashboard', `${publicOrigin}/dashboard`], [`${publicOrigin}/dashboard`, `${publicOrigin}/dashboard`]]) {
    const response = await handleRequest(request('/'), configuration, async () => new Response('private redirect body', { status: 307, headers: { Location: location } }));
    assertPrivate(response, 307);
    assert.equal(response.headers.get('location'), want);
    assert.equal(await response.text(), '');
  }
  for (const location of ['https://team.cloudflareaccess.com/cdn-cgi/access/login', `${backendOrigin}/cdn-cgi/access/login`, '//evil.invalid/steal', 'https://evil.invalid/steal', 'javascript:alert(1)', `https://user:pass@app-pilot.alsdevstudio.com/dashboard`]) {
    const response = await handleRequest(request('/'), configuration, async () => new Response(null, { status: 302, headers: { Location: location } }));
    assertPrivate(response, 503);
    assert.equal(response.headers.get('location'), null);
  }
});

test('response strips Access credentials, internal metadata and cookies but preserves valid app cookies', async () => {
  const headers = new Headers({ 'content-type': 'text/plain', Authorization: 'Bearer should-never-return', 'CF-Access-Client-Secret': 'synthetic-gateway-secret', 'CF-Access-Jwt-Assertion': 'private', 'x-debug-token': 'synthetic-app.access', 'x-debug-origin': backendOrigin, Refresh: `0;url=${backendOrigin}`, 'Cache-Control': 'public, max-age=3600', 'Cross-Origin-Opener-Policy': 'unsafe-none' });
  headers.append('Set-Cookie', 'CF_Authorization=upstream; Secure; HttpOnly; Path=/');
  headers.append('Set-Cookie', 'app_session=valid; Secure; HttpOnly; Domain=app-pilot.alsdevstudio.com; Path=/');
  headers.append('Set-Cookie', 'foreign=value; Domain=evil.invalid; Path=/');
  const response = await handleRequest(request('/dashboard'), configuration, async () => new Response('safe body', { headers }));
  assertPrivate(response, 200);
  for (const name of ['authorization', 'cf-access-client-secret', 'cf-access-jwt-assertion', 'x-debug-token', 'x-debug-origin', 'refresh']) assert.equal(response.headers.get(name), null);
  assert.deepEqual(response.headers.getSetCookie(), ['app_session=valid; Secure; HttpOnly; Path=/']);
  assert.equal(await response.text(), 'safe body');
});

test('client cancellation reaches upstream signal without starting another request', async () => {
  const controller = new AbortController();
  const responsePromise = handleRequest(request('/api/sarin/chat', { signal: controller.signal }), configuration, async upstream => {
    assert.equal(upstream.signal.aborted, false);
    return new Promise((resolve, reject) => upstream.signal.addEventListener('abort', () => reject(upstream.signal.reason), { once: true }));
  });
  controller.abort();
  assertPrivate(await responsePromise, 503);
});

test('gateway cancels a backend that never returns headers at its finite timeout', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const pending = handleRequest(request('/api/sarin/chat'), configuration, async upstream => {
    calls++;
    return new Promise((resolve, reject) => upstream.signal.addEventListener('abort', () => reject(upstream.signal.reason), { once: true }));
  });
  context.mock.timers.tick(660_000);
  assertPrivate(await pending, 503);
  assert.equal(calls, 1);
});

test('Pages module handler accepts its real execution context without treating it as fetch', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response('real handler'));
  const response = await worker.fetch(request('/dashboard'), configuration, { waitUntil() {} });
  assertPrivate(response, 200);
  assert.equal(await response.text(), 'real handler');
});

test('upstream status text and cookie values cannot reveal the dedicated upstream hostname or secret', async () => {
  const headers = new Headers();
  headers.append('Set-Cookie', `debug_origin=${backendOrigin}; Path=/`);
  const response = await handleRequest(request('/dashboard'), configuration, async () => new Response('safe body', { statusText: 'synthetic-gateway-secret', headers }));
  assertPrivate(response, 200);
  assert.doesNotMatch(response.statusText, /synthetic-gateway-secret/);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('hop-by-hop transport headers do not cross either proxy boundary', async () => {
  const names = ['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-connection'];
  const headers = Object.fromEntries(names.map(name => [name, 'synthetic-transport']));
  const response = await handleRequest(request('/dashboard', { headers }), configuration, async upstream => {
    for (const name of names) assert.equal(upstream.headers.get(name), null, name);
    return new Response('application', { headers });
  });
  assertPrivate(response, 200);
  for (const name of names) assert.equal(response.headers.get(name), null, name);
});

test('Cloudflare service binding receives every application path at its canonical public URL without network fetch', async () => {
  for (const path of ['/', '/dashboard', '/b/my-shop', '/dashboard/onboarding', '/_next/static/chunks/app.js', '/_next/image?url=%2Fbrand%2Fsarin.png&w=64&q=75', '/api/businesses/shop/appointments?tag=a%2Fb+space', '/.well-known/jwks.json', '//evil.invalid/escape']) {
    let calls = 0;
    const binding = { async fetch(upstream) {
      calls++;
      assert.equal(this, binding);
      assert.equal(upstream.url, `${publicOrigin}${path}`);
      assert.equal(upstream.headers.get('host'), 'sarinbotsaas.pages.dev');
      assert.equal(upstream.redirect, 'manual');
      assert.equal(upstream.cache, 'no-store');
      return new Response('Cloudflare application');
    } };
    const response = await handleRequest(request(path), { SARIN_PUBLIC_ORIGIN: publicOrigin, SARIN_APP_HOST: binding, ASSETS: { fetch: forbiddenFetch } }, forbiddenFetch);
    assertPrivate(response, 200);
    assert.equal(await response.text(), 'Cloudflare application');
    assert.equal(calls, 1);
  }
});

test('Cloudflare service binding strips spoofed routing and Access credentials while preserving application credentials and origin', async () => {
  const names = ['Forwarded', 'X-Forwarded-For', 'X-Real-IP', 'True-Client-IP', 'CF-Connecting-IP', 'CF-Connecting-IPv6', 'CF-Container-Target-Port', 'X-Original-Host', 'X-Original-URL', 'X-Rewrite-URL', 'CF-Access-Client-Id', 'CF-Access-Client-Secret', 'CF-Access-Jwt-Assertion', 'CF-Access-Authenticated-User-Email', 'Proxy-Authorization', 'Proxy-Authenticate', 'Connection', 'Keep-Alive', 'Transfer-Encoding', 'TE', 'Trailer', 'Upgrade', 'Proxy-Connection'];
  const input = request('/api/session', { method: 'POST', body: '{}', headers: {
    ...Object.fromEntries(names.map(name => [name, 'synthetic-spoof'])),
    Authorization: 'Bearer synthetic-firebase-token', Cookie: 'app_session=synthetic; CF_Authorization=attacker; CF_AppSession=attacker; CF_Binding=attacker; preference=dark',
    Origin: publicOrigin, Host: 'attacker.invalid', 'X-Forwarded-Host': 'attacker.invalid', 'X-Forwarded-Proto': 'http',
  } });
  const response = await handleRequest(input, { SARIN_PUBLIC_ORIGIN: publicOrigin, SARIN_APP_HOST: { async fetch(upstream) {
    for (const name of names) assert.equal(upstream.headers.get(name), null, name);
    assert.equal(upstream.headers.get('authorization'), 'Bearer synthetic-firebase-token');
    assert.equal(upstream.headers.get('cookie'), 'app_session=synthetic; preference=dark');
    assert.equal(upstream.headers.get('origin'), publicOrigin);
    assert.equal(upstream.headers.get('host'), 'sarinbotsaas.pages.dev');
    assert.equal(upstream.headers.get('x-forwarded-host'), 'sarinbotsaas.pages.dev');
    assert.equal(upstream.headers.get('x-forwarded-proto'), 'https');
    assert.equal(await upstream.text(), '{}');
    return new Response('authorized');
  } } }, forbiddenFetch);
  assertPrivate(response, 200);
  assert.equal(await response.text(), 'authorized');
});

test('Cloudflare service binding configuration rejects missing origins, invalid bindings and legacy conflicts without fallback', async () => {
  let calls = 0;
  const unexpectedFetch = async () => { calls++; return new Response('unsafe fallback'); };
  const valid = { SARIN_PUBLIC_ORIGIN: publicOrigin, SARIN_APP_HOST: { fetch: unexpectedFetch } };
  const bad = [
    { ...valid, SARIN_PUBLIC_ORIGIN: undefined },
    { ...valid, SARIN_PUBLIC_ORIGIN: '' },
    { ...valid, SARIN_PUBLIC_ORIGIN: 'https://preview.pages.dev' },
    ...[null, undefined, {}, { fetch: true }, 'sarin-bot-app'].map(binding => ({ ...valid, SARIN_APP_HOST: binding })),
    { ...configuration, SARIN_APP_HOST: valid.SARIN_APP_HOST },
    { ...valid, SARIN_APP_ORIGIN: backendOrigin },
    { ...valid, SARIN_APP_ACCESS_CLIENT_SECRET: 'synthetic-secret' },
    { ...configuration, SARIN_APP_HOST: null },
  ];
  for (const env of bad) assertPrivate(await handleRequest(request('/'), { ...env, ASSETS: { fetch: unexpectedFetch } }, unexpectedFetch), 503);
  assert.equal(calls, 0);
});

test('Cloudflare service binding rejects preview hosts and foreign mutation origins before calling the application', async () => {
  let calls = 0;
  const unexpectedFetch = async () => { calls++; return new Response('unsafe origin'); };
  const env = { SARIN_PUBLIC_ORIGIN: publicOrigin, SARIN_APP_HOST: { fetch: unexpectedFetch }, ASSETS: { fetch: unexpectedFetch } };
  assertPrivate(await handleRequest(new Request('https://preview.pages.dev/dashboard'), env, unexpectedFetch), 503);
  for (const origin of ['https://evil.invalid', 'null', `${publicOrigin}/`]) {
    assertPrivate(await handleRequest(request('/api/sarin/chat', { method: 'POST', body: '{}', headers: { Origin: origin } }), env, unexpectedFetch), 403);
  }
  assert.equal(calls, 0);
});

test('Cloudflare service binding forwards an originless signed webhook body once and streams its response without buffering', async () => {
  let uploadController, downloadController, calls = 0;
  const upload = new ReadableStream({ start(controller) { uploadController = controller; } });
  const download = new ReadableStream({ start(controller) { downloadController = controller; } });
  const input = request('/api/whatsapp/webhook', { method: 'POST', body: upload, duplex: 'half', headers: { 'X-Hub-Signature-256': 'sha256=synthetic' } });
  const response = await handleRequest(input, { SARIN_PUBLIC_ORIGIN: publicOrigin, SARIN_APP_HOST: { async fetch(upstream) {
    calls++;
    assert.equal(upstream.method, 'POST');
    assert.equal(upstream.headers.get('origin'), null);
    assert.equal(upstream.headers.get('x-hub-signature-256'), 'sha256=synthetic');
    const reader = upstream.body.getReader();
    uploadController.enqueue(new TextEncoder().encode('signed-first'));
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'signed-first');
    uploadController.enqueue(new TextEncoder().encode('signed-second'));
    uploadController.close();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'signed-second');
    assert.equal((await reader.read()).done, true);
    return new Response(download);
  } } }, forbiddenFetch);
  assertPrivate(response, 200);
  const reader = response.body.getReader();
  downloadController.enqueue(new TextEncoder().encode('first-response'));
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'first-response');
  downloadController.close();
  assert.equal((await reader.read()).done, true);
  assert.equal(calls, 1);
});

test('Cloudflare service binding never retries a POST or exposes backend failures and authentication details', async () => {
  for (const result of [new Error('Bearer private-token'), new Response('private upstream body', { status: 500 }), new Response('private Access denial', { status: 403 }), new Response('private challenge', { headers: { 'cf-mitigated': 'challenge' } })]) {
    let calls = 0;
    const response = await handleRequest(request('/api/session', { method: 'POST', body: '{}', headers: { Origin: publicOrigin } }), { SARIN_PUBLIC_ORIGIN: publicOrigin, SARIN_APP_HOST: { async fetch(upstream) {
      calls++;
      assert.equal(await upstream.text(), '{}');
      if (result instanceof Error) throw result;
      return result;
    } } }, forbiddenFetch);
    assertPrivate(response, 503);
    assert.equal(calls, 1);
    assert.doesNotMatch(await response.text(), /private|Bearer|Access|token/);
  }
});

test('Cloudflare service binding sanitizes response headers and Access cookies while retaining public redirects and application cookies', async () => {
  const headers = new Headers({ Authorization: 'Bearer private-token', 'CF-Access-Client-Secret': 'private-secret', 'CF-Access-Jwt-Assertion': 'private-assertion', 'Proxy-Authorization': 'private-proxy', 'Access-Control-Allow-Origin': '*', Refresh: '0;url=https://evil.invalid', Server: 'private-server', Location: '/dashboard?next=%2Fb%2Fshop' });
  headers.append('Set-Cookie', 'CF_Authorization=upstream; Path=/');
  headers.append('Set-Cookie', 'CF_AppSession=upstream; Path=/');
  headers.append('Set-Cookie', 'CF_Binding=upstream; Path=/');
  headers.append('Set-Cookie', 'app_session=valid; Secure; HttpOnly; Domain=sarinbotsaas.pages.dev; Path=/');
  headers.append('Set-Cookie', 'foreign=value; Domain=evil.invalid; Path=/');
  const response = await handleRequest(request('/'), { SARIN_PUBLIC_ORIGIN: publicOrigin, SARIN_APP_HOST: { fetch: async () => new Response('private redirect body', { status: 307, headers }) } }, forbiddenFetch);
  assertPrivate(response, 307);
  for (const name of ['authorization', 'cf-access-client-secret', 'cf-access-jwt-assertion', 'proxy-authorization', 'access-control-allow-origin', 'refresh', 'server']) assert.equal(response.headers.get(name), null, name);
  assert.equal(response.headers.get('location'), `${publicOrigin}/dashboard?next=%2Fb%2Fshop`);
  assert.deepEqual(response.headers.getSetCookie(), ['app_session=valid; Secure; HttpOnly; Path=/']);
  assert.equal(await response.text(), '');
  for (const location of ['https://evil.invalid/steal', 'https://team.cloudflareaccess.com/cdn-cgi/access/login', `${publicOrigin}/cdn-cgi/access/login`]) {
    const rejected = await handleRequest(request('/'), { SARIN_PUBLIC_ORIGIN: publicOrigin, SARIN_APP_HOST: { fetch: async () => new Response(null, { status: 302, headers: { Location: location } }) } }, forbiddenFetch);
    assertPrivate(rejected, 503);
    assert.equal(rejected.headers.get('location'), null);
  }
});

test('Pages entry point invokes the Cloudflare service binding without global fetch or execution-context confusion', async context => {
  context.mock.method(globalThis, 'fetch', forbiddenFetch);
  const response = await worker.fetch(request('/dashboard'), { SARIN_PUBLIC_ORIGIN: publicOrigin, SARIN_APP_HOST: { fetch: async () => new Response('bound application') } }, { waitUntil() {} });
  assertPrivate(response, 200);
  assert.equal(await response.text(), 'bound application');
});
