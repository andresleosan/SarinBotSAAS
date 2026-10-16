/** Google trusts this public issuer; assertion minting is available only over a binding. */
export const IDENTITY_ISSUER = 'https://sarinbotsaas.pages.dev';
export const IDENTITY_SUBJECT = 'sarin-cloudflare-production';
export const IDENTITY_OBJECT_NAME = 'sarin-google-issuer';
const STATE_KEY = 'issuer-keys-v1';
const ROTATION_MS = 30 * 86_400_000;
const PREVIOUS_KEY_MS = 86_400_000;
const MAX_CLOCK_ROLLBACK_MS = 30_000;

export function parseWorkloadAudience(value: unknown, expectedProjectNumber?: string): { audience: string; projectNumber: string } {
  if (typeof value !== 'string') throw new Error('La identidad de Google no está configurada.');
  const match = /^\/\/iam\.googleapis\.com\/projects\/([1-9][0-9]{5,19})\/locations\/global\/workloadIdentityPools\/sarin-cloudflare\/providers\/worker-oidc$/.exec(value);
  if (!match || match[0] !== value || (expectedProjectNumber !== undefined && match[1] !== expectedProjectNumber)) {
    throw new Error('La identidad de Google no está configurada.');
  }
  return { audience: value, projectNumber: match[1] };
}

export interface IdentityStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export interface PublicIdentityKey {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  alg: 'ES256';
  use: 'sig';
  kid: string;
}

export interface IdentityJwks { keys: PublicIdentityKey[] }

interface SigningKey {
  publicJwk: PublicIdentityKey;
  privateJwk: JsonWebKey;
}

interface IdentityState {
  version: 1;
  current: SigningKey;
  next: SigningKey;
  previous?: { publicJwk: PublicIdentityKey; retireAt: number };
  activatedAt: number;
  lastObservedAt: number;
}

function publicKey(jwk: JsonWebKey & { kid?: string }, kid: string): PublicIdentityKey {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y || !kid) {
    throw new Error('La identidad no está disponible.');
  }
  // Select fields explicitly, including for persisted keys. Never serialize private d/key_ops/ext.
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, alg: 'ES256', use: 'sig', kid };
}

async function generateSigningKey(): Promise<SigningKey> {
  const generated = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  if (!('privateKey' in generated)) throw new Error('La identidad no está disponible.');
  const [privateJwk, exportedPublic] = await Promise.all([
    crypto.subtle.exportKey('jwk', generated.privateKey),
    crypto.subtle.exportKey('jwk', generated.publicKey),
  ]);
  if (privateJwk instanceof ArrayBuffer || exportedPublic instanceof ArrayBuffer) throw new Error('La identidad no está disponible.');
  return { privateJwk, publicJwk: publicKey(exportedPublic, crypto.randomUUID()) };
}

function validateState(state: IdentityState): void {
  if (state.version !== 1 || !Number.isSafeInteger(state.activatedAt) || !Number.isSafeInteger(state.lastObservedAt) || state.activatedAt > state.lastObservedAt) {
    throw new Error('La identidad no está disponible.');
  }
  for (const key of [state.current, state.next]) {
    const published = publicKey(key.publicJwk, key.publicJwk.kid);
    if (!key.privateJwk.d || key.privateJwk.kty !== 'EC' || key.privateJwk.crv !== 'P-256' || key.privateJwk.x !== published.x || key.privateJwk.y !== published.y) {
      throw new Error('La identidad no está disponible.');
    }
  }
  if (state.current.publicJwk.kid === state.next.publicJwk.kid) throw new Error('La identidad no está disponible.');
  if (state.previous) {
    publicKey(state.previous.publicJwk, state.previous.publicJwk.kid);
    if (!Number.isSafeInteger(state.previous.retireAt)) throw new Error('La identidad no está disponible.');
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function encodeJson(value: object): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

/** State contains only issuer keys and their rotation/clock metadata, never application data. */
export class IdentityIssuer {
  private storage: IdentityStorage;
  private clock: () => number;
  private pending: Promise<void> = Promise.resolve();

  constructor(storage: IdentityStorage, clock: () => number = Date.now) {
    this.storage = storage;
    this.clock = clock;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    // A failed operation does not poison later requests; no unhandled rejected promise remains.
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  private async loadKeys(now: number): Promise<IdentityState> {
    if (!Number.isSafeInteger(now) || now <= 0) throw new Error('La identidad no está disponible.');
    let state = await this.storage.get<IdentityState>(STATE_KEY);
    if (!state) {
      const [current, next] = await Promise.all([generateSigningKey(), generateSigningKey()]);
      state = { version: 1, current, next, activatedAt: now, lastObservedAt: now };
    } else {
      validateState(state);
      if (now < state.lastObservedAt - MAX_CLOCK_ROLLBACK_MS) throw new Error('La identidad no está disponible.');
      const observedAt = Math.max(now, state.lastObservedAt);
      if (observedAt - state.activatedAt >= ROTATION_MS) {
        const next = await generateSigningKey();
        state = {
          version: 1,
          current: state.next,
          next,
          previous: { publicJwk: publicKey(state.current.publicJwk, state.current.publicJwk.kid), retireAt: observedAt + PREVIOUS_KEY_MS },
          activatedAt: observedAt,
          lastObservedAt: observedAt,
        };
      } else {
        state.lastObservedAt = observedAt;
        if (state.previous && observedAt >= state.previous.retireAt) delete state.previous;
      }
    }
    // Complete persistence before a public key or any token can be returned. No key cache survives a failed write.
    await this.storage.put(STATE_KEY, state);
    return state;
  }

  getJwks(): Promise<IdentityJwks> {
    return this.serialize(async () => {
      const state = await this.loadKeys(this.clock());
      return { keys: [state.current.publicJwk, state.next.publicJwk, ...(state.previous ? [state.previous.publicJwk] : [])].map((key) => publicKey(key, key.kid)) };
    });
  }

  mintToken(audienceInput: unknown): Promise<{ subject_token: string }> {
    return this.serialize(async () => {
      const { audience } = parseWorkloadAudience(audienceInput);
      const now = this.clock();
      const state = await this.loadKeys(now);
      const issuedAt = Math.floor(now / 1000) - 5;
      const header = encodeJson({ alg: 'ES256', typ: 'JWT', kid: state.current.publicJwk.kid });
      const payload = encodeJson({
        iss: IDENTITY_ISSUER, sub: IDENTITY_SUBJECT, aud: audience,
        iat: issuedAt, exp: issuedAt + 300, environment: 'production',
      });
      const signingInput = `${header}.${payload}`;
      const key = await crypto.subtle.importKey('jwk', state.current.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
      const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput));
      return { subject_token: `${signingInput}.${base64Url(new Uint8Array(signature))}` };
    });
  }
}

function identityJson(value: object, status = 200, head = false, extraHeaders: Record<string, string> = {}): Response {
  return new Response(head ? null : JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Cloudflare-CDN-Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', ...extraHeaders,
    },
  });
}

export async function publicIdentityResponse(request: Request, getJwks: () => Promise<IdentityJwks>): Promise<Response | null> {
  const url = new URL(request.url);
  if (!['/.well-known/openid-configuration', '/.well-known/jwks.json'].includes(url.pathname)) return null;
  const head = request.method === 'HEAD';
  if (url.origin !== IDENTITY_ISSUER || request.url.includes('?') || request.url.includes('#') || url.username || url.password) return identityJson({ error: 'No disponible.' }, 404, head);
  if (!['GET', 'HEAD'].includes(request.method) || request.body !== null) return identityJson({ error: 'Método no permitido.' }, 405, head, { Allow: 'GET, HEAD' });
  try {
    const value = url.pathname === '/.well-known/jwks.json' ? await getJwks() : {
      issuer: IDENTITY_ISSUER,
      jwks_uri: `${IDENTITY_ISSUER}/.well-known/jwks.json`,
      response_types_supported: ['id_token'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['ES256'],
    };
    return identityJson(value, 200, head);
  } catch {
    return identityJson({ error: 'La identidad está temporalmente indisponible.' }, 503, head);
  }
}

export async function identityOutboundResponse(
  request: Request,
  context: { containerId: string; className: string },
  expectedContainerId: string,
  mintToken: () => Promise<{ subject_token: string }>,
): Promise<Response> {
  if (!expectedContainerId || context.className !== 'SarinApp' || context.containerId !== expectedContainerId) return identityJson({ error: 'Acceso denegado.' }, 403);
  const url = new URL(request.url);
  if (url.origin !== 'http://sarin-google.internal' || url.pathname !== '/token' || request.url.includes('?') || request.url.includes('#') || url.username || url.password) return identityJson({ error: 'No disponible.' }, 404);
  if (request.method !== 'GET' || request.body !== null) return identityJson({ error: 'Método no permitido.' }, 405, false, { Allow: 'GET' });
  try {
    return identityJson(await mintToken());
  } catch {
    return identityJson({ error: 'La identidad está temporalmente indisponible.' }, 503);
  }
}
