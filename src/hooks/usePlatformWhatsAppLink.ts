"use client";
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { apiFetch, ApiError, errorMessage } from '@/lib/client/api';
import { useApiPoll } from '@/lib/client/use-api-poll';
import { reauthenticatePlatformWhatsAppOwner } from '@/lib/client/platform-whatsapp-reauth';
import type { ConsentController } from '@/hooks/useConsent';
import type { PlatformWhatsAppLinkStatus, PlatformWhatsAppLinkBegin, PlatformWhatsAppLinkConfirmation } from '@/types/platform-whatsapp-link';

const endpoint = '/api/platform-whatsapp/link';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, names: string[]) => Object.keys(value).every(key => names.includes(key));
export function safeWhatsAppLinkDestination(value: unknown): string | null {
  return typeof value === 'string' && /^https:\/\/wa\.me\/[1-9][0-9]{6,14}$/.test(value) ? value : null;
}
function statusResult(value: unknown): PlatformWhatsAppLinkStatus {
  const link = (item: unknown, pending: boolean) => item === null || object(item) && keys(item, pending ? ['challengeId', 'revision', 'expiresAt', 'maskedPhone', 'proof'] : ['linkId', 'revision', 'expiresAt', 'maskedPhone']) && typeof item[pending ? 'challengeId' : 'linkId'] === 'string' && uuid.test(item[pending ? 'challengeId' : 'linkId'] as string) && integer(item.revision) && integer(item.expiresAt) && typeof item.maskedPhone === 'string' && /^••••[0-9]{4}$/.test(item.maskedPhone) && (!pending || item.proof === 'pending' || item.proof === 'verified');
  if (!object(value) || !keys(value, ['available', 'revokeGeneration', 'current', 'pending']) || typeof value.available !== 'boolean' || !(value.revokeGeneration === null || typeof value.revokeGeneration === 'string' && uuid.test(value.revokeGeneration)) || !link(value.current, false) || !link(value.pending, true)) throw new Error('No se pudo comprobar la vinculación.');
  return value as unknown as PlatformWhatsAppLinkStatus;
}
function beginResult(value: unknown): PlatformWhatsAppLinkBegin {
  if (!object(value) || !keys(value, ['challengeId', 'code', 'expiresAt', 'whatsappUrl']) || typeof value.challengeId !== 'string' || !uuid.test(value.challengeId) || !integer(value.expiresAt) || typeof value.code !== 'string' || !new RegExp('^sarinbot\\.link\\.v1:' + value.challengeId + ':[A-Za-z0-9_-]{43}:[A-Za-z0-9_-]{43}$').test(value.code)) throw new Error('No se pudo comprobar el código recibido. Consulta el estado antes de reintentar.');
  return { challengeId: value.challengeId, code: value.code, expiresAt: value.expiresAt, ...(safeWhatsAppLinkDestination(value.whatsappUrl) ? { whatsappUrl: value.whatsappUrl as string } : {}) };
}
function confirmationResult(value: unknown): PlatformWhatsAppLinkConfirmation {
  if (!object(value) || !keys(value, ['linkId', 'revision', 'expiresAt']) || typeof value.linkId !== 'string' || !uuid.test(value.linkId) || !integer(value.revision) || !integer(value.expiresAt)) throw new Error('No se pudo comprobar la confirmación. Consulta el estado.');
  return value as unknown as PlatformWhatsAppLinkConfirmation;
}
const consentKey = (value: ConsentController) => [value.active, value.status?.revision, value.status?.documents.fingerprint, value.withdrawalRequested, value.error, value.loading];
type Operation = Readonly<{ action: 'begin' | 'confirm' | 'revoke'; body: string; target: string | null; grant: object; scope: object; read: number }>;
type Notice = { message: string; recent?: boolean; retryAt?: number };

export function usePlatformWhatsAppLink(account: ConsentController, support: ConsentController) {
  const auth = useAuth(), uid = auth.user?.uid, epoch = auth.authEpoch;
  const scopeKey = uid && !auth.signingOut ? JSON.stringify([uid, epoch]) : null;
  const scopeRef = useRef({ key: scopeKey });
  if (scopeRef.current.key !== scopeKey) scopeRef.current = { key: scopeKey };
  const scope = scopeRef.current;
  const grantKey = JSON.stringify([scopeKey, consentKey(account), consentKey(support)]);
  const grantRef = useRef({ key: grantKey });
  if (grantRef.current.key !== grantKey) grantRef.current = { key: grantKey };
  const grant = grantRef.current;
  const permission = account.active && support.active;
  const anchors = JSON.stringify([scopeKey, account.status?.revision, account.status?.documents.fingerprint, support.status?.revision, support.status?.documents.fingerprint]);
  const [blockedAnchors, setBlockedAnchors] = useState<string | null>(null);
  const allowed = useRef(permission); allowed.current = permission;
  const [lost, setLost] = useState<object | null>(null);
  const lostRef = useRef<object | null>(null);
  const alive = () => !!uid && scopeRef.current === scope && lostRef.current !== scope && auth.isCurrentSession(uid, epoch);
  const request = useRef<AbortController | null>(null);
  const operation = useRef<Operation | null>(null);
  const retrySlot = useRef<Operation | null>(null);
  const readVersion = useRef(0), writeVersion = useRef(0), reads = useRef(0);
  const latest = useRef<PlatformWhatsAppLinkStatus | null>(null);
  const [activity, setActivity] = useState<{ scope: object; busy: boolean; notice: Notice | null; retry: Operation | null } | null>(null);
  const [secret, setSecret] = useState<{ scope: object; grant: object; data: PlatformWhatsAppLinkBegin; read: number; revision: number | null } | null>(null);
  const secretRef = useRef(secret); secretRef.current = secret;
  const [clock, setClock] = useState(Date.now());
  const now = Math.max(clock, Date.now());
  const [copied, setCopied] = useState<object | null>(null);
  function loseAccess() {
    if (!alive()) return;
    lostRef.current = scope; request.current?.abort(); operation.current = null; retrySlot.current = null; writeVersion.current++; readVersion.current++;
    setLost(scope); setSecret(null); setActivity(null);
    auth.invalidateSession(uid!, epoch);
  }
  const poll = useApiPoll<PlatformWhatsAppLinkStatus>(alive() && lost !== scope ? scopeKey : null, async signal => {
    const version = ++readVersion.current, writes = writeVersion.current;
    const current = () => alive() && !signal.aborted && version === readVersion.current && writes === writeVersion.current;
    try {
      const value = await apiFetch<unknown>(endpoint, { signal }, uid, current);
      if (!current()) throw new Error('Lectura obsoleta.');
      const result = statusResult(value); reads.current++;
      setClock(Date.now());
      latest.current = result;
      return result;
    } catch (cause) {
      if (current() && cause instanceof ApiError && [401, 403].includes(cause.status)) loseAccess();
      throw cause;
    }
  });
  const status = poll.value;
  const renderedStatus = useRef(status);
  if (renderedStatus.current !== status) { renderedStatus.current = status; latest.current = status; }
  const pendingKey = status?.pending ? JSON.stringify([status.pending.challengeId, status.pending.revision, status.pending.expiresAt, status.pending.proof]) : null;
  // A code is never reconstructed by GET; a changed challenge retires its transient secret.
  let liveSecret = secret?.scope === scope && secret.grant === grant ? secret : null;
  if (liveSecret && reads.current > liveSecret.read) {
    if (status?.pending?.challengeId !== liveSecret.data.challengeId || liveSecret.revision !== null && status.pending.revision !== liveSecret.revision) liveSecret = null;
  }
  if (liveSecret && now >= liveSecret.data.expiresAt) liveSecret = null;
  useEffect(() => {
    if (secret && !liveSecret) setSecret(null);
    else if (secret && reads.current > secret.read && secret.revision === null && status?.pending?.challengeId === secret.data.challengeId) {
      setSecret(value => value === secret ? { ...secret, revision: status.pending!.revision } : value);
    }
  }, [secret, liveSecret, status]);
  const ownActivity = activity?.scope === scope ? activity : null;
  let retry = ownActivity?.retry ?? null;
  if (retry && (retry.scope !== scope || retry.action !== 'revoke' && retry.grant !== grant || retry.action === 'confirm' && (retry.target !== pendingKey || !status?.pending || now >= status.pending.expiresAt))) retry = null;
  const active = alive();
  const canGrant = active && permission && blockedAnchors !== anchors && status?.available === true;
  const busy = ownActivity?.busy ?? false;
  const notice = ownActivity?.notice ?? null;
  const canRetry = !!retry && active && !busy && (!notice?.retryAt || now >= notice.retryAt) && (retry.action === 'revoke' || canGrant);
  useEffect(() => () => { request.current?.abort(); operation.current = null; retrySlot.current = null; readVersion.current++; writeVersion.current++; }, [scope]);
  useEffect(() => {
    if (retrySlot.current?.action === 'confirm' && (retrySlot.current.target !== pendingKey || !status?.pending || Date.now() >= status.pending.expiresAt)) {
      request.current?.abort(); request.current = null; operation.current = null; retrySlot.current = null;
      setActivity(value => value?.scope === scope ? { ...value, busy: false, retry: null, notice: { message: 'La solicitud cambió. Revisa el número comprobado antes de confirmar.' } } : value);
    }
  }, [pendingKey, scope, clock, status]);
  useEffect(() => {
    if (retrySlot.current && retrySlot.current.action !== 'revoke' && retrySlot.current.grant !== grant) retrySlot.current = null;
    if (operation.current && operation.current.action !== 'revoke' && operation.current.grant !== grant) {
      request.current?.abort(); request.current = null; operation.current = null;
      setActivity(value => value?.scope === scope ? { ...value, busy: false, retry: null, notice: null } : value);
    }
    if (secretRef.current?.grant !== grant) setSecret(null);
  }, [grant, scope]);
  useEffect(() => {
    const expiry = Math.min(...[secret?.data.expiresAt, status?.pending?.expiresAt, status?.current?.expiresAt, notice?.retryAt].filter((value): value is number => typeof value === 'number' && value > Date.now()));
    if (!Number.isFinite(expiry)) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.min(2_147_483_647, expiry - Date.now()));
    return () => clearTimeout(timer);
  }, [secret, status, notice, clock]);
  useEffect(() => {
    if (status && status.revokeGeneration === null && ownActivity?.retry?.action === 'revoke' && !busy) {
      retrySlot.current = null;
      setActivity({ scope, busy: false, notice: { message: 'El estado actual no muestra un vínculo ni una solicitud pendiente. No se envió otra revocación.' }, retry: null });
    }
  }, [status, ownActivity, scope, busy]);
  function targetIsCurrent(op: Operation) {
    if (!alive() || operation.current !== op || op.scope !== scope) return false;
    if (op.action === 'revoke') return true;
    return grantRef.current === op.grant && allowed.current && (op.action !== 'confirm' || op.target === (latest.current?.pending ? JSON.stringify([latest.current.pending.challengeId, latest.current.pending.revision, latest.current.pending.expiresAt, latest.current.pending.proof]) : null) && Date.now() < latest.current!.pending!.expiresAt);
  }
  async function run(op: Operation) {
    if (!alive() || request.current || op.scope !== scope || op.action !== 'revoke' && (!canGrant || grantRef.current !== op.grant) || op.action === 'confirm' && op.target !== pendingKey) return;
    operation.current = op;
    retrySlot.current = op;
    const abort = request.current = new AbortController();
    writeVersion.current++; readVersion.current++; poll.setValue(value => value);
    setActivity({ scope, busy: true, notice: null, retry: op });
    const current = () => !abort.signal.aborted && targetIsCurrent(op);
    try {
      const value = await apiFetch<unknown>(endpoint, { method: op.action === 'revoke' ? 'DELETE' : 'POST', body: op.body, signal: abort.signal }, uid, current);
      if (!current()) return;
      if (op.action === 'begin') {
        const result = beginResult(value);
        const receivedAt = Date.now();
        setClock(receivedAt);
        if (receivedAt >= result.expiresAt) {
          setSecret(null); retrySlot.current = null;
          setActivity({ scope, busy: false, notice: { message: 'El código recibido ya venció. Crea otro código para continuar.' }, retry: null });
          poll.refresh();
          return;
        }
        if (reads.current > op.read && latest.current?.pending?.challengeId !== result.challengeId) {
          retrySlot.current = null;
          setActivity({ scope, busy: false, notice: { message: 'La solicitud cambió. No se muestra un código anterior al estado actual.' }, retry: null });
          return;
        }
        setSecret({ scope, grant, data: result, read: reads.current, revision: null });
      } else if (op.action === 'confirm') {
        const result = confirmationResult(value), pending = latest.current!.pending!;
        setSecret(null);
        poll.setValue(previous => previous && { ...previous, pending: null, current: { ...result, maskedPhone: pending.maskedPhone } });
      } else {
        if (!object(value) || value.revoked !== true || !keys(value, ['revoked'])) throw new Error('No se pudo comprobar la revocación. Consulta el estado.');
        if (latest.current?.revokeGeneration === op.target) { setSecret(null); poll.setValue(previous => previous && { ...previous, current: null, pending: null, revokeGeneration: null }); }
      }
      retrySlot.current = null;
      setActivity({ scope, busy: false, notice: { message: op.action === 'begin' ? 'Código creado. Envíalo manualmente y vuelve para confirmar en esta web.' : op.action === 'confirm' ? 'Vinculación confirmada. Consulta abajo el estado actual.' : 'Solicitud de revocación confirmada. Consulta el estado actual.' }, retry: null });
      poll.refresh();
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ApiError && [401, 403].includes(cause.status)) { loseAccess(); return; }
      let message = 'No sabemos si la operación se completó. Consulta el estado; solo tú puedes reintentar esta misma solicitud.';
      let keep = true, recent = false;
      if (cause instanceof ApiError) {
        if (cause.status === 428 && cause.code === 'LINK_RECENT_AUTH_REQUIRED') { message = 'Vuelve a verificar tu identidad con Google. Después, reintenta explícitamente la misma solicitud.'; recent = true; }
        else if (cause.status === 428 && cause.code === 'CONSENT_REQUIRED') { message = 'Revisa tus permisos de cuenta y soporte antes de continuar.'; keep = false; setBlockedAnchors(anchors); account.refresh(); support.refresh(); grantRef.current = { key: '' }; setSecret(null); }
        else if (cause.status === 409) { message = cause.code === 'CHALLENGE_CODE_UNAVAILABLE' ? 'El código de esa solicitud ya no se puede recuperar. Crear otro código requiere una nueva acción y consume otra emisión.' : 'La vinculación cambió. Revisa el estado antes de iniciar otra acción.'; keep = false; poll.refresh(); if (op.action !== 'revoke') setSecret(null); }
        else if (cause.status >= 400 && cause.status < 500 && cause.status !== 429) { message = errorMessage(cause); keep = false; }
      }
      if (!keep) retrySlot.current = null;
      setActivity({ scope, busy: false, notice: { message, recent, ...(cause instanceof ApiError && cause.retryAfterSeconds ? { retryAt: Date.now() + cause.retryAfterSeconds * 1000 } : {}) }, retry: keep ? op : null });
    } finally {
      if (request.current === abort) { request.current = null; operation.current = null; }
      if (alive()) setActivity(value => value?.scope === scope ? { ...value, busy: false } : value);
    }
  }
  function begin(phoneE164: string) {
    if (!canGrant || busy || retrySlot.current || !/^\+[1-9][0-9]{6,14}$/.test(phoneE164)) return;
    const op = Object.freeze({ action: 'begin' as const, body: JSON.stringify({ action: 'begin', phoneE164, requestId: crypto.randomUUID() }), target: null, scope, grant, read: reads.current });
    void run(op);
  }
  function confirm() {
    const pending = status?.pending;
    if (!canGrant || busy || retrySlot.current || pending?.proof !== 'verified' || Date.now() >= pending.expiresAt) return;
    void run(Object.freeze({ action: 'confirm', body: JSON.stringify({ action: 'confirm', challengeId: pending.challengeId, requestId: crypto.randomUUID(), confirmed: true }), target: pendingKey, scope, grant, read: reads.current }));
  }
  function revoke() {
    const generation = status?.revokeGeneration;
    if (!active || busy || retrySlot.current || !generation || latest.current?.revokeGeneration !== generation) return;
    void run(Object.freeze({ action: 'revoke', body: JSON.stringify({ requestId: 'revoke_v1_' + generation + '_' + crypto.randomUUID() }), target: generation, scope, grant, read: reads.current }));
  }
  async function reauthenticate() {
    const op = retry;
    if (!op || !notice?.recent || request.current || !alive()) return;
    operation.current = op;
    const abort = request.current = new AbortController();
    setActivity({ scope, busy: true, notice, retry: op });
    try {
      await reauthenticatePlatformWhatsAppOwner(uid!, epoch, (expectedUid, expectedEpoch) => auth.isCurrentSession(expectedUid, expectedEpoch) && targetIsCurrent(op));
      if (!alive() || !targetIsCurrent(op) || abort.signal.aborted) return;
      setActivity({ scope, busy: false, notice: { ...notice, recent: false, message: 'Identidad verificada. Pulsa Reintentar la misma solicitud para continuar.' }, retry: op });
    } catch (cause) {
      if (alive() && targetIsCurrent(op) && !abort.signal.aborted) setActivity({ scope, busy: false, notice: { ...notice, message: errorMessage(cause), recent: true }, retry: op });
    } finally {
      if (request.current === abort) { request.current = null; operation.current = null; }
      if (alive()) setActivity(value => value?.scope === scope ? { ...value, busy: false } : value);
    }
  }
  async function copy() {
    const value = liveSecret;
    if (!value || !alive()) return;
    const copiedAt = Date.now();
    if (copiedAt >= value.data.expiresAt) { setClock(copiedAt); setSecret(null); return; }
    try {
      await navigator.clipboard.writeText(value.data.code);
      if (alive() && grantRef.current === grant && secretRef.current === value && Date.now() < value.data.expiresAt) setCopied(value);
    } catch {
      if (alive() && grantRef.current === grant && secretRef.current === value) setActivity({ scope, busy: false, notice: { message: 'No se pudo copiar. Selecciona el comando y cópialo manualmente.' }, retry });
    }
  }
  return { status: active ? status : null, loading: poll.loading, error: active ? poll.error : null, active, canGrant, busy, notice, retry, canRetry, code: active ? liveSecret?.data ?? null : null, copied: copied === liveSecret, clock: now, begin, confirm, revoke, reauthenticate, copy, retryOperation: () => { if (canRetry && retry) void run(retry); }, refresh: () => { if (alive()) poll.refresh(); } };
}

