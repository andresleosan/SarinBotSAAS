/** Strict, shared controls. No receipt snapshots or image content belong here. */
export const PAYMENT_VALID_MS = 300_000;
export const PAYMENT_RETENTION_MS = 2_592_000_000;
export const PAYMENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
const digest = /^[a-f0-9]{64}(?![\s\S])/;
export type PaymentEnvelope = { version: 1; iv: string; tag: string; data: string };
export type PaymentControl = {
  version: 1; recordType: 'proposal'; id: string; actorUid: string; paymentId: string;
  action: 'approve' | 'reject'; contextFingerprint: string; revision: 1;
  createdAt: number; validUntil: number; bodyExpiresAt: number; expiresAt: number;
  state: 'pending' | 'executed' | 'expired' | 'cancelled'; reasonDigest: string; reason: PaymentEnvelope | null;
  executedAt: number | null; confirmDigest: string | null; effectId: string | null;
};
export type PaymentRequestControl = { version: 1; recordType: 'request'; requestDigest: string; inputDigest: string; proposalId: string; createdAt: number; expiresAt: number };
export type PaymentKeyMarker = { version: 1; recordType: 'key_marker'; keyDigest: string };
export type AdminPaymentRecord = PaymentControl | PaymentRequestControl | PaymentKeyMarker;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const time = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 8_640_000_000_000_000;
const hash = (v: unknown): v is string => typeof v === 'string' && digest.test(v);
function envelope(v: unknown): v is PaymentEnvelope {
  if (!obj(v) || !exact(v, ['version', 'iv', 'tag', 'data']) || v.version !== 1) return false;
  const base64 = (s: unknown, size?: number) => { try { return typeof s === 'string' && s.length > 0 && s.length <= 4096 && btoa(atob(s)) === s && (size === undefined || atob(s).length === size); } catch { return false; } };
  return base64(v.iv, 12) && base64(v.tag, 16) && base64(v.data);
}
export function isAdminPaymentRecord(path: string, v: unknown): v is AdminPaymentRecord {
  if (!obj(v) || v.version !== 1) return false;
  if (v.recordType === 'key_marker') return path === 'adminPaymentActions/key_marker' && exact(v, ['version', 'recordType', 'keyDigest']) && hash(v.keyDigest);
  if (!time(v.createdAt) || v.expiresAt !== v.createdAt + PAYMENT_RETENTION_MS) return false;
  if (v.recordType === 'request') return exact(v, ['version', 'recordType', 'requestDigest', 'inputDigest', 'proposalId', 'createdAt', 'expiresAt']) && hash(v.requestDigest) && hash(v.inputDigest) && typeof v.proposalId === 'string' && PAYMENT_UUID.test(v.proposalId) && path === 'adminPaymentActions/request_' + v.requestDigest;
  if (v.recordType !== 'proposal' || !exact(v, ['version', 'recordType', 'id', 'actorUid', 'paymentId', 'action', 'contextFingerprint', 'revision', 'createdAt', 'validUntil', 'bodyExpiresAt', 'expiresAt', 'state', 'reasonDigest', 'reason', 'executedAt', 'confirmDigest', 'effectId'])) return false;
  if (typeof v.id !== 'string' || !PAYMENT_UUID.test(v.id) || path !== 'adminPaymentActions/' + v.id || typeof v.actorUid !== 'string' || !v.actorUid || v.actorUid.length > 128 || typeof v.paymentId !== 'string' || !/^[A-Za-z0-9_-]{1,128}(?![\s\S])/.test(v.paymentId) || !['approve', 'reject'].includes(String(v.action)) || !hash(v.contextFingerprint) || !hash(v.reasonDigest) || v.revision !== 1 || v.validUntil !== v.createdAt + PAYMENT_VALID_MS || v.bodyExpiresAt !== v.validUntil) return false;
  if (v.state === 'pending') return (v.action === 'reject' ? envelope(v.reason) : v.reason === null) && v.executedAt === null && v.confirmDigest === null && v.effectId === null;
  if (v.reason !== null) return false;
  if (v.state === 'executed') return time(v.executedAt) && v.executedAt >= v.createdAt && v.executedAt < Number(v.validUntil) && hash(v.confirmDigest) && v.effectId === v.paymentId;
  return ['expired', 'cancelled'].includes(String(v.state)) && v.executedAt === null && v.confirmDigest === null && v.effectId === null;
}
