export const SINGLETON_NAME = 'sarin-global-app';

const runtimeKeys = [
  'FIREBASE_ADMIN_PROJECT_ID', 'FIREBASE_ADMIN_CLIENT_EMAIL', 'FIREBASE_ADMIN_PRIVATE_KEY', 'SUPERADMIN_UID',
  'SARIN_TUNNEL_URL', 'OLLAMA_MAIN_MODEL', 'OLLAMA_VISION_MODEL', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET',
  'MAX_CONCURRENT_LLM_SLOTS', 'MAX_QUEUED_LLM_REQUESTS', 'LLM_QUEUE_TIMEOUT_MS', 'LLM_REQUEST_TIMEOUT_MS', 'MONTHLY_PRICE_COP',
] as const;
const publicKeys = ['NEXT_PUBLIC_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'NEXT_PUBLIC_FIREBASE_APP_ID'] as const;
const forbiddenRuntimeKeys = ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST', 'NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST', 'NEXT_PUBLIC_FIREBASE_EMULATORS'];

export function runtimeEnvironment(input: Record<string, unknown>): Record<string, string> {
  if (forbiddenRuntimeKeys.some((key) => input[key] !== undefined && input[key] !== '')) throw new Error('Los emuladores no están permitidos en el runtime Cloudflare.');
  const env: Record<string, string> = { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', HOSTNAME: '0.0.0.0', PORT: '3000' };
  for (const key of runtimeKeys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) env[key] = value;
  }
  for (const key of runtimeKeys.slice(0, 9)) if (!env[key]) throw new Error('Falta configuración requerida del servidor.');
  if (env.FIREBASE_ADMIN_PROJECT_ID.startsWith('demo-')) throw new Error('No se permite el proyecto de emuladores.');
  let url: URL;
  try { url = new URL(env.SARIN_TUNNEL_URL); } catch { throw new Error('El motor remoto debe usar HTTPS privado.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/v1/chat/completions') || ['localhost', '127.0.0.1', '[::1]', 'api.openai.com', 'ollama.com'].includes(url.hostname)) throw new Error('El motor remoto debe usar HTTPS privado.');
  return env;
}

export function publicBuildArguments(input: Record<string, unknown>): Record<string, string> {
  const args: Record<string, string> = {};
  for (const key of publicKeys) {
    const value = input[key];
    if (typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value)) throw new Error(`Configura ${key} con un valor público real.`);
    args[key] = value.trim();
  }
  if (args.NEXT_PUBLIC_FIREBASE_PROJECT_ID.startsWith('demo-') || input.NEXT_PUBLIC_FIREBASE_EMULATORS === 'true') throw new Error('El build Cloudflare no permite emuladores.');
  return args;
}

export async function forwardToSingleton(request: Request, get: (name: string) => { fetch(request: Request): Promise<Response> }): Promise<Response> {
  try {
    const requestHeaders = new Headers(request.headers);
    // The SDK supports port switching through this header. It is never a public
    // capability: all traffic must reach the single Next port fixed at 3000.
    requestHeaders.delete('cf-container-target-port');
    requestHeaders.delete('cf-access-client-id');
    requestHeaders.delete('cf-access-client-secret');
    const upstream = await get(SINGLETON_NAME).fetch(new Request(request, { headers: requestHeaders, redirect: 'manual' }));
    if (upstream.status >= 500 && !upstream.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
      await upstream.body?.cancel();
      throw new Error('El transporte del contenedor no está disponible.');
    }
    const headers = new Headers(upstream.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('CDN-Cache-Control', 'no-store');
    headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
    headers.delete('cf-access-client-id'); headers.delete('cf-access-client-secret'); headers.delete('authorization');
    // Use the same stream without clone(), text(), json() or an application
    // retry loop. Next retains responsibility for Firebase authentication.
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  } catch {
    return Response.json({ error: 'La aplicación está temporalmente indisponible. Reintenta cuando vuelva a estar disponible.' }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' } });
  }
}
