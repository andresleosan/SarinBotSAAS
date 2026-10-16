import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  IdentityIssuer,
  parseWorkloadAudience,
  publicIdentityResponse,
  identityOutboundResponse,
} from '../src/identity-core.ts';

const AUDIENCE = '//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/sarin-cloudflare/providers/worker-oidc';
const ISSUER = 'https://sarinbotsaas.pages.dev';
const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 16);

function memoryStorage() {
  const values = new Map();
  return {
    values,
    failWrites: false,
    async get(key) { await Promise.resolve(); return structuredClone(values.get(key)); },
    async put(key, value) {
      await Promise.resolve();
      if (this.failWrites) throw new Error('private storage failure');
      values.set(key, structuredClone(value));
    },
  };
}

function fixture() {
  const storage = memoryStorage();
  const clock = { now: START };
  return { storage, clock, issuer: new IdentityIssuer(storage, () => clock.now) };
}

function decode(token) {
  const [header, payload] = token.split('.');
  return { header: JSON.parse(Buffer.from(header, 'base64url')), payload: JSON.parse(Buffer.from(payload, 'base64url')) };
}

async function verify(token, jwks) {
  const [header, payload, signature] = token.split('.');
  const key = jwks.keys.find((candidate) => candidate.kid === decode(token).header.kid);
  assert.ok(key, 'signature key must be published');
  const imported = await crypto.subtle.importKey('jwk', key, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, imported, Buffer.from(signature, 'base64url'), Buffer.from(`${header}.${payload}`));
}

test('audience accepts only the dedicated numeric Google provider resource', () => {
  assert.deepEqual(parseWorkloadAudience(AUDIENCE), { audience: AUDIENCE, projectNumber: '123456789012' });
  for (const value of [undefined, '', `${AUDIENCE} `, `${AUDIENCE}\n`, `${AUDIENCE}\r\n`, ` ${AUDIENCE}`, AUDIENCE.replace('123456789012', 'sarinbotsaas'), AUDIENCE.replace('123456789012', '012345678901'), AUDIENCE.replace('sarin-cloudflare', 'sarin-vps'), AUDIENCE.replace('worker-oidc', 'other'), `https:${AUDIENCE}`, `${AUDIENCE}?x=1`, `${AUDIENCE}/`, AUDIENCE.replace('/global/', '/us-east1/')]) {
    assert.throws(() => parseWorkloadAudience(value));
  }
  assert.throws(() => parseWorkloadAudience(AUDIENCE, '999999999999'));
});

test('mints verifiable five-minute ES256 assertions with the fixed issuer and subject', async () => {
  const { issuer } = fixture();
  const { subject_token: token } = await issuer.mintToken(AUDIENCE);
  const jwks = await issuer.getJwks();
  const { header, payload } = decode(token);
  assert.equal(header.alg, 'ES256');
  assert.equal(header.typ, 'JWT');
  assert.equal(payload.iss, ISSUER);
  assert.equal(payload.sub, 'sarin-cloudflare-production');
  assert.equal(payload.aud, AUDIENCE);
  assert.equal(payload.environment, 'production');
  assert.ok(payload.iat <= START / 1000 && payload.iat >= START / 1000 - 30);
  assert.equal(payload.exp - payload.iat, 300);
  assert.equal(await verify(token, jwks), true);
  const tampered = token.split('.');
  tampered[1] = Buffer.from(JSON.stringify({ ...payload, sub: 'attacker' })).toString('base64url');
  assert.equal(await verify(tampered.join('.'), jwks), false);
});

test('public keys exist before runtime configuration and never expose private material', async () => {
  const { issuer, storage } = fixture();
  await assert.rejects(issuer.mintToken(undefined));
  assert.equal(storage.values.size, 0);
  const jwks = await issuer.getJwks();
  assert.equal(jwks.keys.length, 2);
  assert.equal(new Set(jwks.keys.map((key) => key.kid)).size, 2);
  for (const key of jwks.keys) {
    assert.deepEqual(Object.keys(key).sort(), ['alg', 'crv', 'kid', 'kty', 'use', 'x', 'y']);
    assert.equal(key.d, undefined);
  }
  assert.equal(JSON.stringify(jwks).includes('privateJwk'), false);
});

test('concurrent initialization and minting persist one consistent signing generation', async () => {
  const { issuer, storage, clock } = fixture();
  const tokens = await Promise.all(Array.from({ length: 12 }, () => issuer.mintToken(AUDIENCE)));
  const first = await issuer.getJwks();
  assert.equal(new Set(tokens.map(({ subject_token }) => decode(subject_token).header.kid)).size, 1);
  const restarted = new IdentityIssuer(storage, () => clock.now);
  assert.deepEqual(await restarted.getJwks(), first);
  assert.equal(await verify((await restarted.mintToken(AUDIENCE)).subject_token, first), true);
});

test('rotation activates the prepublished key and retains the old public key for one day', async () => {
  const { issuer, clock, storage } = fixture();
  const oldToken = (await issuer.mintToken(AUDIENCE)).subject_token;
  const before = await issuer.getJwks();
  const oldKid = decode(oldToken).header.kid;
  const prepublishedKid = before.keys.find((key) => key.kid !== oldKid).kid;
  clock.now += 30 * DAY - 1;
  assert.equal(decode((await issuer.mintToken(AUDIENCE)).subject_token).header.kid, oldKid);
  clock.now += 1;
  const token = (await issuer.mintToken(AUDIENCE)).subject_token;
  const during = await issuer.getJwks();
  assert.equal(decode(token).header.kid, prepublishedKid);
  assert.equal(during.keys.length, 3);
  assert.equal(await verify(oldToken, during), true);
  assert.equal(await verify(token, during), true);
  clock.now += DAY;
  const restarted = new IdentityIssuer(storage, () => clock.now);
  const after = await restarted.getJwks();
  assert.equal(after.keys.length, 2);
  assert.equal(after.keys.some((key) => key.kid === oldKid), false);
  clock.now += 100 * DAY;
  assert.ok((await restarted.getJwks()).keys.length <= 3);
});

test('storage failure cannot release an assertion for an unpersisted key', async () => {
  const { issuer, storage } = fixture();
  storage.failWrites = true;
  await assert.rejects(issuer.mintToken(AUDIENCE));
  assert.equal(storage.values.size, 0);
  storage.failWrites = false;
  const token = (await issuer.mintToken(AUDIENCE)).subject_token;
  assert.equal(await verify(token, await issuer.getJwks()), true);
});

test('unsafe clock rollback fails closed after restart', async () => {
  const { issuer, storage, clock } = fixture();
  await issuer.mintToken(AUDIENCE);
  clock.now -= 31_000;
  const restarted = new IdentityIssuer(storage, () => clock.now);
  await assert.rejects(restarted.mintToken(AUDIENCE));
  await assert.rejects(restarted.getJwks());
  clock.now = START;
  assert.equal(await verify((await restarted.mintToken(AUDIENCE)).subject_token, await restarted.getJwks()), true);
});

test('public discovery and JWKS support GET and bodyless HEAD with no runtime audience', async () => {
  const { issuer } = fixture();
  const discovery = await publicIdentityResponse(new Request(`${ISSUER}/.well-known/openid-configuration`), () => issuer.getJwks());
  assert.equal(discovery.status, 200);
  assert.equal(discovery.headers.get('Cache-Control'), 'no-store');
  const metadata = await discovery.json();
  assert.equal(metadata.issuer, ISSUER);
  assert.equal(metadata.jwks_uri, `${ISSUER}/.well-known/jwks.json`);
  const jwks = await publicIdentityResponse(new Request(`${ISSUER}/.well-known/jwks.json`), () => issuer.getJwks());
  assert.equal((await jwks.json()).keys.length, 2);
  const head = await publicIdentityResponse(new Request(`${ISSUER}/.well-known/jwks.json`, { method: 'HEAD' }), () => issuer.getJwks());
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('public identity routes reject mutation, queries and alternate origins without minting', async () => {
  const { issuer } = fixture();
  const getJwks = () => issuer.getJwks();
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await publicIdentityResponse(new Request(`${ISSUER}/.well-known/jwks.json`, { method }), getJwks);
    assert.equal(response.status, 405);
  }
  for (const url of [`${ISSUER}/.well-known/jwks.json?token=1`, `${ISSUER}/.well-known/jwks.json?`, 'https://attacker.invalid/.well-known/jwks.json']) {
    const response = await publicIdentityResponse(new Request(url), getJwks);
    assert.equal(response.status, 404);
  }
  assert.equal(await publicIdentityResponse(new Request(`${ISSUER}/token`), getJwks), null);
});

test('outbound token endpoint accepts only the exact container, class and virtual URI', async () => {
  const { issuer } = fixture();
  const mint = () => issuer.mintToken(AUDIENCE);
  const goodContext = { containerId: 'expected-container', className: 'SarinApp' };
  const valid = await identityOutboundResponse(new Request('http://sarin-google.internal/token'), goodContext, 'expected-container', mint);
  assert.equal(valid.status, 200);
  assert.equal(await verify((await valid.json()).subject_token, await issuer.getJwks()), true);
  for (const context of [{ ...goodContext, containerId: 'forged' }, { ...goodContext, className: 'OtherApp' }]) {
    const response = await identityOutboundResponse(new Request('http://sarin-google.internal/token'), context, 'expected-container', mint);
    assert.equal(response.status, 403);
    assert.equal((await response.text()).includes('subject_token'), false);
  }
  for (const url of ['http://sarin-google.internal/token?aud=attacker', 'http://sarin-google.internal/token?', 'https://sarin-google.internal/token', 'http://sarin-google.internal:8080/token', 'http://attacker.invalid/token', 'http://sarin-google.internal/other']) {
    assert.equal((await identityOutboundResponse(new Request(url), goodContext, 'expected-container', mint)).status, 404);
  }
  assert.equal((await identityOutboundResponse(new Request('http://sarin-google.internal/token', { method: 'POST', body: 'private' }), goodContext, 'expected-container', mint)).status, 405);
});

test('identity failures return generic responses without private details or tokens', async () => {
  const fail = async () => { throw new Error('private key and credential detail'); };
  for (const response of [
    await publicIdentityResponse(new Request(`${ISSUER}/.well-known/jwks.json`), fail),
    await identityOutboundResponse(new Request('http://sarin-google.internal/token'), { containerId: 'expected', className: 'SarinApp' }, 'expected', fail),
  ]) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.text()).includes('private'), false);
  }
});

test('Workerd persists issuer keys and exposes minting only through the internal RPC wrapper', async () => {
  const require = createRequire(import.meta.url);
  const wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
  const { build } = wranglerRequire('esbuild');
  const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare');
  const bundled = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('../', import.meta.url)),
      contents: `
        import { DurableObject } from 'cloudflare:workers';
        import { SarinIdentity, handlePublicIdentityRequest, handleIdentityOutbound } from './src/identity.ts';
        export { SarinIdentity };
        export class AppIdentityTestDouble extends DurableObject {}
        export default {
          async fetch(request, env) {
            if (new URL(request.url).pathname === '/__test-internal-rpc') {
              return handleIdentityOutbound(new Request('http://sarin-google.internal/token'), env, {
                className: 'SarinApp', containerId: env.SARIN_APP.idFromName('sarin-global-app').toString(),
              });
            }
            return await handlePublicIdentityRequest(request, env) ?? new Response('Not Found', { status: 404 });
          },
        };
      `,
    },
    bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:workers'],
  });
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-10-13',
    bindings: { FIREBASE_WIF_AUDIENCE: AUDIENCE },
    durableObjects: {
      SARIN_IDENTITY: { className: 'SarinIdentity', useSQLite: true },
      SARIN_APP: { className: 'AppIdentityTestDouble', useSQLite: true },
    },
  }));
  try {
    const firstResponse = await mf.dispatchFetch(`${ISSUER}/.well-known/jwks.json`);
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    const mint = await mf.dispatchFetch(`${ISSUER}/__test-internal-rpc`);
    assert.equal(mint.status, 200);
    const { subject_token } = await mint.json();
    assert.equal(await verify(subject_token, first), true);
    const repeated = await mf.dispatchFetch(`${ISSUER}/.well-known/jwks.json`);
    assert.deepEqual(await repeated.json(), first);
    const forbidden = await mf.dispatchFetch(`${ISSUER}/token`);
    assert.equal(forbidden.status, 404);
  } finally {
    await mf.dispose();
  }
});
