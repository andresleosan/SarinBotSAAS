// Pages advanced mode: no application runtime, credentials or request state at module scope.
const PUBLIC_ORIGIN = 'https://sarinbotsaas.pages.dev';
const PUBLIC_HOSTNAME = 'sarinbotsaas.pages.dev';
const HEADER_TIMEOUT_MS = 660_000;
const BACKEND_KEYS = ['SARIN_APP_ORIGIN', 'SARIN_APP_ACCESS_CLIENT_ID', 'SARIN_APP_ACCESS_CLIENT_SECRET'];
const LANDING_FILES = new Set([
  '/', '/index.html', '/index.txt', '/__next.__PAGE__.txt', '/__next._tree.txt', '/__next._full.txt',
  '/robots.txt', '/sitemap.xml', '/favicon.ico', '/favicon.png', '/apple-touch-icon.png',
  '/sarin-face.ico', '/sarin-face-32.png', '/sarin-face-48.png', '/sarin-face-apple.png',
  '/brand/sarin-welcome.png', '/brand/sarin-flight.png', '/brand/sarin-face-mark.png',
]);
const ACCESS_COOKIE = /^CF_(?:Authorization|AppSession|Binding)$/i;
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-connection']);

function responseHeaders(headers = new Headers()) {
  headers.set('Cache-Control', 'no-store');
  headers.set('CDN-Cache-Control', 'no-store');
  headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  return headers;
}

function unavailable(request, status = 503) {
  const headers = responseHeaders();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (status === 503) headers.set('Retry-After', '5');
  return new Response(request.method === 'HEAD' ? null : JSON.stringify({ error: status === 403 ? 'El origen de la solicitud no está autorizado.' : 'La aplicación está temporalmente no disponible.' }), { status, headers });
}

function configuration(env) {
  const publicOrigin = env.SARIN_PUBLIC_ORIGIN;
  if (publicOrigin !== undefined && publicOrigin !== '' && publicOrigin !== PUBLIC_ORIGIN) throw new Error('Invalid public origin');
  const supplied = BACKEND_KEYS.some(key => env[key] !== undefined && env[key] !== '');
  if ('SARIN_APP_HOST' in env) {
    if (publicOrigin !== PUBLIC_ORIGIN || supplied) throw new Error('Ambiguous or incomplete backend configuration');
    const service = env.SARIN_APP_HOST;
    if (!service || typeof service.fetch !== 'function') throw new Error('Invalid application service binding');
    return { mode: 'service', origin: PUBLIC_ORIGIN, hostname: PUBLIC_HOSTNAME, service, credentials: [] };
  }
  if (!supplied) return null;
  if (publicOrigin !== PUBLIC_ORIGIN) throw new Error('Missing public origin');
  const origin = env.SARIN_APP_ORIGIN;
  // Restrict to a dedicated application hostname; never point at the Ollama engine.
  if (typeof origin !== 'string' || !/^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+alsdevstudio\.com$/.test(origin)) throw new Error('Invalid app origin');
  const url = new URL(origin);
  if (url.hostname.split('.').includes('ia-sarin')) throw new Error('Engine hostname is not an application origin');
  const clientId = env.SARIN_APP_ACCESS_CLIENT_ID, clientSecret = env.SARIN_APP_ACCESS_CLIENT_SECRET;
  if (![clientId, clientSecret].every(value => typeof value === 'string' && /^[!-~]{8,4096}$/.test(value))) throw new Error('Invalid app access configuration');
  // The HTTPS + Access path is retained only for an explicitly configured rollback.
  return { mode: 'legacy', origin, hostname: url.hostname, clientId, clientSecret, credentials: [clientId, clientSecret] };
}

function landingPath(pathname) {
  return LANDING_FILES.has(pathname) || /^\/_next\/static\/[A-Za-z0-9_./-]+\.(?:js|css|woff2?|ttf|png|jpe?g|webp|svg)$/.test(pathname);
}

function proxyHeaders(request, config) {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (HOP_BY_HOP.has(name.toLowerCase()) || /^cf-access-|^x-forwarded-/i.test(name) || ['forwarded', 'x-real-ip', 'true-client-ip', 'cf-connecting-ip', 'cf-connecting-ipv6', 'cf-container-target-port', 'x-original-host', 'x-original-url', 'x-rewrite-url', 'proxy-authorization', 'proxy-authenticate'].includes(name.toLowerCase())) headers.delete(name);
  }
  const cookie = headers.get('Cookie');
  if (cookie) {
    const safe = cookie.split(';').map(part => part.trim()).filter(part => part && !ACCESS_COOKIE.test(part.split('=', 1)[0]));
    if (safe.length) headers.set('Cookie', safe.join('; ')); else headers.delete('Cookie');
  }
  // Next receives only the canonical public routing values from this boundary.
  // The legacy tunnel alone needs its private Host and Access service credentials.
  headers.set('Host', config.hostname);
  headers.set('X-Forwarded-Host', PUBLIC_HOSTNAME);
  headers.set('X-Forwarded-Proto', 'https');
  if (config.mode === 'legacy') {
    headers.set('CF-Access-Client-Id', config.clientId);
    headers.set('CF-Access-Client-Secret', config.clientSecret);
  }
  return headers;
}

function containsPrivateValue(value, config) {
  return config.credentials.some(credential => value.includes(credential)) || (config.mode === 'legacy' && value.toLowerCase().includes(config.hostname));
}

function publicCookie(value, config) {
  const parts = value.split(';').map(part => part.trim());
  if (ACCESS_COOKIE.test(parts[0].split('=', 1)[0]) || config.credentials.some(credential => value.includes(credential))) return null;
  const domain = parts.find(part => /^domain=/i.test(part));
  if (domain) {
    const hostname = domain.slice(7).replace(/^\./, '').toLowerCase();
    if (hostname !== config.hostname && hostname !== PUBLIC_HOSTNAME) return null;
  }
  const safe = parts.filter(part => !/^domain=/i.test(part)).join('; ');
  return containsPrivateValue(safe, config) ? null : safe;
}

function sanitizedHeaders(upstream, config) {
  const headers = new Headers(upstream.headers);
  const cookies = upstream.headers.getSetCookie();
  for (const [name, value] of [...headers]) {
    if (HOP_BY_HOP.has(name.toLowerCase()) || /^cf-access-|^access-control-/i.test(name) || ['authorization', 'proxy-authorization', 'proxy-authenticate', 'cf-authorization', 'set-cookie', 'location', 'refresh', 'server', 'x-powered-by', 'alt-svc', 'report-to', 'nel'].includes(name.toLowerCase()) || containsPrivateValue(value, config)) headers.delete(name);
  }
  for (const cookie of cookies) {
    const safe = publicCookie(cookie, config);
    if (safe) headers.append('Set-Cookie', safe);
  }
  return responseHeaders(headers);
}

async function discard(response) {
  try { await response.body?.cancel(); } catch { /* Do not expose transport details. */ }
}

function redirectLocation(location, upstreamUrl, config) {
  const target = new URL(location, upstreamUrl);
  if (target.username || target.password || target.pathname.startsWith('/cdn-cgi/access') || ![config.origin, PUBLIC_ORIGIN].includes(target.origin)) throw new Error('Unapproved redirect');
  if (target.origin === config.origin) {
    const publicUrl = new URL(PUBLIC_ORIGIN);
    publicUrl.pathname = target.pathname;
    publicUrl.search = target.search;
    publicUrl.hash = target.hash;
    return publicUrl.href;
  }
  return target.href;
}

export async function handleRequest(request, env, fetchBackend = fetch) {
  let timer;
  try {
    const config = configuration(env);
    const publicUrl = new URL(request.url);
    if (!config) {
      if (!['GET', 'HEAD'].includes(request.method) || !landingPath(publicUrl.pathname)) return unavailable(request);
      // Explicit allowlist prevents Pages' SPA fallback from pretending app routes exist.
      return await env.ASSETS.fetch(request);
    }
    if (publicUrl.origin !== PUBLIC_ORIGIN) return unavailable(request);
    const origin = request.headers.get('Origin');
    if (!['GET', 'HEAD'].includes(request.method) && origin !== null && origin !== PUBLIC_ORIGIN) return unavailable(request, 403);
    const target = new URL(config.mode === 'service' ? request.url : config.origin);
    target.pathname = publicUrl.pathname;
    target.search = publicUrl.search;
    const timeout = new AbortController();
    timer = setTimeout(() => timeout.abort(new DOMException('Backend timeout', 'TimeoutError')), HEADER_TIMEOUT_MS);
    const upstreamRequest = new Request(new Request(target, request), {
      headers: proxyHeaders(request, config), redirect: 'manual', cache: 'no-store',
      signal: AbortSignal.any([request.signal, timeout.signal]),
    });
    // One attempt only. Never follow a redirect with Access or Firebase credentials.
    const upstream = config.mode === 'service'
      ? await config.service.fetch(upstreamRequest)
      : await fetchBackend(upstreamRequest, { cf: { cacheEverything: false, cacheTtlByStatus: { '100-599': -1 } } });
    clearTimeout(timer);
    if (upstream.status >= 500 || upstream.headers.get('cf-mitigated') === 'challenge' || ([401, 403].includes(upstream.status) && !upstream.headers.get('Content-Type')?.toLowerCase().includes('application/json'))) {
      await discard(upstream);
      return unavailable(request);
    }
    const headers = sanitizedHeaders(upstream, config);
    const location = upstream.headers.get('Location');
    if (location) {
      let redirect;
      try { redirect = redirectLocation(location, target, config); }
      catch { await discard(upstream); return unavailable(request); }
      if (containsPrivateValue(redirect, config)) { await discard(upstream); return unavailable(request); }
      headers.set('Location', redirect);
    }
    if ((upstream.status >= 300 && upstream.status < 400) || request.method === 'HEAD') {
      await discard(upstream);
      headers.delete('Content-Length');
      return new Response(null, { status: upstream.status, headers });
    }
    // Do not buffer, clone, log or persist request/response bodies.
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return unavailable(request);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export default { fetch: (request, env) => handleRequest(request, env) };
