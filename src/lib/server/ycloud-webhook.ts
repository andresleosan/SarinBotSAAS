import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from '@/lib/server/http';
import { readBoundedRequestBody } from '@/lib/server/read-bounded-body';

export interface YCloudReaderScope { wabaId: string; phoneE164: string }
export interface YCloudWebhookOptions { signingSecret: string; scope: YCloudReaderScope; now?: number }
interface NormalizedBase {
  provider: 'ycloud';
  eventId: string;
  occurredAt: number;
  wabaId: string;
  businessPhone: string;
  messageId: string;
  whatsappMessageId: string | null;
}
export type NormalizedYCloudEvent = NormalizedBase & (
  | { kind: 'incoming_text'; sourceEventType: 'whatsapp.inbound_message.received'; customerPhone: string; text: string }
  | { kind: 'human_echo'; sourceEventType: 'whatsapp.smb.message.echoes' | 'whatsapp.smb.message.created'; customerPhone: string; messageType: string; text: string | null }
  | { kind: 'message_status'; sourceEventType: 'whatsapp.message.updated'; customerPhone: string | null; status: 'accepted' | 'sent' | 'delivered' | 'read' | 'failed' }
);

const idSchema = z.string().min(1).max(256).refine((value) => !/[^\x21-\x7e]/.test(value));
const wabaSchema = z.string().min(5).max(30).refine((value) => !/\D/.test(value));
const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}(?![\s\S])/);
const scopeSchema = z.object({ wabaId: wabaSchema, phoneE164: phoneSchema }).strict();
const eventSchema = z.object({ id: idSchema, type: idSchema, apiVersion: z.string().min(1).max(32), createTime: z.iso.datetime({ offset: true }).max(40), whatsappInboundMessage: z.unknown().optional(), whatsappMessage: z.unknown().optional() });
const messageSchema = z.object({ id: idSchema, wamid: z.string().min(1).max(1024).optional(), wabaId: wabaSchema, from: phoneSchema, to: phoneSchema });
const textMessageSchema = messageSchema.extend({ type: z.string().min(1).max(64), text: z.unknown().optional() });
const statusMessageSchema = messageSchema.partial({ wabaId: true, from: true, to: true }).extend({ status: z.string().min(1).max(64) });
const textSchema = z.object({ body: z.string().min(1).max(4096) });
const statusSchema = z.enum(['accepted', 'sent', 'delivered', 'read', 'failed']);

function parseEvent<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, 'El evento de YCloud no es válido.');
  return parsed.data;
}
function verifySignature(bytes: Buffer, header: string | null, signingSecret: string, now: number): void {
  const invalid = () => new HttpError(401, 'La firma de YCloud no es válida.');
  if (!header || header.length > 1024) throw invalid();
  const segments = header.split(',').map((segment) => segment.trim());
  if (segments.some((segment) => !/^(?:t=\d{1,12}|s=[a-fA-F0-9]{64})$/.test(segment))) throw invalid();
  const timestamps = segments.filter((segment) => segment.startsWith('t='));
  const signatures = segments.filter((segment) => segment.startsWith('s='));
  if (timestamps.length !== 1 || signatures.length < 1 || signatures.length > 5) throw invalid();
  const timestamp = timestamps[0].slice(2);
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 300) throw invalid();
  const expected = createHmac('sha256', signingSecret).update(timestamp + '.').update(bytes).digest();
  if (!signatures.some((signature) => timingSafeEqual(expected, Buffer.from(signature.slice(2), 'hex')))) throw invalid();
}
function normalize(value: unknown, scope: YCloudReaderScope): NormalizedYCloudEvent | null {
  const event = parseEvent(eventSchema, value);
  if (event.apiVersion !== 'v2') return null;
  const common = { provider: 'ycloud' as const, eventId: event.id, occurredAt: Date.parse(event.createTime), wabaId: scope.wabaId, businessPhone: scope.phoneE164 };
  if (event.type === 'whatsapp.inbound_message.received') {
    const message = parseEvent(textMessageSchema, event.whatsappInboundMessage);
    if (message.wabaId !== scope.wabaId || message.to !== scope.phoneE164 || message.from === scope.phoneE164 || message.type !== 'text') return null;
    return { ...common, kind: 'incoming_text', sourceEventType: event.type, customerPhone: message.from, messageId: message.id, whatsappMessageId: message.wamid ?? null, text: parseEvent(textSchema, message.text).body };
  }
  if (event.type === 'whatsapp.smb.message.echoes' || event.type === 'whatsapp.smb.message.created') {
    const message = parseEvent(textMessageSchema, event.whatsappMessage);
    if (message.wabaId !== scope.wabaId || message.from !== scope.phoneE164 || message.to === scope.phoneE164) return null;
    return { ...common, kind: 'human_echo', sourceEventType: event.type, customerPhone: message.to, messageId: message.id, whatsappMessageId: message.wamid ?? null, messageType: message.type, text: message.type === 'text' ? parseEvent(textSchema, message.text).body : null };
  }
  if (event.type === 'whatsapp.message.updated') {
    const message = parseEvent(statusMessageSchema, event.whatsappMessage);
    if (message.wabaId !== scope.wabaId || message.from !== scope.phoneE164 || message.to === scope.phoneE164) return null;
    const status = statusSchema.safeParse(message.status);
    return status.success ? { ...common, kind: 'message_status', sourceEventType: event.type, customerPhone: message.to ?? null, messageId: message.id, whatsappMessageId: message.wamid ?? null, status: status.data } : null;
  }
  return null;
}

/** Authenticate original request bytes and return data; routing and effects belong to callers. */
export async function readYCloudWebhook(request: Request, options: YCloudWebhookOptions): Promise<NormalizedYCloudEvent | null> {
  const scope = scopeSchema.safeParse(options.scope);
  const now = options.now ?? Date.now();
  if (!scope.success || typeof options.signingSecret !== 'string' || options.signingSecret.length > 4096 || !/\S/.test(options.signingSecret) || !Number.isSafeInteger(now) || now < 0) {
    throw new HttpError(503, 'La configuración del lector de YCloud no es válida.');
  }
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new HttpError(415, 'Se requiere contenido JSON en UTF-8.');
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && !/^(?:0|[1-9]\d*)$/.test(declaredLength)) throw new HttpError(400, 'El tamaño declarado no es válido.');
  if (declaredLength !== null && Number(declaredLength) > 1048576) throw new HttpError(413, 'El cuerpo supera el tamaño permitido.');
  const bytes = await readBoundedRequestBody(request, { maxBytes: 1048576, timeoutMs: 3000 });
  if (declaredLength !== null && Number(declaredLength) !== bytes.byteLength) throw new HttpError(400, 'El tamaño declarado no coincide con el cuerpo.');
  verifySignature(bytes, request.headers.get('YCloud-Signature'), options.signingSecret, now);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)); }
  catch { throw new HttpError(400, 'JSON no válido.'); }
  return normalize(value, scope.data);
}
