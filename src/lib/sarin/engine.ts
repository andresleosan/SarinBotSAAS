import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from '@/lib/server/http';
import type { AiProvider } from '@/types/ai';

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string }; }
export interface ToolDefinition { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> }; }
export interface EngineMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null | ContentPart[]; tool_calls?: ToolCall[]; tool_call_id?: string; }
export interface EngineAssistantMessage { role: 'assistant'; content: string | null; tool_calls?: ToolCall[]; }
export type EngineProvider = AiProvider;
export interface EngineHealth { provider: EngineProvider | null; online: boolean; checkedAt: number; visionAvailable: boolean; error?: string; }
export interface EngineTokenUsage { promptTokens: number; cacheHitTokens: number; cacheMissTokens: number; cacheWriteTokens?: number | null; completionTokens: number; totalTokens: number; }
export interface EngineUsageObservation { callId: string; provider: 'deepseek' | 'openai'; model: string | null; serviceTier?: string | null; startedAt: number; finishedAt: number; success: boolean; usage: EngineTokenUsage | null; }

function validateProvider(provider: string): EngineProvider {
  if (provider !== 'ollama' && provider !== 'deepseek' && provider !== 'openai') throw new HttpError(503, 'El proveedor de conversaciones no es válido.');
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
  if (provider === 'openai') {
    if (vision) throw new HttpError(503, 'Las imágenes requieren el motor local de la Mac.');
    const key = process.env.OPENAI_API_KEY;
    if (!key || /\s|[\x00-\x1f\x7f]/.test(key)) throw new HttpError(503, 'Configura una credencial válida de OpenAI en el servidor.');
    const model = process.env.OPENAI_MODEL ?? 'gpt-6-luna';
    if (model !== 'gpt-6-luna') throw new HttpError(503, 'El modelo configurado de OpenAI no está habilitado.');
    headers.Authorization = `Bearer ${key}`;
    return { provider, url: new URL('https://api.openai.com/v1/chat/completions'), headers, model, timeoutMs };
  }
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
  const name = provider === 'openai' ? 'OpenAI' : 'DeepSeek';
  if (status === 401 || status === 403) return `${name} rechazó la credencial del servidor. Revisa su configuración.`;
  if (status === 402) return `${name} no tiene saldo disponible. Revisa la cuenta del proveedor.`;
  if (status === 429) return `${name} alcanzó su límite de solicitudes o cuota. Revisa la cuenta o inténtalo más tarde.`;
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
  tool_calls: z.array(z.object({ id: z.string().min(1).max(200), type: z.literal('function'), function: z.object({ name: z.string().min(1).max(100), arguments: z.string().max(64_000) }) })).max(8).optional(),
}) })).min(1).max(4) });

const tokenCount = z.number().int().min(0).max(2_000_000);
const usageSchema = z.object({ prompt_tokens: tokenCount, prompt_cache_hit_tokens: tokenCount, prompt_cache_miss_tokens: tokenCount, completion_tokens: tokenCount, total_tokens: z.number().int().min(0).max(4_000_000) })
  .refine(value => value.prompt_tokens === value.prompt_cache_hit_tokens + value.prompt_cache_miss_tokens && value.total_tokens === value.prompt_tokens + value.completion_tokens);
const openAiUsageSchema = z.object({ prompt_tokens: tokenCount, prompt_tokens_details: z.object({ cached_tokens: tokenCount, cache_write_tokens: tokenCount.nullable().optional() }), completion_tokens: tokenCount, total_tokens: z.number().int().min(0).max(4_000_000) })
  .refine(value => value.prompt_tokens >= value.prompt_tokens_details.cached_tokens + (value.prompt_tokens_details.cache_write_tokens ?? 0) && value.total_tokens === value.prompt_tokens + value.completion_tokens);
const openAiTierSchema = z.enum(['auto', 'default', 'flex', 'scale', 'priority', 'fast']);

export async function completeChat(messages: EngineMessage[], tools?: readonly ToolDefinition[], options: { vision?: boolean; signal?: AbortSignal; provider?: EngineProvider; onUsage?: (observation: EngineUsageObservation) => void | Promise<void> } = {}): Promise<EngineAssistantMessage> {
  const config = engineConfig(options.vision, options.provider);
  if (config.provider !== 'ollama' && messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url'))) {
    throw new HttpError(503, 'Las imágenes requieren el motor local de la Mac.');
  }
  // Only the supported function-call fields may leave the server.
  const requestMessages = messages.map(message => message.tool_calls ? {
    ...message, tool_calls: message.tool_calls.map(call => ({ id: call.id, type: call.type, function: call.function })),
  } : message);
  const observation: EngineUsageObservation | undefined = config.provider !== 'ollama' && options.onUsage
    ? { callId: randomUUID(), provider: config.provider, model: config.provider === 'openai' ? null : config.model, ...(config.provider === 'openai' ? { serviceTier: null } : {}), startedAt: Date.now(), finishedAt: 0, success: false, usage: null } : undefined;
  try {
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(config.timeoutMs)]) : AbortSignal.timeout(config.timeoutMs);
    const response = await fetch(config.url.toString(), { method: 'POST', headers: config.headers, cache: 'no-store', redirect: 'error', signal,
      body: JSON.stringify({ model: config.model, messages: requestMessages, stream: false,
        ...(config.provider === 'openai' ? { max_completion_tokens: 4096, reasoning_effort: 'none', store: false, service_tier: 'default' }
          : { max_tokens: 4096, temperature: 0.2, ...(config.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : { think: false }) }),
        ...(tools?.length ? { tools, tool_choice: 'auto' } : {}) }) });
    if (!response.ok) { await response.body?.cancel(); throw new HttpError(503, unavailableMessage(config.provider, response.status)); }
    const data = await responseJson(response);
    if (observation && data && typeof data === 'object') {
      const metadata = data as Record<string, unknown>;
      if ('model' in metadata) observation.model = typeof metadata.model === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(metadata.model) ? metadata.model : null;
      if (config.provider === 'openai') {
        const tier = openAiTierSchema.safeParse(metadata.service_tier);
        observation.serviceTier = tier.success ? tier.data : null;
        const usage = openAiUsageSchema.safeParse(metadata.usage);
        if (usage.success) observation.usage = {
          promptTokens: usage.data.prompt_tokens, cacheHitTokens: usage.data.prompt_tokens_details.cached_tokens,
          // Cache writes are a subset of uncached input, not additional prompt tokens.
          cacheMissTokens: usage.data.prompt_tokens - usage.data.prompt_tokens_details.cached_tokens,
          cacheWriteTokens: usage.data.prompt_tokens_details.cache_write_tokens ?? null,
          completionTokens: usage.data.completion_tokens, totalTokens: usage.data.total_tokens,
        };
      } else {
        const usage = usageSchema.safeParse(metadata.usage);
        if (usage.success) observation.usage = { promptTokens: usage.data.prompt_tokens, cacheHitTokens: usage.data.prompt_cache_hit_tokens, cacheMissTokens: usage.data.prompt_cache_miss_tokens, completionTokens: usage.data.completion_tokens, totalTokens: usage.data.total_tokens };
      }
    }
    const parsed = assistantSchema.safeParse(data);
    if (!parsed.success) throw new HttpError(502, 'Respuesta no válida del motor.');
    const message = parsed.data.choices[0].message;
    if (!message.content?.trim() && !message.tool_calls?.length) throw new HttpError(502, 'El motor no produjo una respuesta.');
    if (observation) observation.success = true;
    return { role: 'assistant', content: message.content ?? null, ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) };
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('Solicitud cancelada.', 'AbortError');
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, unavailableMessage(config.provider));
  } finally {
    if (observation) {
      observation.finishedAt = Date.now();
      // Accounting never changes a model result or retries a committed tool.
      try { await options.onUsage!(observation); } catch { /* The recorder reports its own safe write-failure counter. */ }
    }
  }
}

/** Safe configuration summary for the authenticated administrator; no endpoints or credentials. */
export function getEngineConfiguration(provider: EngineProvider): { configured: boolean; model: string | null; error?: string } {
  try { return { configured: true, model: engineConfig(false, provider).model }; }
  catch (error) { return { configured: false, model: null, error: error instanceof HttpError ? error.message : 'La configuración del proveedor no es válida.' }; }
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
    const ids = data.success ? data.data.data.map((entry) => entry.id) : [];
    const online = ids.includes(config.model);
    return { provider, online, checkedAt: Date.now(), visionAvailable: provider === 'ollama' && Boolean(process.env.OLLAMA_VISION_MODEL && ids.includes(process.env.OLLAMA_VISION_MODEL)),
      ...(!online ? { error: unavailableMessage(provider) } : {}) };
  } catch (error) {
    return { provider, online: false, checkedAt: Date.now(), visionAvailable: false,
      error: error instanceof HttpError ? error.message : provider ? unavailableMessage(provider) : 'El proveedor de conversaciones no es válido.' };
  }
}
