import 'server-only';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '@/lib/storage/types';
import { HttpError } from './http';
import { readBoundedRequestBody } from './read-bounded-body';
import { readYCloudWebhook } from './ycloud-webhook';

const documentId = 'ycloud_retry_diagnostic';
const unavailable = () => new HttpError(503, 'El diagnóstico no está disponible.');
const invalidSignature = () => new HttpError(401, 'La firma de YCloud no es válida.');
const eventIdSchema = z.string().regex(/^[\x21-\x7e]{1,256}$/);
const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/);
const configSchema = z.object({
  runId: z.uuid(), expiresAt: z.number().int().positive(),
  signingSecret: z.string().min(1).max(4096).refine(value => /\S/.test(value)),
  wabaId: z.string().regex(/^\d{5,30}$/), phoneE164: phoneSchema, sender: phoneSchema,
  nonce: z.string().regex(/^[\x21-\x7e]{32,128}$/),
}).strict();
const attemptSchema = z.object({
  eventId: eventIdSchema, bodySha256: z.string().regex(/^[a-f0-9]{64}$/),
  arrivalUtc: z.iso.datetime(), signedT: z.number().int().nonnegative(), hmacValid: z.literal(true),
}).strict();
const stateSchema = z.object({
  version: z.literal(1), runId: z.uuid(), bootId: z.uuid(),
  createdAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive(),
  requests: z.number().int().min(0).max(32),
  status: z.enum(['armed', 'pinned', 'compatible', 'incompatible', 'inconclusive', 'aborted', 'closed']),
  attempts: z.array(attemptSchema).max(16),
}).strict();
type DiagnosticConfig = z.infer<typeof configSchema>;
type DiagnosticState = z.infer<typeof stateSchema>;
interface DiagnosticObserver {
  arm(): Promise<void>;
  read(): Promise<DiagnosticState>;
  close(): Promise<void>;
  observe(request: Request): Promise<204 | 503>;
}
interface DiagnosticProcess { bootId: string; cached?: { config: DiagnosticConfig; observer: DiagnosticObserver } }
const processKey = Symbol.for('sarin.ycloud.retry-diagnostic.process');
const globals = globalThis as typeof globalThis & { [processKey]?: DiagnosticProcess };
const processState = globals[processKey] ??= { bootId: randomUUID() };
const bootId = processState.bootId;

async function readDiagnosticBody(request: Request): Promise<Buffer> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new HttpError(415, 'Se requiere JSON.');
  const length = request.headers.get('content-length');
  if (length !== null && !/^(?:0|[1-9]\d*)$/.test(length)) throw new HttpError(400, 'Tamaño no válido.');
  if (length !== null && Number(length) > 1048576) throw new HttpError(413, 'Cuerpo demasiado grande.');
  const raw = await readBoundedRequestBody(request, { maxBytes: 1048576, timeoutMs: 3000 });
  if (length !== null && Number(length) !== raw.length) throw new HttpError(400, 'Tamaño no válido.');
  return raw;
}

/** Isolated retry observation deliberately authenticates bytes without checking age. */
function diagnosticSignedTimestamp(raw: Buffer, header: string | null, secret: string): number {
  if (!header || header.length > 1024) throw invalidSignature();
  const tokens = header.split(',').map(token => token.trim());
  if (tokens.some(token => !/^(?:t=\d{1,12}|s=[a-fA-F0-9]{64})$/.test(token))) throw invalidSignature();
  const timestamps = tokens.filter(token => token.startsWith('t='));
  const signatures = tokens.filter(token => token.startsWith('s='));
  if (timestamps.length !== 1 || signatures.length < 1 || signatures.length > 5) throw invalidSignature();
  const timestamp = timestamps[0].slice(2);
  const expected = createHmac('sha256', secret).update(timestamp + '.').update(raw).digest();
  if (!signatures.some(signature => timingSafeEqual(expected, Buffer.from(signature.slice(2), 'hex')))) throw invalidSignature();
  return Number(timestamp);
}

function parseState(input: unknown): DiagnosticState {
  const parsed = stateSchema.safeParse(input);
  if (!parsed.success) throw unavailable();
  return parsed.data;
}

/** Frozen export C includes the bounded tuples; this is only exposed behind admin auth. */
export async function readYCloudRetryDiagnosticSummary(database: Database) {
  const { status, expiresAt, requests, attempts } = parseState((await database.collection('serverSettings').doc(documentId).get()).data());
  return { status, expiresAt: new Date(expiresAt).toISOString(), requests, attempts };
}

export async function closeYCloudRetryDiagnostic(database: Database): Promise<void> {
  const ref = database.collection('serverSettings').doc(documentId);
  await database.runTransaction(async transaction => {
    const state = parseState((await transaction.get(ref)).data());
    transaction.set(ref, { ...state, status: 'closed', attempts: [] });
  });
}

function createObserver(config: DiagnosticConfig, database: Database, instanceBootId = bootId): DiagnosticObserver {
  if (!configSchema.safeParse(config).success || !z.uuid().safeParse(instanceBootId).success || config.sender === config.phoneE164) throw unavailable();
  const ref = database.collection('serverSettings').doc(documentId);
  let requests = 0;
  let concurrent = 0;
  let closed = false;
  function requireOperational(state: DiagnosticState, now: number): void {
    if (state.runId !== config.runId || state.bootId !== instanceBootId || state.expiresAt !== config.expiresAt
      || state.expiresAt - state.createdAt > 2700000 || now < state.createdAt || now >= state.expiresAt
      || state.status === 'aborted' || state.status === 'closed' || (state.status === 'armed') !== (state.attempts.length === 0)) throw unavailable();
  }
  return {
    async arm() {
      const now = Date.now();
      if (config.expiresAt <= now || config.expiresAt - now > 2700000) throw unavailable();
      await database.runTransaction(async transaction => {
        if ((await transaction.get(ref)).exists) throw new HttpError(409, 'Ya existe un diagnóstico; no se puede rearmar.');
        transaction.create(ref, { version: 1, runId: config.runId, bootId: instanceBootId, createdAt: now, expiresAt: config.expiresAt, requests: 0, status: 'armed', attempts: [] });
      });
    },
    async read() { return parseState((await ref.get()).data()); },
    async close() {
      await database.runTransaction(async transaction => {
        const state = parseState((await transaction.get(ref)).data());
        transaction.set(ref, { ...state, status: 'closed', attempts: [] });
      });
      closed = true;
    },
    async observe(request) {
      const arrivalNow = Date.now();
      if (closed || requests >= 32 || concurrent >= 2) throw unavailable();
      requests++; concurrent++;
      try {
        await database.runTransaction(async transaction => {
          const state = parseState((await transaction.get(ref)).data());
          requireOperational(state, arrivalNow);
          if (state.requests >= 32) throw unavailable();
          transaction.set(ref, { ...state, requests: state.requests + 1 });
        });
        const raw = await readDiagnosticBody(request);
        const signedT = diagnosticSignedTimestamp(raw, request.headers.get('YCloud-Signature'), config.signingSecret);
        let input: unknown;
        try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw)); }
        catch { throw new HttpError(400, 'JSON no válido.'); }
        const envelope = z.object({ id: eventIdSchema, type: z.string(), apiVersion: z.string(), whatsappInboundMessage: z.unknown().optional() }).safeParse(input);
        if (!envelope.success) return 204;
        const event = envelope.data;
        const bodySha256 = createHash('sha256').update(raw).digest('hex');
        const inbound = z.object({ wabaId: z.string(), from: z.string(), to: z.string(), type: z.string(), text: z.object({ body: z.string() }) }).safeParse(event.whatsappInboundMessage);
        const candidate = event.apiVersion === 'v2' && event.type === 'whatsapp.inbound_message.received' && inbound.success
          && inbound.data.wabaId === config.wabaId && inbound.data.to === config.phoneE164 && inbound.data.from === config.sender
          && inbound.data.type === 'text' && inbound.data.text.body === config.nonce;
        let normalAccepted = false;
        if (candidate) {
          try {
            normalAccepted = (await readYCloudWebhook(new Request(request.url, { method: 'POST', headers: request.headers, body: new Uint8Array(raw) }),
              { signingSecret: config.signingSecret, scope: { wabaId: config.wabaId, phoneE164: config.phoneE164 } }))?.kind === 'incoming_text';
          } catch (error) {
            if (!(error instanceof HttpError) || error.status !== 401) throw unavailable();
          }
        }
        return await database.runTransaction(async transaction => {
          const state = parseState((await transaction.get(ref)).data());
          requireOperational(state, Date.now());
          const first = state.attempts[0];
          const abort = (): 503 => { transaction.set(ref, { ...state, status: 'aborted' }); return 503; };
          if (first?.eventId === event.id && first.bodySha256 !== bodySha256) return abort();
          if (!candidate) return 204;
          if (first && first.eventId !== event.id) return abort();
          if (state.status === 'compatible' || state.status === 'incompatible' || state.status === 'inconclusive' || !first && !normalAccepted) return 204;
          if (state.attempts.length >= 16) return abort();
          const attempts = [...state.attempts, { eventId: event.id, bodySha256, arrivalUtc: new Date(arrivalNow).toISOString(), signedT, hmacValid: true as const }]
            .sort((left, right) => Date.parse(left.arrivalUtc) - Date.parse(right.arrivalUtc));
          const late = !!first && arrivalNow - Date.parse(first.arrivalUtc) > 300000;
          const status = late ? normalAccepted ? signedT > first.signedT ? 'compatible' : 'inconclusive' : 'incompatible' : 'pinned';
          transaction.set(ref, { ...state, attempts, status });
          return late ? 204 : 503;
        });
      } catch (error) {
        if (!(error instanceof HttpError)) { closed = true; throw unavailable(); }
        throw error;
      } finally { concurrent--; }
    },
  };
}

export function getYCloudRetryDiagnosticObserver(config: DiagnosticConfig, database: Database): DiagnosticObserver {
  const cached = processState.cached;
  if (cached && (Object.keys(config) as (keyof DiagnosticConfig)[]).some(key => config[key] !== cached.config[key])) throw unavailable();
  processState.cached ??= { config: { ...config }, observer: createObserver(config, database) };
  return processState.cached.observer;
}

export function getYCloudRetryDiagnosticConfig(): DiagnosticConfig | null {
  const enabled = process.env.PLATFORM_YCLOUD_DIAGNOSTIC_ENABLED;
  if (enabled === undefined || enabled === 'false') return null;
  if (enabled !== 'true' || ['RECEIVE', 'RETENTION', 'AI', 'SEND'].some(flag => process.env[`PLATFORM_WHATSAPP_${flag}_ENABLED`] !== 'false') || process.env.SARIN_MAINTENANCE === 'true') throw unavailable();
  const expiry = process.env.PLATFORM_YCLOUD_DIAGNOSTIC_EXPIRES_AT;
  if (!expiry || !z.iso.datetime().safeParse(expiry).success) throw unavailable();
  const parsed = configSchema.safeParse({
    runId: process.env.PLATFORM_YCLOUD_DIAGNOSTIC_RUN_ID, expiresAt: Date.parse(expiry),
    signingSecret: process.env.PLATFORM_YCLOUD_WEBHOOK_SECRET, wabaId: process.env.PLATFORM_WHATSAPP_WABA_ID,
    phoneE164: process.env.PLATFORM_WHATSAPP_PHONE_E164, sender: process.env.PLATFORM_YCLOUD_DIAGNOSTIC_SENDER,
    nonce: process.env.PLATFORM_YCLOUD_DIAGNOSTIC_NONCE,
  });
  if (!parsed.success || parsed.data.sender === parsed.data.phoneE164) throw unavailable();
  return parsed.data;
}
