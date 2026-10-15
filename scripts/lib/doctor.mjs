/**
 * Local diagnostics. No Firebase SDK, filesystem access, implicit network calls,
 * retries, account changes, or environment/response logging belong in this module.
 * Contracts: https://docs.ollama.com/api/openai-compatibility
 * Access headers: https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/
 *
 * @typedef {{check: string, status: 'ok'|'pending'|'error', message: string}} DoctorCheck
 * @typedef {Record<string, string|undefined>} DoctorEnvironment
 * @typedef {{engine?: boolean, generate?: boolean, vision?: boolean}} DoctorFlags
 */

const RESPONSE_LIMIT = 256 * 1024;
// A generated 32 x 32 red PNG. No personal file, URL, upload, or image service is used.
const VISION_FIXTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKUlEQVR4nO3NsQ0AAAzCMP5/mj5RNkuZ4zSZtr0DAAAAAAAAAACA/gEHMsP8LofXz44AAAAASUVORK5CYII=';
const KNOWN_CLOUD_HOSTS = ['ollama.com', 'api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'api.groq.com', 'api.deepseek.com', 'openrouter.ai'];

/** @param {unknown} value */
const present = value => typeof value === 'string' && value.trim().length > 0;
/** @param {string} check @param {'ok'|'pending'|'error'} status @param {string} message @returns {DoctorCheck} */
const result = (check, status, message) => ({ check, status, message });

/** @param {DoctorEnvironment} env */
function inspectUrl(env) {
  if (!present(env.SARIN_TUNNEL_URL)) return { status: /** @type {const} */ ('pending'), url: null, local: false, message: 'Falta configurar la dirección del motor local.' };
  try {
    const url = new URL(env.SARIN_TUNNEL_URL);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if ((!local && url.protocol !== 'https:') || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/v1/chat/completions') || KNOWN_CLOUD_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error();
    return { status: /** @type {const} */ ('ok'), url, local, message: 'Dirección local o túnel HTTPS configurado; no se ha realizado una conexión.' };
  } catch {
    return { status: /** @type {const} */ ('error'), url: null, local: false, message: 'La dirección debe ser de tu motor local, terminar en /v1/chat/completions y no incluir credenciales ni parámetros. Los túneles remotos requieren HTTPS.' };
  }
}

/** @param {DoctorEnvironment} env @param {string} key @param {number} fallback @param {number} min @param {number} max */
function integerSetting(env, key, fallback, min, max) {
  const value = Number(env[key] ?? fallback);
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

/** @param {string|undefined} model @param {'engine.main-model'|'engine.vision-model'} check */
function modelCheck(model, check) {
  if (!present(model)) return result(check, 'pending', check === 'engine.main-model' ? 'Falta configurar el modelo principal local.' : 'Falta configurar el modelo de visión local.');
  if (model.length > 200 || /\s|[\x00-\x1f\x7f]/.test(model) || /^https?:\/\//i.test(model) || /(?:[:\-])cloud(?:$|[:\-])/i.test(model)) return result(check, 'error', 'El nombre debe identificar un modelo local descargado, sin etiquetas cloud.');
  return result(check, 'ok', 'Modelo local configurado; su instalación todavía no se ha comprobado.');
}

/** Presence checks never initialize Firebase or validate actual credentials.
 * @param {DoctorEnvironment} [env] @param {string} [nodeVersion] @returns {DoctorCheck[]}
 */
export function inspectConfiguration(env = {}, nodeVersion = '') {
  const url = inspectUrl(env);
  const clientPresent = ['NEXT_PUBLIC_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'NEXT_PUBLIC_FIREBASE_APP_ID'].every(key => present(env[key]));
  const adminMode = env.FIREBASE_ADMIN_CREDENTIAL_MODE || 'cert';
  const adc = adminMode === 'adc';
  const invalidAdmin = !['cert', 'adc'].includes(adminMode) || (adc && (present(env.FIREBASE_ADMIN_CLIENT_EMAIL) || present(env.FIREBASE_ADMIN_PRIVATE_KEY)));
  const adminPresent = present(env.FIREBASE_ADMIN_PROJECT_ID) && (adc || present(env.FIREBASE_ADMIN_CLIENT_EMAIL));
  const adminKeyPresent = present(env.FIREBASE_ADMIN_PRIVATE_KEY);
  const accessId = present(env.CF_ACCESS_CLIENT_ID);
  const accessSecret = present(env.CF_ACCESS_CLIENT_SECRET);
  /** @type {DoctorCheck} */
  let access;
  if (accessId !== accessSecret) access = result('engine.access', 'error', 'Completa los dos componentes del service token de Cloudflare Access.');
  else if (url.status === 'ok' && !url.local && !accessId) access = result('engine.access', 'error', 'Un túnel remoto requiere ambos componentes del service token de Cloudflare Access.');
  else if (url.status !== 'ok') access = result('engine.access', 'pending', 'Configura una dirección válida para comprobar los requisitos de Access.');
  else access = result('engine.access', 'ok', url.local ? 'La conexión de desarrollo apunta a loopback.' : 'Service token presente; Access todavía no se ha autenticado.');
  return [
    result('runtime.node', /^v?24\.\d+\.\d+$/.test(nodeVersion) ? 'ok' : 'error', /^v?24\.\d+\.\d+$/.test(nodeVersion) ? 'Node.js 24 disponible.' : 'Se requiere Node.js 24 LTS.'),
    result('firebase.client', clientPresent ? 'ok' : 'pending', clientPresent ? 'Variables públicas presentes; Firebase no se ha conectado.' : 'Firebase Client pendiente. Puedes continuar con el trabajo local sin conectarlo.'),
    result('firebase.admin', invalidAdmin ? 'error' : adminPresent ? 'ok' : 'pending', invalidAdmin ? 'Elige cert o adc; el modo ADC no admite variables de certificado.' : adminPresent ? 'Proyecto y modo de credenciales Admin presentes; las credenciales reales no se han validado.' : 'Firebase Admin pendiente. Este diagnóstico no necesita una cuenta conectada.'),
    result('firebase.admin-key', invalidAdmin ? 'error' : adc || adminKeyPresent ? 'ok' : 'pending', invalidAdmin ? 'Configuración de credenciales Admin incompatible.' : adc ? 'Modo ADC seleccionado; las credenciales no se han leído ni validado.' : adminKeyPresent ? 'Solo se comprobó la presencia de la clave Admin; no se leyó su estructura ni se autenticó.' : 'Clave Admin pendiente; no se necesita para las pruebas del motor local.'),
    result('firebase.superadmin', present(env.SUPERADMIN_UID) ? 'ok' : 'pending', present(env.SUPERADMIN_UID) ? 'UID presente; no se comprobó contra Firebase Auth.' : 'UID del administrador pendiente; no impide diagnosticar el motor.'),
    result('queue.slots', integerSetting(env, 'MAX_CONCURRENT_LLM_SLOTS', 4, 1, 4) ? 'ok' : 'error', 'La concurrencia debe ser un entero entre 1 y 4.'),
    result('queue.capacity', integerSetting(env, 'MAX_QUEUED_LLM_REQUESTS', 64, 1, Number.MAX_SAFE_INTEGER) ? 'ok' : 'error', 'La capacidad de espera debe ser un entero positivo seguro.'),
    result('queue.timeout', integerSetting(env, 'LLM_QUEUE_TIMEOUT_MS', 120000, 1, 2147483647) ? 'ok' : 'error', 'La espera de cola debe ser un entero positivo compatible con los temporizadores de Node.'),
    result('engine.url', url.status, url.message), access,
    modelCheck(env.OLLAMA_MAIN_MODEL, 'engine.main-model'), modelCheck(env.OLLAMA_VISION_MODEL, 'engine.vision-model'),
    result('engine.timeout', integerSetting(env, 'LLM_REQUEST_TIMEOUT_MS', 120000, 1000, 300000) ? 'ok' : 'error', 'El tiempo de inferencia debe estar entre 1000 y 300000 milisegundos.'),
  ];
}

/** Read streamed bytes rather than trusting Content-Length. Never expose raw body/errors.
 * @param {Response} response @returns {Promise<unknown>}
 */
async function boundedJson(response) {
  if (!response.ok || response.redirected || Number(response.headers.get('content-length') ?? 0) > RESPONSE_LIMIT) {
    await response.body?.cancel(); throw new Error('Invalid upstream response');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty upstream response');
  /** @type {Uint8Array[]} */
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > RESPONSE_LIMIT) { await reader.cancel(); throw new Error('Oversized upstream response'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const object = value => typeof value === 'object' && value !== null && !Array.isArray(value);
/** @param {unknown} value @returns {string[]|null} */
function catalog(value) {
  if (!object(value) || !Array.isArray(value.data) || value.data.length > 512 || !value.data.every(item => object(item) && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 300)) return null;
  return value.data.map(item => item.id);
}
/** @param {unknown} value */
function validCompletion(value) {
  if (!object(value) || !Array.isArray(value.choices) || !value.choices.length || value.choices.length > 4) return false;
  const first = value.choices[0];
  return object(first) && object(first.message) && typeof first.message.content === 'string' && first.message.content.trim().length > 0 && first.message.content.length <= 8192;
}

/** No service call occurs unless its explicit flag is true. Inference is one request per flag.
 * @param {{env?: DoctorEnvironment, nodeVersion?: string, flags?: DoctorFlags, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<{checks: DoctorCheck[], exitCode: number}>}
 */
export async function runDoctor({ env = {}, nodeVersion = '', flags = {}, fetchImpl = globalThis.fetch } = {}) {
  const checks = inspectConfiguration(env, nodeVersion);
  const requested = [['engine', flags.engine], ['generate', flags.generate], ['vision', flags.vision]].filter(([, enabled]) => enabled);
  if (!requested.length) {
    checks.push(result('engine.probes', 'pending', 'No se hicieron conexiones ni inferencias. Las pruebas de red requieren una opción explícita.'));
    return { checks, exitCode: checks.some(check => check.status === 'error') ? 1 : 0 };
  }
  if (checks.some(check => check.status === 'error')) {
    for (const [flag] of requested) checks.push(result(`probe.${flag}`, 'pending', 'Prueba no ejecutada: corrige primero los errores de configuración local.'));
    return { checks, exitCode: 1 };
  }
  const inspected = inspectUrl(env);
  if (!inspected.url || typeof fetchImpl !== 'function') {
    for (const [flag] of requested) checks.push(result(`probe.${flag}`, 'error', 'Configura un motor local válido antes de solicitar esta prueba.'));
    return { checks, exitCode: 1 };
  }
  const url = inspected.url;
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (present(env.CF_ACCESS_CLIENT_ID) && present(env.CF_ACCESS_CLIENT_SECRET)) {
    headers['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET;
  }
  if (flags.engine) {
    try {
      const modelsUrl = new URL(url);
      modelsUrl.pathname = modelsUrl.pathname.replace(/chat\/completions$/, 'models');
      const data = await boundedJson(await fetchImpl(modelsUrl.toString(), { method: 'GET', headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) }));
      const models = catalog(data);
      if (!models) throw new Error('Invalid model catalog');
      checks.push(result('probe.engine', 'ok', 'El catálogo OpenAI-compatible del motor local respondió correctamente. No se ejecutó inferencia.'));
      checks.push(result('probe.main-installed', !present(env.OLLAMA_MAIN_MODEL) ? 'pending' : models.includes(env.OLLAMA_MAIN_MODEL) ? 'ok' : 'error', !present(env.OLLAMA_MAIN_MODEL) ? 'Configura el modelo principal para comprobar su instalación.' : models.includes(env.OLLAMA_MAIN_MODEL) ? 'El modelo principal configurado aparece en el catálogo local.' : 'El modelo principal configurado no aparece en el catálogo local.'));
      checks.push(result('probe.vision-installed', !present(env.OLLAMA_VISION_MODEL) ? 'pending' : models.includes(env.OLLAMA_VISION_MODEL) ? 'ok' : 'error', !present(env.OLLAMA_VISION_MODEL) ? 'Configura el modelo de visión para comprobar su instalación.' : models.includes(env.OLLAMA_VISION_MODEL) ? 'El modelo de visión configurado aparece en el catálogo local.' : 'El modelo de visión configurado no aparece en el catálogo local.'));
    } catch { checks.push(result('probe.engine', 'error', 'El catálogo local no está disponible o su respuesta no es válida. Revisa Ollama, el túnel y Access. No se siguieron redirecciones.')); }
  }
  for (const vision of [false, true]) {
    if (vision ? !flags.vision : !flags.generate) continue;
    const check = vision ? 'probe.vision' : 'probe.generate';
    const model = vision ? env.OLLAMA_VISION_MODEL : env.OLLAMA_MAIN_MODEL;
    if (!present(model)) { checks.push(result(check, 'error', 'Configura el modelo local requerido antes de solicitar esta inferencia.')); continue; }
    try {
      const content = vision ? [
        { type: 'text', text: 'Describe brevemente el color predominante de esta imagen sintética de prueba.' },
        { type: 'image_url', image_url: { url: VISION_FIXTURE } },
      ] : 'Esta es una prueba sintética sin datos personales. Responde únicamente SARIN_DOCTOR_OK.';
      const data = await boundedJson(await fetchImpl(url.toString(), {
        method: 'POST', headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(120000),
        body: JSON.stringify({ model, messages: [{ role: 'user', content }], stream: false, temperature: 0, max_tokens: vision ? 64 : 32, reasoning_effort: 'none' }),
      }));
      if (!validCompletion(data)) throw new Error('Invalid completion');
      checks.push(result(check, 'ok', vision ? 'El modelo de visión completó una prueba con una imagen sintética local. Su respuesta se omitió.' : 'El modelo principal completó una prueba de texto sintético. Su respuesta se omitió.'));
    } catch { checks.push(result(check, 'error', 'La inferencia local no respondió correctamente dentro del tiempo y tamaño permitidos. Revisa el modelo, Ollama y Access. No se reintentó la petición.')); }
  }
  return { checks, exitCode: checks.some(check => check.status === 'error') ? 1 : 0 };
}

/** @param {string[]} args */
export function parseDoctorFlags(args) {
  const known = new Set(['--help', '--engine', '--generate', '--vision']);
  if (args.some(argument => !known.has(argument))) throw new Error('Opción no reconocida. Usa --help.');
  return { help: args.includes('--help'), flags: { engine: args.includes('--engine'), generate: args.includes('--generate'), vision: args.includes('--vision') } };
}
