import 'server-only';
import { z } from 'zod';
import { HttpError } from '@/lib/server/http';

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string }; }
export interface ToolDefinition { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> }; }
export interface EngineMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null | ContentPart[]; tool_calls?: ToolCall[]; tool_call_id?: string; }
export interface EngineAssistantMessage { role: 'assistant'; content: string | null; tool_calls?: ToolCall[]; }

function engineConfig(vision = false) {
  let url: URL;
  try { url = new URL(process.env.SARIN_TUNNEL_URL ?? ''); } catch { throw new HttpError(503, 'El motor local no está configurado.'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/v1/chat/completions')) {
    throw new HttpError(503, 'La dirección del motor local no es válida.');
  }
  if (['ollama.com', 'api.openai.com'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new HttpError(503, 'Se requiere un motor local privado.');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const clientId = process.env.CF_ACCESS_CLIENT_ID;
  const secret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (!local && (!clientId || !secret)) throw new HttpError(503, 'Configura el service token de Cloudflare Access.');
  if (clientId && secret) { headers['CF-Access-Client-Id'] = clientId; headers['CF-Access-Client-Secret'] = secret; }
  const model = vision ? process.env.OLLAMA_VISION_MODEL : process.env.OLLAMA_MAIN_MODEL;
  if (!model || /(?:[:\-])cloud(?:$|[:\-])/i.test(model)) throw new HttpError(503, vision ? 'Configura un modelo de visión local.' : 'Configura el modelo principal local.');
  const timeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? 120_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000) throw new HttpError(503, 'Tiempo de espera del motor no válido.');
  return { url, headers, model, timeoutMs };
}

async function responseJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, 'El motor local devolvió una respuesta vacía.');
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
  try { return JSON.parse(new TextDecoder().decode(all)); } catch { throw new HttpError(502, 'Respuesta no válida del motor local.'); }
}

const assistantSchema = z.object({ choices: z.array(z.object({ message: z.object({
  content: z.string().max(512_000).nullable().optional(),
  tool_calls: z.array(z.object({ id: z.string().min(1).max(200), type: z.literal('function'), function: z.object({ name: z.string().min(1).max(100), arguments: z.string().max(64_000) }) })).max(8).optional(),
}) })).min(1).max(4) });

export async function completeChat(messages: EngineMessage[], tools?: readonly ToolDefinition[], options: { vision?: boolean; signal?: AbortSignal } = {}): Promise<EngineAssistantMessage> {
  const config = engineConfig(options.vision);
  try {
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(config.timeoutMs)]) : AbortSignal.timeout(config.timeoutMs);
    const response = await fetch(config.url.toString(), { method: 'POST', headers: config.headers, cache: 'no-store', redirect: 'error', signal,
      body: JSON.stringify({ model: config.model, messages, stream: false, temperature: 0.2, max_tokens: 4096, think: false,
        ...(tools?.length ? { tools, tool_choice: 'auto' } : {}) }) });
    if (!response.ok) { await response.body?.cancel(); throw new HttpError(503, 'El motor local no está disponible. Comprueba Ollama y el túnel.'); }
    const parsed = assistantSchema.safeParse(await responseJson(response));
    if (!parsed.success) throw new HttpError(502, 'Respuesta no válida del motor local.');
    const message = parsed.data.choices[0].message;
    if (!message.content?.trim() && !message.tool_calls?.length) throw new HttpError(502, 'El motor local no produjo una respuesta.');
    return { role: 'assistant', content: message.content ?? null, ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) };
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('Solicitud cancelada.', 'AbortError');
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'Sarin no puede conectar con la Mac. Comprueba Ollama y el túnel e inténtalo de nuevo.');
  }
}

export async function probeEngine(): Promise<{ online: boolean; checkedAt: number; visionAvailable?: boolean }> {
  try {
    const config = engineConfig();
    const modelsUrl = new URL(config.url); modelsUrl.pathname = modelsUrl.pathname.replace(/chat\/completions$/, 'models');
    const response = await fetch(modelsUrl.toString(), { headers: config.headers, method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) { await response.body?.cancel(); return { online: false, checkedAt: Date.now() }; }
    const data = z.object({ data: z.array(z.object({ id: z.string() })) }).safeParse(await responseJson(response));
    const ids = data.success ? data.data.data.map((entry) => entry.id) : [];
    return { online: ids.includes(config.model), checkedAt: Date.now(), visionAvailable: Boolean(process.env.OLLAMA_VISION_MODEL && ids.includes(process.env.OLLAMA_VISION_MODEL)) };
  } catch { return { online: false, checkedAt: Date.now() }; }
}
