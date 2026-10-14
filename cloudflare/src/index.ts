import { Container, getContainer } from '@cloudflare/containers';
import { forwardToSingleton, runtimeEnvironment } from './router.ts';

/** The DO stores SDK lifecycle metadata only; application bodies never enter DO storage. */
export class SarinApp extends Container<CloudflareBindings> {
  override defaultPort = 3000;
  override sleepAfter = '15m';
  // Firebase Admin uses native TLS/gRPC. Avoid HTTPS interception and its CA/protocol changes.
  override enableInternet = true;

  constructor(ctx: ConstructorParameters<typeof Container<CloudflareBindings>>[0], env: CloudflareBindings) {
    super(ctx, env);
    this.envVars = runtimeEnvironment({ ...env });
  }

  override onError(_error: unknown): void {
    // No error payload, token, URL or request body is logged from this hook.
    throw new Error('El proceso de la aplicación no está disponible.');
  }

  override async onActivityExpired(): Promise<void> {
    if (this.ctx.container?.running) await this.stop();
  }
}

export default {
  fetch(request: Request, env: CloudflareBindings): Promise<Response> {
    return forwardToSingleton(request, (name) => getContainer(env.SARIN_APP, name));
  },
} satisfies ExportedHandler<CloudflareBindings>;
