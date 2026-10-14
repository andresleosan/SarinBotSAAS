import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forwardToSingleton, runtimeEnvironment, publicBuildArguments, SINGLETON_NAME } from '../src/router.ts';

test('all business, admin and Vault requests use one constant container', async () => {
  const names = [];
  const get = (name) => { names.push(name); return { fetch: async () => new Response('ok') }; };
  for (const path of ['/b/one', '/b/two', '/admin/vault', '/api/sarin/vault']) await forwardToSingleton(new Request(`https://app.example.invalid${path}`), get);
  assert.deepEqual(names, Array(4).fill(SINGLETON_NAME));
  assert.equal(new Set(names).size, 1);
});
test('forwards a POST exactly once and returns an unconsumed response stream', async () => {
  let calls = 0;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('private result')); } });
  const upstream = new Response(body, { status: 409, headers: { 'Content-Type': 'application/json' } });
  const request = new Request('https://app.example.invalid/api/sarin/vault', { method: 'POST', headers: { Authorization: 'Bearer synthetic' }, body: 'private request' });
  const response = await forwardToSingleton(request, () => ({ fetch: async (forwarded) => { calls++; assert.equal(forwarded.bodyUsed, false); assert.equal(forwarded.headers.get('Authorization'), 'Bearer synthetic'); return upstream; } }));
  assert.equal(calls, 1);
  assert.equal(response.status, 409);
  assert.equal(response.body, upstream.body);
  assert.equal(response.bodyUsed, false);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  await response.body.cancel();
});
test('does not replay a failed POST and hides internal exception details', async () => {
  let calls = 0;
  const response = await forwardToSingleton(new Request('https://app.example.invalid/api/billing', { method: 'POST', body: 'sensitive' }), () => ({ fetch: async () => { calls++; throw new Error('sensitive failure detail'); } }));
  assert.equal(calls, 1);
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes('sensitive'), false);
});
test('cannot pass an internal SDK error or switch-port header to the browser', async () => {
  const request = new Request('https://app.example.invalid/api/sarin/vault', { method: 'POST', headers: { 'cf-container-target-port': '9229', 'CF-Access-Client-Secret': 'injected' }, body: 'private' });
  const response = await forwardToSingleton(request, () => ({ fetch: async (forwarded) => {
    assert.equal(forwarded.headers.get('cf-container-target-port'), null);
    assert.equal(forwarded.headers.get('CF-Access-Client-Secret'), null);
    return new Response('private crash detail', { status: 500 });
  } }));
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes('private crash detail'), false);
});
test('only allows explicit server runtime variables, with no development emulators', () => {
  const env = runtimeEnvironment({ FIREBASE_ADMIN_PROJECT_ID: 'real-project', FIREBASE_ADMIN_CLIENT_EMAIL: 'configured@example.test', FIREBASE_ADMIN_PRIVATE_KEY: 'synthetic-key', SUPERADMIN_UID: 'owner', SARIN_TUNNEL_URL: 'https://engine.example.invalid/v1/chat/completions', OLLAMA_MAIN_MODEL: 'main-local', OLLAMA_VISION_MODEL: 'vision-local', CF_ACCESS_CLIENT_ID: 'synthetic-id', CF_ACCESS_CLIENT_SECRET: 'synthetic-secret', UNRELATED_SECRET: 'excluded' });
  assert.equal(env.CF_ACCESS_CLIENT_SECRET, 'synthetic-secret');
  assert.equal(env.UNRELATED_SECRET, undefined);
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.HOSTNAME, '0.0.0.0');
  assert.throws(() => runtimeEnvironment({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }));
  assert.throws(() => runtimeEnvironment({ NEXT_PUBLIC_FIREBASE_EMULATORS: 'true' }));
});
test('requires the four public build values and never includes Admin credentials', () => {
  const input = { NEXT_PUBLIC_FIREBASE_API_KEY: 'public-client-key', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'configured.firebaseapp.com', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'configured-project', NEXT_PUBLIC_FIREBASE_APP_ID: '1:123:web:abc', FIREBASE_ADMIN_PRIVATE_KEY: 'excluded' };
  const args = publicBuildArguments(input);
  assert.equal(Object.keys(args).length, 4);
  assert.equal(args.FIREBASE_ADMIN_PRIVATE_KEY, undefined);
  assert.throws(() => publicBuildArguments({}));
  assert.throws(() => publicBuildArguments({ ...input, NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-sarin-bot' }));
});
