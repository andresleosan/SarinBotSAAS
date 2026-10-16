import { DurableObject } from 'cloudflare:workers';
import { IDENTITY_OBJECT_NAME, IdentityIssuer, identityOutboundResponse, publicIdentityResponse, type IdentityJwks } from './identity-core.ts';
import { SINGLETON_NAME } from './router.ts';

export { parseWorkloadAudience } from './identity-core.ts';

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

export function handlePublicIdentityRequest(request: Request, env: CloudflareBindings): Promise<Response | null> {
  return publicIdentityResponse(request, () => env.SARIN_IDENTITY.getByName(IDENTITY_OBJECT_NAME).getJwks());
}

export function handleIdentityOutbound(request: Request, env: CloudflareBindings, ctx: { containerId: string; className: string }): Promise<Response> {
  return identityOutboundResponse(
    request,
    ctx,
    env.SARIN_APP.idFromName(SINGLETON_NAME).toString(),
    () => env.SARIN_IDENTITY.getByName(IDENTITY_OBJECT_NAME).mintToken(),
  );
}
