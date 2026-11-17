import { DurableObject } from 'cloudflare:workers';
import type { SignalErrorClass } from '../../shared/operational-signals.ts';
import { IDENTITY_OBJECT_NAME, IdentityIssuer, identityOutboundResponse, publicIdentityResponse, type IdentityJwks } from './identity-core.ts';
import { recordWorkerBoundaryError, recordWorkerBoundarySuccess } from './operational-signals.ts';
import { SINGLETON_NAME } from './router.ts';

export { parseWorkloadAudience } from './identity-core.ts';

type SignalContext = { waitUntil?: (promise: Promise<unknown>) => void };

function classifyIdentityError(error: unknown): SignalErrorClass {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'TIMEOUT';
    if (error.message === 'La identidad de Google no está configurada.') return 'CONFIG_INVALID';
  }
  return 'TRANSPORT_UNAVAILABLE';
}

async function dispatchIdentitySignal(ctx: SignalContext | undefined, promise: Promise<unknown> | undefined): Promise<void> {
  if (!promise) return;
  if (ctx?.waitUntil) {
    ctx.waitUntil(promise);
    return;
  }
  await promise;
}

/** This separate object persists only renewable issuer keys and their rotation metadata. */
export class SarinIdentity extends DurableObject<CloudflareBindings> {
  private issuer: IdentityIssuer;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.issuer = new IdentityIssuer(this.ctx.storage);
  }

  getJwks(): Promise<IdentityJwks> {
    return this.issuer.getJwks();
  }

  mintToken(): Promise<{ subject_token: string }> {
    return this.issuer.mintToken(this.env.FIREBASE_WIF_AUDIENCE);
  }
}

export function handlePublicIdentityRequest(
  request: Request,
  env: CloudflareBindings,
  ctx?: SignalContext,
): Promise<Response | null> {
  return publicIdentityResponse(request, async () => {
    try {
      const jwks = await env.SARIN_IDENTITY.getByName(IDENTITY_OBJECT_NAME).getJwks();
      await dispatchIdentitySignal(ctx, recordWorkerBoundarySuccess(env, 'identity_wif'));
      return jwks;
    } catch (error) {
      await dispatchIdentitySignal(ctx, recordWorkerBoundaryError(env, {
        boundary: 'identity_wif',
        errorClass: classifyIdentityError(error),
        httpStatus: null,
        providerCode: 'IDENTITY_JWKS_ERROR',
      }));
      throw error;
    }
  });
}

export function handleIdentityOutbound(
  request: Request,
  env: CloudflareBindings,
  ctx: { containerId: string; className: string } & SignalContext,
): Promise<Response> {
  return identityOutboundResponse(
    request,
    ctx,
    env.SARIN_APP.idFromName(SINGLETON_NAME).toString(),
    async () => {
      try {
        const token = await env.SARIN_IDENTITY.getByName(IDENTITY_OBJECT_NAME).mintToken();
        await dispatchIdentitySignal(ctx, recordWorkerBoundarySuccess(env, 'identity_wif'));
        return token;
      } catch (error) {
        await dispatchIdentitySignal(ctx, recordWorkerBoundaryError(env, {
          boundary: 'identity_wif',
          errorClass: classifyIdentityError(error),
          httpStatus: null,
          providerCode: 'IDENTITY_MINT_ERROR',
        }));
        throw error;
      }
    },
  );
}
