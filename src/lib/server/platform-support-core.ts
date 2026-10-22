import 'server-only';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getAdminAuth } from '@/lib/firebase/admin';
import type { Database, Transaction } from '@/lib/storage/types';
import type { SupportActor } from '@/types/platform-support';
import { isSupportRecord, type SupportAnchor, type SupportRecord } from '../../../shared/platform-support-records';
import { workUuid } from '../../../shared/platform-whatsapp-work';
import { readVerifiedConsentAnchor } from './consent';
import { isSuperadmin } from './auth';
import { HttpError } from './http';
export const supportUnavailable = () => new HttpError(503, 'Soporte temporalmente no disponible.', 'SUPPORT_UNAVAILABLE');
export const supportDenied = () => new HttpError(403, 'No tienes acceso a esta consulta.', 'SUPPORT_DENIED');
export const supportRequired = () => new HttpError(428, 'Revisa los permisos vigentes de cuenta y soporte.', 'CONSENT_REQUIRED');
export const supportConflict = () => new HttpError(409, 'La consulta cambió. Revisa su estado.', 'SUPPORT_CONFLICT');
export function supportUuid(v: string) { if (!workUuid(v)) throw new HttpError(400, 'Identificador no válido.'); }
export function supportNow() { const n = Date.now(); if (!Number.isSafeInteger(n) || n < 0 || n > 8_640_000_000_000_000 - 2_592_000_000) throw supportUnavailable(); return n; }
export async function currentSupportUser(actor: SupportActor) {
  if (!actor || typeof actor.uid !== 'string' || !actor.uid.length || actor.uid.length > 128 || !['customer', 'admin'].includes(actor.role)) throw supportDenied();
  if (actor.role === 'admin' && !isSuperadmin(actor.uid)) throw supportDenied();
  let u;
  try { u = await getAdminAuth().getUser(actor.uid); } catch (e) { if (e && typeof e === 'object' && 'code' in e && e.code === 'auth/user-not-found') throw new HttpError(401, 'Vuelve a iniciar sesión.'); throw supportUnavailable(); }
  if (!u || u.uid !== actor.uid || u.disabled !== false || u.tokensValidAfterTime !== undefined && !Number.isFinite(Date.parse(u.tokensValidAfterTime))) throw new HttpError(401, 'Vuelve a iniciar sesión.');
  return { cutoff: u.tokensValidAfterTime ?? null };
}
export async function currentSupportToken(token: DecodedIdToken, role: SupportActor['role']) {
  const user = await currentSupportUser({ uid: token.uid, role });
  if (!Number.isSafeInteger(token.auth_time) || token.auth_time < 0 || token.auth_time * 1000 > supportNow() || user.cutoff !== null && token.auth_time * 1000 < Date.parse(user.cutoff)) throw new HttpError(401, 'Vuelve a iniciar sesión.');
}
export async function repeatSupportUser(actor: SupportActor, prepared: Awaited<ReturnType<typeof currentSupportUser>>) {
  const current = await currentSupportUser(actor); if (current.cutoff !== prepared.cutoff) throw new HttpError(401, 'Vuelve a iniciar sesión.');
}
export async function supportPermissions(uid: string, tx: Transaction, db: Database) {
  const [a, s] = await Promise.all([readVerifiedConsentAnchor(uid, 'account', undefined, db, tx), readVerifiedConsentAnchor(uid, 'platform_support', undefined, db, tx)]);
  if (!a.active || !s.active || !a.receiptId || !s.receiptId) throw supportRequired();
  return { account: { revision: a.revision, fingerprint: a.fingerprint, receiptId: a.receiptId }, support: { revision: s.revision, fingerprint: s.fingerprint, receiptId: s.receiptId } };
}
export const sameSupportAnchor = (a: SupportAnchor, b: SupportAnchor) => a.revision === b.revision && a.fingerprint === b.fingerprint && a.receiptId === b.receiptId;
export const sameSupportPermissions = (a: { account: SupportAnchor; support: SupportAnchor }, b: { account: SupportAnchor; support: SupportAnchor }) => sameSupportAnchor(a.account, b.account) && sameSupportAnchor(a.support, b.support);
export const supportRef = (db: Database, path: string) => { const [root, id] = path.split('/'); return db.collection(root).doc(id); };
export async function readSupportRecord(tx: Transaction, db: Database, path: string): Promise<SupportRecord | null> { const v = (await tx.get(supportRef(db, path))).data(); if (v === undefined) return null; if (!isSupportRecord(path, v)) throw supportUnavailable(); return v; }
export function stageSupportRecord(tx: Transaction, db: Database, path: string, value: SupportRecord) { if (!isSupportRecord(path, value)) throw supportUnavailable(); tx.set(supportRef(db, path), value); }
export function supportCrypto() {
  const encoded = process.env.PLATFORM_SUPPORT_KEY ?? '', key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) throw supportUnavailable();
  const derive = (purpose: string) => createHmac('sha256', key).update(JSON.stringify(['sarin/platform-support', 1, purpose])).digest();
  const digest = (purpose: string, value: unknown) => createHmac('sha256', derive(purpose)).update(JSON.stringify(value)).digest('hex');
  const aad = (path: string) => Buffer.from(JSON.stringify(['sarin/platform-support', 1, 'body', path]));
  return { digest,
    encrypt(text: string, path: string) { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', derive('body'), iv); c.setAAD(aad(path)); const data = Buffer.concat([c.update(JSON.stringify({ text }), 'utf8'), c.final()]); return { version: 1 as const, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }; },
    decrypt(content: { iv: string; tag: string; data: string }, path: string): string { try { const d = createDecipheriv('aes-256-gcm', derive('body'), Buffer.from(content.iv, 'base64')); d.setAAD(aad(path)); d.setAuthTag(Buffer.from(content.tag, 'base64')); const v = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat([d.update(Buffer.from(content.data, 'base64')), d.final()]))); if (!v || Object.keys(v).join() !== 'text' || typeof v.text !== 'string') throw supportUnavailable(); return v.text; } catch { throw supportUnavailable(); } },
    sign(value: unknown) { const data = Buffer.from(JSON.stringify(value)).toString('base64url'); return data + '.' + createHmac('sha256', derive('cursor')).update(data).digest('base64url'); },
    parse(value: string): Record<string, unknown> { const invalid = () => new HttpError(400, 'La continuación expiró o no es válida.', 'SUPPORT_CURSOR_INVALID'); try { if (value.length > 2048) throw invalid(); const [data, mac, extra] = value.split('.'); if (!data || !mac || extra !== undefined) throw invalid(); const bytes = Buffer.from(data, 'base64url'), actual = Buffer.from(mac, 'base64url'), expected = createHmac('sha256', derive('cursor')).update(data).digest(); if (bytes.toString('base64url') !== data || actual.toString('base64url') !== mac || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid(); const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); if (!result || Array.isArray(result) || typeof result !== 'object' || JSON.stringify(result) !== bytes.toString('utf8')) throw invalid(); return result; } catch { throw invalid(); } },
  };
}
export async function supportMarker(tx: Transaction, db: Database, crypto: ReturnType<typeof supportCrypto>, allowCreate = false) {
  const path = 'platformSupportConversations/key_marker', marker = await readSupportRecord(tx, db, path), fingerprint = crypto.digest('key-marker', []);
  if (marker) { if (marker.recordType !== 'key_marker' || marker.fingerprint !== fingerprint) throw supportUnavailable(); return () => {}; }
  if (!allowCreate || !(await tx.get(db.collection('platformSupportConversations').limit(1))).empty || !(await tx.get(db.collection('platformSupportMessages').limit(1))).empty) throw supportUnavailable();
  return () => stageSupportRecord(tx, db, path, { version: 1, recordType: 'key_marker', fingerprint });
}
