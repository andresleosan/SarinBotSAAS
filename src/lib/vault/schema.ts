import { z } from 'zod';

export const MAX_IMAGE_BYTES = 150 * 1024;
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 72 * 1024 * 1024;

const id = z.string().min(1).max(128).regex(/^[\w-]+$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Fecha no válida.');

/** Only embedded raster images: never let the model or browser fetch an attachment URL. */
export const imageDataUrlSchema = z.string().max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 32).refine(value => {
  const match = /^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) return false;
  try {
    const binary = atob(match[2]);
    if (binary.length > MAX_IMAGE_BYTES || binary.length < 12) return false;
    if (match[1] === 'webp') return binary.slice(0, 4) === 'RIFF' && binary.slice(8, 12) === 'WEBP';
    if (match[1] === 'png') return binary.slice(0, 8) === '\x89PNG\r\n\x1a\n';
    return binary.charCodeAt(0) === 0xff && binary.charCodeAt(1) === 0xd8 && binary.charCodeAt(2) === 0xff;
  } catch { return false; }
}, 'Adjunta una imagen WebP, PNG o JPEG de hasta 150 KB.');

const attachment = z.object({ id, name: z.string().min(1).max(180), dataUrl: imageDataUrlSchema }).strict();
const wireAttachment = attachment.omit({ id: true });
export const financialEntrySchema = z.object({
  description: z.string().trim().min(1).max(300),
  amount: z.number().finite().nonnegative().max(10_000_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/),
  category: z.string().trim().min(1).max(80),
  date: date.nullable(),
  kind: z.enum(['expense', 'income']),
}).strict();
export const vaultReminderSchema = z.object({
  title: z.string().trim().min(1).max(180), date,
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), notes: z.string().max(2000),
}).strict();
export const vaultAnalysisSchema = z.object({
  entries: z.array(financialEntrySchema).max(100), reminders: z.array(vaultReminderSchema).max(30),
}).strict();

export const vaultChatRequestSchema = z.object({ messages: z.array(z.object({
  role: z.enum(['user', 'assistant']), content: z.string().max(16_000), attachments: z.array(wireAttachment).max(4).default([]),
}).strict()).min(1).max(24) }).strict().superRefine(({ messages }, context) => {
  if (messages.reduce((sum, message) => sum + message.attachments.length, 0) > 4) context.addIssue({ code: 'custom', message: 'Máximo cuatro imágenes por turno.' });
  if (messages.reduce((sum, message) => sum + message.content.length, 0) > 96_000) context.addIssue({ code: 'custom', message: 'El historial es demasiado largo.' });
  const last = messages.at(-1);
  if (last?.role !== 'user' || (!last.content.trim() && !last.attachments.length)) context.addIssue({ code: 'custom', message: 'Escribe un mensaje o adjunta una factura.' });
  if (messages.some(message => message.role === 'assistant' && message.attachments.length)) context.addIssue({ code: 'custom', message: 'Los adjuntos corresponden al usuario.' });
});

export const vaultThreadSchema = z.object({
  id, title: z.string().trim().min(1).max(120),
  createdAt: z.number().int().nonnegative().max(8_640_000_000_000_000),
  updatedAt: z.number().int().nonnegative().max(8_640_000_000_000_000),
  messages: z.array(z.object({ id, role: z.enum(['user', 'assistant']), content: z.string().max(32_000), createdAt: z.number().int().nonnegative(), attachments: z.array(attachment).max(4) }).strict()).max(1000),
  entries: z.array(financialEntrySchema.extend({ id })).max(2000),
  reminders: z.array(vaultReminderSchema.extend({ id })).max(1000),
}).strict().superRefine((thread, context) => {
  if (thread.updatedAt < thread.createdAt) context.addIssue({ code: 'custom', message: 'Fechas del hilo no válidas.' });
  for (const records of [thread.messages, thread.entries, thread.reminders]) {
    if (new Set(records.map(record => record.id)).size !== records.length) context.addIssue({ code: 'custom', message: 'Hay identificadores repetidos.' });
  }
});
export const vaultBackupSchema = z.object({
  format: z.literal('sarin-vault'), version: z.literal(1), exportedAt: z.iso.datetime(), threads: z.array(vaultThreadSchema).max(200),
}).strict().superRefine((backup, context) => {
  if (new Set(backup.threads.map(thread => thread.id)).size !== backup.threads.length) context.addIssue({ code: 'custom', message: 'Hay hilos repetidos.' });
});
