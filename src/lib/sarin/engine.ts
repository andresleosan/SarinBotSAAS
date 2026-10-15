import 'server-only';
import { z } from 'zod';
import { HttpError } from '@/lib/server/http';

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string }; extra_content?: { google?: { thought_signature?: string } }; }
export interface ToolDefinition { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> }; }
export interface EngineMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null | ContentPart[]; tool_calls?: ToolCall[]; tool_call_id?: string; }
export interface EngineAssistantMessage { role: 'assistant'; content: string | null; tool_calls?: ToolCall[]; }
export type EngineProvider = 'ollama' | 'deepseek' | 'gemini';
export interface EngineHealth { provider: EngineProvider | null; online: boolean; checkedAt: number; visionAvailable: boolean; error?: string; }

function validateProvider(provider: string): EngineProvider {
  if (provider !== 'ollama' && provider !== 'deepseek' && provider !== 'gemini') throw new HttpError(503, 'El proveedor de conversaciones no es válido.');
  return provider;
}

export function getChatProvider(): EngineProvider {
  return validateProvider(process.env.SARIN_CHAT_PROVIDER ?? 'ollama');
}

function engineConfig(vision = false, selectedProvider = getChatProvider()) {
  const provider = validateProvider(selectedProvider);
  const timeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? 120_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000) throw new HttpError(503, 'Tiempo de espera del motor no válido.');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (provider === 'deepseek') {
    if (vision) throw new HttpError(503, 'Las imágenes requieren el motor local de la Mac.');
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key || /\s|[\x00-\x1f\x7f]/.test(key)) throw new HttpError(503, 'Configura una credencial válida de DeepSeek en el servidor.');
    const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-flash';
    if (model !== 'deepseek-flash') throw new HttpError(503, 'El modelo configurado de DeepSeek no está habilitado.');
    // The cloud destination and its credential are independent of the private tunnel.
    headers.Authorization = `Bearer ${key}`;
    return { provider, url: new URL('https://api.deepseek.com/chat/completions'), headers, model, timeoutMs };
  }
  if (provider === 'gemini') {
    if (vision) throw new HttpError(503, 'Las imágenes requieren el motor local de la Mac.');
    const key = process.env.GEMINI_API_KEY;
    if (!key || !/^[\x21-\x7e]+$/.test(key)) throw new HttpError(503, 'Configura una credencial válida de Gemini en el servidor.');
    const model = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';
    if (model !== 'gemini-3.5-flash-lite') throw new HttpError(503, 'El modelo configurado de Gemini no está habilitado.');
    headers.Authorization = `Bearer ${key}`;
    return { provider, url: new URL('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'), headers, model, timeoutMs };
  }
  let url: URL;
  try { url = new URL(process.env.SARIN_TUNNEL_URL ?? ''); } catch { throw new HttpError(503, 'El motor local no está configurado.'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/v1/chat/completions')) {
    throw new HttpError(503, 'La dirección del motor local no es válida.');
  }
  const hostname = url.hostname.replace(/\.$/, '');
  if (['ollama.com', 'api.openai.com', 'api.deepseek.com', 'generativelanguage.googleapis.com'].some((host) => hostname === host || hostname.endsWith(`.${host}`))) throw new HttpError(503, 'Se requiere un motor local privado.');
  const clientId = process.env.CF_ACCESS_CLIENT_ID;
  const secret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (!local && (!clientId || !secret)) throw new HttpError(503, 'Configura el service token de Cloudflare Access.');
  if (clientId && secret) { headers['CF-Access-Client-Id'] = clientId; headers['CF-Access-Client-Secret'] = secret; }
  const model = vision ? process.env.OLLAMA_VISION_MODEL : process.env.OLLAMA_MAIN_MODEL;
  if (!model || /(?:[:\-])cloud(?:$|[:\-])/i.test(model)) throw new HttpError(503, vision ? 'Configura un modelo de visión local.' : 'Configura el modelo principal local.');
  return { provider, url, headers, model, timeoutMs };
}

function unavailableMessage(provider: EngineProvider, status?: number): string {
  if (provider === 'ollama') return 'El motor local no está disponible. Comprueba Ollama y el túnel.';
  const name = provider === 'gemini' ? 'Gemini' : 'DeepSeek';
  if (status === 401 || status === 403) return `${name} rechazó la credencial del servidor. Revisa su configuración.`;
  if (status === 402) return `${name} no tiene saldo disponible. Revisa la cuenta del proveedor.`;
  if (status === 429) return provider === 'gemini' ? 'Gemini alcanzó su cuota de uso. Revisa el límite del proyecto e inténtalo más tarde.' : 'DeepSeek alcanzó su límite de solicitudes. Inténtalo de nuevo en un momento.';
  return `Sarin no puede conectar con ${name}. Inténtalo de nuevo en un momento.`;
}

async function responseJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, 'El motor devolvió una respuesta vacía.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new HttpError(502, 'Respuesta del motor demasiado grande.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(all)); } catch { throw new HttpError(502, 'Respuesta no válida del motor.'); }
}

const assistantSchema = z.object({ choices: z.array(z.object({ message: z.object({
  content: z.string().max(512_000).nullable().optional(),
  tool_calls: z.array(z.object({ id: z.string().min(1).max(200), type: z.literal('function'), function: z.object({ name: z.string().min(1).max(100), arguments: z.string().max(64_000) }),
    extra_content: z.object({ google: z.object({ thought_signature: z.string().max(128_000).optional() }).optional() }).optional(),
  })).max(8).optional(),
}) })).min(1).max(4) });

export async function completeChat(messages: EngineMessage[], tools?: readonly ToolDefinition[], options: { vision?: boolean; signal?: AbortSignal; provider?: EngineProvider } = {}): Promise<EngineAssistantMessage> {
  const config = engineConfig(options.vision, options.provider);
  if (config.provider !== 'ollama' && messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url'))) {
    throw new HttpError(503, 'Las imágenes requieren el motor local de la Mac.');
  }
  // Thought signatures belong to Google. Preserve them for its tool loop only.
  const requestMessages = config.provider === 'gemini' ? messages : messages.map(message => message.tool_calls ? {
    ...message, tool_calls: message.tool_calls.map(call => ({ id: call.id, type: call.type, function: call.function })),
  } : message);
  try {
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(config.timeoutMs)]) : AbortSignal.timeout(config.timeoutMs);
    const response = await fetch(config.url.toString(), { method: 'POST', headers: config.headers, cache: 'no-store', redirect: 'error', signal,
      body: JSON.stringify({ model: config.model, messages: requestMessages, stream: false, max_tokens: 4096,
        ...(config.provider === 'gemini' ? { reasoning_effort: 'minimal' } : { temperature: 0.2, ...(config.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : { think: false }) }),
        ...(tools?.length ? { tools, tool_choice: 'auto' } : {}) }) });
    if (!response.ok) { await response.body?.cancel(); throw new HttpError(503, unavailableMessage(config.provider, response.status)); }
    const parsed = assistantSchema.safeParse(await responseJson(response));
    if (!parsed.success) throw new HttpError(502, 'Respuesta no válida del motor.');
    const message = parsed.data.choices[0].message;
    if (!message.content?.trim() && !message.tool_calls?.length) throw new HttpError(502, 'El motor no produjo una respuesta.');
    return { role: 'assistant', content: message.content ?? null, ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) };
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('Solicitud cancelada.', 'AbortError');
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, unavailableMessage(config.provider));
  }
}

export async function probeEngine(selectedProvider?: EngineProvider): Promise<EngineHealth> {
  let provider: EngineProvider | null = null;
  try {
    provider = selectedProvider === undefined ? getChatProvider() : validateProvider(selectedProvider);
    const config = engineConfig(false, provider);
    const modelsUrl = new URL(config.url); modelsUrl.pathname = modelsUrl.pathname.replace(/chat\/completions$/, 'models');
    const response = await fetch(modelsUrl.toString(), { headers: config.headers, method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) { await response.body?.cancel(); throw new HttpError(503, unavailableMessage(provider, response.status)); }
    const data = z.object({ data: z.array(z.object({ id: z.string() })) }).safeParse(await responseJson(response));
    const ids = data.success ? data.data.data.map((entry) => provider === 'gemini' ? entry.id.replace(/^models\//, '') : entry.id) : [];
    const online = ids.includes(config.model);
    return { provider, online, checkedAt: Date.now(), visionAvailable: provider === 'ollama' && Boolean(process.env.OLLAMA_VISION_MODEL && ids.includes(process.env.OLLAMA_VISION_MODEL)),
      ...(!online ? { error: unavailableMessage(provider) } : {}) };
  } catch (error) {
    return { provider, online: false, checkedAt: Date.now(), visionAvailable: false,
      error: error instanceof HttpError ? error.message : provider ? unavailableMessage(provider) : 'El proveedor de conversaciones no es válido.' };
  }
}
