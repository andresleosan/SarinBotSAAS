import { z } from 'zod';
import { isDateKey, isTimeString } from '@/lib/sarin/availability';
import { SUBSCRIPTION_PLAN_IDS } from '@/lib/billing-plans';
import { businessSocialLinksSchema } from '@/lib/business-branding';

export const documentIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const requestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
export const dateKeySchema = z.string().refine(isDateKey, 'Fecha inválida.');
export const timeSchema = z.string().refine(isTimeString, 'Hora inválida.');
const shortText = z.string().trim().min(1).max(120);
const phoneSchema = z.string().regex(/^\+?[1-9]\d{7,14}$/);
const intervalSchema = z.object({ start: timeSchema, end: timeSchema }).strict().refine((interval) => interval.start < interval.end, 'El final debe ser posterior al inicio.');
const daySchema = z.object({ isOpen: z.boolean(), intervals: z.array(intervalSchema).max(5) }).strict().superRefine((day, context) => {
  if (day.isOpen && day.intervals.length === 0) context.addIssue({ code: 'custom', message: 'Falta un horario de atención.' });
  const ordered = [...day.intervals].sort((a, b) => a.start.localeCompare(b.start));
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index].start < ordered[index - 1].end) context.addIssue({ code: 'custom', message: 'Los intervalos se superponen.' });
  }
});
export const weeklyScheduleSchema = z.object({ '0': daySchema, '1': daySchema, '2': daySchema, '3': daySchema, '4': daySchema, '5': daySchema, '6': daySchema }).strict();
export const businessConfigSchema = z.object({
  name: shortText, category: shortText,
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(70),
  phoneWhatsApp: phoneSchema,
  socialLinks: businessSocialLinksSchema.optional(),
  tone: z.string().trim().max(500).default('Cercano, claro y servicial'),
  customRules: z.string().trim().max(4000).default(''),
  intakeFields: z.array(z.object({ key: documentIdSchema, label: shortText, required: z.boolean() }).strict()).max(20),
  resources: z.array(z.object({ id: documentIdSchema, name: shortText, active: z.boolean().default(true) }).strict()).min(1).max(30),
  services: z.array(z.object({
    id: documentIdSchema, name: shortText,
    durationMinutes: z.number().int().min(5).max(720), bufferMinutes: z.number().int().min(0).max(180),
    price: z.number().finite().min(0).max(100000000), resourceIds: z.array(documentIdSchema).min(1).max(30),
  }).strict()).min(1).max(60),
  weeklySchedule: weeklyScheduleSchema,
}).strict().superRefine((business, context) => {
  for (const values of [business.resources.map((resource) => resource.id), business.services.map((service) => service.id), business.intakeFields.map((field) => field.key)]) {
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', message: 'Hay identificadores repetidos.' });
  }
  for (const service of business.services) {
    if (service.resourceIds.some((id) => !business.resources.some((resource) => resource.id === id))) context.addIssue({ code: 'custom', message: 'El servicio referencia un recurso desconocido.' });
  }
});
export type BusinessConfig = z.infer<typeof businessConfigSchema>;

export const chatSchema = z.object({
  mode: z.enum(['sarin_onboarding', 'sarin_client', 'sarin_owner_copilot']),
  tenantId: z.string().max(128), requestId: requestIdSchema,
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(12000) }).strict()).min(1).max(60),
}).strict().refine((body) => body.messages.reduce((length, message) => length + message.content.length, 0) <= 60000 && body.messages.at(-1)?.role === 'user', 'Historial inválido.');

export const availabilitySchema = z.object({ dateKey: dateKeySchema, serviceId: documentIdSchema, resourceId: documentIdSchema.optional() }).strict();
export const bookingSchema = z.object({
  dateKey: dateKeySchema, startTimeStr: timeSchema, serviceId: documentIdSchema, resourceId: documentIdSchema,
  clientPhone: phoneSchema,
  intakeAnswers: z.record(documentIdSchema, z.string().trim().max(500)).refine((answers) => Object.keys(answers).length <= 20),
}).strict();
export type BookingInput = z.infer<typeof bookingSchema>;
export const blockSchema = z.object({ dateKey: dateKeySchema, startTimeStr: timeSchema, endTimeStr: timeSchema, resourceId: documentIdSchema, requestId: requestIdSchema, motivo: z.string().max(300).optional() }).strict().refine((body) => body.endTimeStr > body.startTimeStr, 'Rango inválido.');
export const cancelSchema = z.object({ appointmentId: documentIdSchema }).strict();

// Validate bytes as well as MIME to reject arbitrary uploaded data. Client
// compression is a convenience; the server independently enforces 150 KiB.
function validReceiptData(value: string): boolean {
  const match = /^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) return false;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length < 12 || bytes.length > 150 * 1024 || bytes.toString('base64') !== match[2]) return false;
  if (match[1] === 'webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (match[1] === 'png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}
export const receiptSchema = z.object({ bankSelected: shortText, receiptDataUrl: z.string().max(210000).refine(validReceiptData), requestId: requestIdSchema,
  quotedPriceCOP: z.number().int().min(1).max(100000000).optional(),
  kind: z.enum(['subscription', 'response_pack', 'paid_trial']).default('subscription'), planId: z.enum(SUBSCRIPTION_PLAN_IDS).optional(),
}).strict().superRefine((value, context) => {
  if (value.kind !== 'subscription' && value.planId !== undefined) context.addIssue({ code: 'custom', message: 'Este comprobante no cambia el plan.' });
}).transform(value => value.kind === 'subscription' ? { ...value, planId: value.planId ?? 'monthly' as const } : value);
export const settingsSchema = z.object({
  companyName: shortText, monthlyPriceCOP: z.number().int().min(1).max(100000000),
  // Omitted by older admin clients; saveSettings preserves the current prices.
  weeklyPriceCOP: z.number().int().min(1).max(100000000).optional(),
  fortnightlyPriceCOP: z.number().int().min(1).max(100000000).optional(),
  whatsappPriceCOP: z.number().int().min(1).max(100000000).optional(),
  responsePackPriceCOP: z.number().int().min(1).max(100000000).optional(),
  graceHoursOnUpload: z.literal(24).default(24),
  bankAccounts: z.array(z.object({ id: documentIdSchema, bankName: shortText, accountType: shortText, accountNumber: shortText, holderName: shortText, holderDoc: z.string().max(120).optional() }).strict()).max(10),
  tunnelStatus: z.object({ isOnline: z.boolean(), lastPingAt: z.number() }).optional(),
}).strict();
export const adminActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['approve', 'reject']), paymentId: documentIdSchema, rejectionReason: z.string().trim().max(500).optional() }).strict(),
  z.object({ action: z.literal('settings'), settings: settingsSchema }).strict(),
]);
