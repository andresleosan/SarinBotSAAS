"use client";
import { useEffect, useReducer, useRef } from 'react';
import { useAuth } from '@/components/auth-provider';
import { apiFetch, errorMessage } from '@/lib/client/api';
import { ownerApiFetch, type OwnerRequestScope } from '@/lib/client/owner-request-scope';
import { ownerBusinessTeamViewSchema, teamMembershipPageSchema, teamAgendaViewSchema, teamMutationResultSchema, teamSelfRequestCommandSchema, teamOwnerDecisionCommandSchema, teamLeaveCommandSchema, teamAccessCommandCanonicalString, teamBusinessSlugSchema, teamDocumentIdSchema, type TeamApplied, type TeamAccessCanonicalCommand, type TeamSelfRequestCommand, type TeamLeaveCommand, type TeamOwnerDecisionCommand, type TeamMutationResult, type OwnerBusinessTeamView, type TeamMembershipPage, type TeamAgendaView } from '@/lib/business-team';

type Input = { uid: string; authEpoch: number; businessId?: string; enabled: boolean; audience: 'owner'|'member'; requestScope?: OwnerRequestScope };
type Pending = { command: TeamAccessCanonicalCommand; membershipId: string | null; memberUid?: string; path: string; method: string; body: string; slug?: string; hash?: string; eventId?: string; running: boolean; proven: boolean };
type RecordState = { key: string; live: boolean; denied: boolean; view: OwnerBusinessTeamView|null; page: TeamMembershipPage|null; agenda: TeamAgendaView|null; loading: boolean; error: string|null; notice: string|null; applied: TeamApplied|null; current: TeamMutationResult['current']|null; proofMembershipId: string|null; currentTeamRevision: number; pending: Pending|null; read: { cancel: () => void }|null; generation: number; viewGeneration: number; date: string; slug: string|null };
export const teamToday = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
const sha256 = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(byte => byte.toString(16).padStart(2, '0')).join('');

/** One in-memory command envelope per identity. Read generations never own this envelope. */
export function useTeamClient(input: Input) {
  const auth = useAuth(), latest = useRef({ input, auth }); latest.current = { input, auth };
  const key = JSON.stringify([input.uid, input.authEpoch, input.businessId, input.audience]);
  const state = useRef<RecordState|null>(null), [, render] = useReducer(value => value + 1, 0);
  if (!state.current || state.current.key !== key) state.current = { key, live: true, denied: false, view: null, page: null, agenda: null, loading: false, error: null, notice: null, applied: null, current: null, proofMembershipId: null, currentTeamRevision: 0, pending: null, read: null, generation: 0, viewGeneration: -1, date: teamToday(), slug: null };
  const record = state.current;
  const current = () => state.current === record && record.live && !record.denied && latest.current.input.enabled
    && latest.current.auth.user?.uid === input.uid && latest.current.auth.authEpoch === input.authEpoch
    && latest.current.auth.isCurrentSession(input.uid, input.authEpoch) && (!input.requestScope || input.requestScope.isCurrent());
  const readable = () => current() && (!input.requestScope || input.requestScope.canRead());
  const actionable = () => current() && (!input.requestScope || input.requestScope.canStartAction());
  function update() { if (state.current === record && record.live) render(); }
  function cancelRead() { const active = record.read; record.read = null; record.generation++; active?.cancel(); record.loading = false; }
  function purge() { cancelRead(); record.view = null; record.page = null; record.agenda = null; record.pending = null; record.applied = null; record.current = null; record.slug = null; }
  function deny(status: number) {
    if (!current() || (status !== 401 && status !== 403)) return;
    record.denied = true; purge(); record.error = 'No se pudo verificar tu acceso. Vuelve a entrar y revisa tu cuenta.';
    if (status === 401) latest.current.auth.invalidateSession(input.uid, input.authEpoch);
    update();
  }
  const fetcher = (kind: 'read'|'write', path: string, init: RequestInit, owns: () => boolean) => input.requestScope
    ? ownerApiFetch<unknown>(input.requestScope, kind, path, init, owns)
    : apiFetch<unknown>(path, init, input.uid, owns, deny);
  const ownerPath = `/api/businesses/${encodeURIComponent(input.businessId ?? '')}/team`;

  function verifyApplied(value: TeamApplied, pending: Pending) {
    const command = pending.command;
    if (!pending.hash || !pending.eventId || value.requestId !== command.requestId || value.commandHash !== pending.hash || value.eventId !== pending.eventId
      || value.membershipRevision !== command.expectedMembershipRevision + 1
      || command.expectedTeamRevision !== null && value.teamRevision !== command.expectedTeamRevision + 1) throw Error('No pudimos verificar la constancia de esta operación. Conservamos la misma petición.');
  }
  function acceptProof(value: TeamApplied, pending: Pending, membership: TeamMutationResult['current']|null, teamRevision: number) {
    verifyApplied(value, pending);
    record.applied = value;
    record.proofMembershipId = pending.membershipId ?? membership?.membershipId ?? null;
    // A late response carries a current snapshot from its own read time. Never replace a newer observation with it.
    if (teamRevision >= record.currentTeamRevision && (!record.current || !membership || membership.revision >= record.current.revision)) {
      if (!pending.proven || record.current !== null || membership === null) record.current = membership;
      record.currentTeamRevision = teamRevision;
    }
    pending.proven = true;
    record.notice = 'Constancia aplicada verificada. El estado actual se muestra por separado; una aprobación anterior no reactiva el acceso.';
    if (!pending.running && record.pending === pending) record.pending = null;
  }
  async function read(path: string, accept: (raw: unknown) => Promise<void>|void, clear: () => void) {
    if (!readable()) return;
    cancelRead(); clear(); const generation = record.generation, authorityGeneration = input.requestScope?.readGeneration;
    const abort = new AbortController(); let reject!: (error: Error) => void, finished = false;
    const interrupted = new Promise<never>((_, no) => { reject = no; });
    const active = { cancel: () => { abort.abort(); reject(Error('La consulta superó 10 segundos. Inténtalo de nuevo.')); } };
    record.read = active; record.loading = true; record.error = null; update();
    const owns = () => !finished && readable() && record.read === active && record.generation === generation && input.requestScope?.readGeneration === authorityGeneration;
    const timer = setTimeout(active.cancel, 10000);
    try {
      const raw = await Promise.race([fetcher('read', path, { signal: abort.signal }, owns), interrupted]);
      if (!owns() || abort.signal.aborted) return;
      await accept(raw);
    } catch (error) { if (owns()) record.error = errorMessage(error); }
    finally { finished = true; clearTimeout(timer); if (record.read === active) { record.read = null; record.loading = false; } update(); }
  }
  async function refresh() {
    if (input.audience !== 'owner') return;
    await read(ownerPath, raw => {
      const value = ownerBusinessTeamViewSchema.parse(raw);
      if (value.businessId !== input.businessId || value.ownerUid !== input.uid) throw Error('La respuesta no corresponde a tu negocio.');
      record.view = value; record.viewGeneration = input.requestScope?.readGeneration ?? 0;
      record.currentTeamRevision = Math.max(record.currentTeamRevision, value.teamRevision);
      if (record.applied) record.current = [...value.requested, ...value.active].find(item => item.membershipId === record.proofMembershipId) ?? null;
    }, () => { record.view = null; });
  }
  async function checkBusiness(slug: string) {
    if (record.pending) return;
    const parsed = teamBusinessSlugSchema.safeParse(slug);
    if (!parsed.success) { record.error = 'Escribe el enlace corto válido del negocio.'; update(); return; }
    record.slug = slug;
    await read(`/api/team/memberships?businessSlug=${encodeURIComponent(slug)}`, raw => {
      const value = teamMembershipPageSchema.parse(raw);
      if (value.scopeUid !== input.uid || value.mode !== 'business') throw Error('La respuesta no corresponde a tu cuenta.');
      record.page = value;
      if (record.applied) record.current = value.items.find(item => item.membershipId === record.proofMembershipId) ?? null;
    }, () => { record.page = null; record.agenda = null; });
  }
  async function loadMemberships(afterBusinessId?: string) {
    if (afterBusinessId && !teamDocumentIdSchema.safeParse(afterBusinessId).success) return;
    record.slug = null;
    await read('/api/team/memberships' + (afterBusinessId ? `?afterBusinessId=${encodeURIComponent(afterBusinessId)}` : ''), raw => {
      const value = teamMembershipPageSchema.parse(raw);
      if (value.scopeUid !== input.uid || value.mode !== 'page' || afterBusinessId && value.items.some(item => item.businessId <= afterBusinessId)) throw Error('La página no corresponde a tu cuenta.');
      record.page = value;
      if (record.applied) record.current = value.items.find(item => item.membershipId === record.proofMembershipId) ?? null;
    }, () => { record.page = null; record.agenda = null; });
  }
  async function readAgenda(dateKey: string) {
    if (!input.businessId || !readable()) return;
    record.date = dateKey;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      cancelRead(); record.agenda = null; record.error = 'Elige un día válido para consultar la agenda.'; update(); return;
    }
    await read(`/api/team/businesses/${encodeURIComponent(input.businessId)}/agenda?date=${encodeURIComponent(dateKey)}`, raw => {
      const value = teamAgendaViewSchema.parse(raw);
      if (value.businessId !== input.businessId || value.dateKey !== dateKey || record.date !== dateKey) throw Error('La agenda no corresponde al día solicitado.');
      record.agenda = value;
    }, () => { record.agenda = null; });
  }
  async function send(pending: Pending) {
    if (!actionable() || record.pending !== pending || pending.running) return;
    // Ref is sealed synchronously, before WebCrypto or token acquisition can yield.
    pending.running = true; record.error = null; record.notice = null; update();
    const owns = () => current() && record.pending === pending;
    const timer = setTimeout(() => { if (owns()) { record.notice = 'La operación está tardando. Seguimos esperando; comprueba la misma petición antes de iniciar otra.'; update(); } }, 20000);
    try {
      if (!pending.hash) {
        const [hash, eventId, membershipId] = await Promise.all([sha256(teamAccessCommandCanonicalString(pending.command)), sha256(JSON.stringify(['team-access', pending.command.businessId, input.uid, pending.command.requestId])), sha256(JSON.stringify(['business-team', pending.command.businessId, input.uid]))]);
        if (!owns()) return;
        pending.hash = hash; pending.eventId = eventId;
        if (pending.command.kind === 'request') pending.membershipId = membershipId;
      }
      if (!owns() || !actionable()) return;
      const raw = await fetcher('write', pending.path, { method: pending.method, body: pending.body }, owns);
      if (!owns()) return;
      const result = teamMutationResultSchema.parse(raw);
      const member = result.current;
      if (result.audience !== input.audience || member.businessId !== pending.command.businessId
        || pending.membershipId && member.membershipId !== pending.membershipId
        || result.audience === 'owner' && result.current.memberUid !== pending.memberUid) throw Error('El resultado no corresponde a esta operación.');
      if (!owns()) return;
      acceptProof(result.applied, pending, member, result.teamRevision); cancelRead(); record.view = null; record.page = null; record.agenda = null;
    } catch (error) { if (owns()) { record.error = errorMessage(error); record.notice = 'Resultado sin confirmar. Conservamos la petición exacta; consultar sin constancia no prueba que haya fallado.'; } }
    finally { clearTimeout(timer); pending.running = false; if (owns() && pending.proven) record.pending = null; update(); }
  }
  function seal(command: TeamAccessCanonicalCommand, payload: object, path: string, method: string, membershipId: string|null, extra: Partial<Pending> = {}) {
    if (!actionable() || record.pending) return Promise.resolve();
    const pending: Pending = { command: Object.freeze({ ...command }), membershipId, path, method, body: JSON.stringify(payload), running: false, proven: false, ...extra };
    record.pending = pending; record.applied = null; record.current = null; record.proofMembershipId = null; record.currentTeamRevision = 0;
    return send(pending);
  }
  async function decide(membershipId: string, command: TeamOwnerDecisionCommand) {
    if (!actionable() || record.pending) return;
    const parsed = teamOwnerDecisionCommandSchema.safeParse(command), view = record.view;
    const member = [...(view?.requested ?? []), ...(view?.active ?? [])].find(item => item.membershipId === membershipId);
    if (!parsed.success || !view || !member || member.revision !== command.expectedMembershipRevision || view.teamRevision !== command.expectedTeamRevision
      || command.action === 'revoke' && member.status !== 'active' || command.action !== 'revoke' && member.status !== 'requested'
      || command.action === 'approve' && (!view.enabled || !view.eligible)) return;
    await seal({ kind: command.action, businessId: view.businessId, actorUid: input.uid, requestId: command.requestId, expectedMembershipRevision: command.expectedMembershipRevision,
      expectedTeamRevision: command.expectedTeamRevision, resourceId: command.action === 'approve' ? command.resourceId : null }, parsed.data, `${ownerPath}/${encodeURIComponent(membershipId)}`, 'PATCH', membershipId, { memberUid: member.memberUid });
  }
  async function requestAccess(command: TeamSelfRequestCommand) {
    if (!actionable() || record.pending) return;
    const parsed = teamSelfRequestCommandSchema.safeParse(command), page = record.page;
    if (!parsed.success || page?.mode !== 'business' || !page.target || record.slug !== command.businessSlug || (page.items[0]?.revision ?? 0) !== command.expectedMembershipRevision
      || page.items.some(item => item.status === 'requested' || item.status === 'active')) return;
    await seal({ kind: 'request', businessId: page.target.businessId, actorUid: input.uid, requestId: command.requestId, expectedMembershipRevision: command.expectedMembershipRevision,
      expectedTeamRevision: null, resourceId: null }, parsed.data, '/api/team/requests', 'POST', null, { slug: command.businessSlug });
  }
  async function leave(membershipId: string, command: TeamLeaveCommand) {
    if (!actionable() || record.pending) return;
    const parsed = teamLeaveCommandSchema.safeParse(command), member = record.page?.items.find(item => item.membershipId === membershipId);
    if (!parsed.success || !member || member.revision !== command.expectedMembershipRevision || !['requested', 'active'].includes(member.status)) return;
    await seal({ kind: 'leave', businessId: member.businessId, actorUid: input.uid, requestId: command.requestId, expectedMembershipRevision: command.expectedMembershipRevision,
      expectedTeamRevision: null, resourceId: null }, parsed.data, `/api/team/memberships/${encodeURIComponent(membershipId)}`, 'DELETE', membershipId);
  }
  async function inspectPending() {
    const pending = record.pending;
    if (!pending || !pending.hash || !readable()) return;
    const requestId = encodeURIComponent(pending.command.requestId);
    // The account page has no slug. Inspect the current own page without treating it as a receipt; exact replay can recover a withdrawal.
    if (input.audience === 'member' && !pending.slug) {
      await loadMemberships();
      if (!current() || record.pending !== pending) return;
      record.notice = 'Para comprobar la salida, reintenta la misma petición exacta. Mis espacios muestra únicamente el estado actual.'; update(); return;
    }
    const path = input.audience === 'owner' ? `${ownerPath}?requestId=${requestId}` : `/api/team/memberships?businessSlug=${encodeURIComponent(pending.slug!)}&requestId=${requestId}`;
    await read(path, raw => {
      if (record.pending !== pending) return;
      if (input.audience === 'owner') {
        const value = ownerBusinessTeamViewSchema.parse(raw);
        if (value.businessId !== input.businessId || value.ownerUid !== input.uid) throw Error('La constancia no corresponde a tu negocio.');
        record.view = value; record.viewGeneration = input.requestScope?.readGeneration ?? 0;
        record.currentTeamRevision = Math.max(record.currentTeamRevision, value.teamRevision);
        if (record.applied) record.current = [...value.requested, ...value.active].find(item => item.membershipId === record.proofMembershipId) ?? null;
        if (value.applied) {
          const event = value.events.find(item => item.id === value.applied!.eventId);
          if (!event) {
            record.notice = 'La constancia no incluye el evento de la cuenta revisada entre los últimos 20. Reintenta la misma petición exacta para comprobarla.';
            return;
          }
          const expectedAfter = { approve: 'active', reject: 'rejected', revoke: 'revoked', request: 'requested', leave: 'revoked' }[pending.command.kind];
          if (event.membershipId !== pending.membershipId || event.memberUid !== pending.memberUid || event.actorUid !== input.uid
            || event.sequence !== value.applied.teamRevision || event.recordedAt !== value.applied.recordedAt || event.afterStatus !== expectedAfter
            || event.beforeStatus !== (pending.command.kind === 'revoke' ? 'active' : 'requested')
            || pending.command.kind === 'approve' && event.resourceId !== pending.command.resourceId) throw Error('La constancia no corresponde a la cuenta y decisión revisadas. Conservamos la petición exacta.');
          acceptProof(value.applied, pending, [...value.requested, ...value.active].find(item => item.membershipId === pending.membershipId) ?? null, value.teamRevision);
        }
      } else {
        const value = teamMembershipPageSchema.parse(raw);
        if (value.scopeUid !== input.uid || value.mode !== 'business' || value.target?.businessId !== pending.command.businessId) throw Error('La constancia no corresponde a tu cuenta.');
        record.page = value;
        if (value.applied) {
          if (value.items[0]?.membershipId !== pending.membershipId) throw Error('La constancia no corresponde a tu membresía.');
          acceptProof(value.applied, pending, value.items[0] ?? null, value.applied.teamRevision);
        }
      }
      if (!pending.proven) record.notice = 'Sin constancia de esta petición. El estado actual no confirma un fallo; la petición exacta sigue pendiente.';
    }, () => { record.view = null; record.page = null; record.agenda = null; });
  }
  async function retryPending() { if (record.pending) await send(record.pending); }
  useEffect(() => {
    record.live = true;
    if (input.audience === 'owner') void refresh(); else if (input.businessId) void readAgenda(record.date); else void loadMemberships();
    return () => { record.live = false; cancelRead(); record.pending = null; record.view = null; record.page = null; record.agenda = null; };
  }, [record]); // Stable identity; feature protection and own busy never remount it.
  useEffect(() => {
    if (!input.businessId || input.audience !== 'member' || typeof document === 'undefined') return;
    const visible = () => document.visibilityState !== 'hidden';
    const reenter = () => { cancelRead(); record.agenda = null; update(); if (visible()) void readAgenda(record.date); };
    const visibility = () => { if (!visible()) { cancelRead(); record.agenda = null; update(); } else reenter(); };
    const timer = setInterval(() => { if (visible() && !record.read) void readAgenda(record.date); }, 15000);
    document.addEventListener('visibilitychange', visibility); window.addEventListener('focus', reenter);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', reenter); };
  }, [record]);
  // Authoritative owner loss purges synchronously before a render can publish private state.
  if (input.requestScope && !input.requestScope.isCurrent()) { record.pending = null; record.view = null; record.page = null; record.agenda = null; record.applied = null; record.current = null; }
  const show = readable();
  return { view: show && record.viewGeneration === (input.requestScope?.readGeneration ?? 0) ? record.view : null, page: show ? record.page : null,
    agenda: show ? record.agenda : null, loading: show && record.loading, busy: Boolean(record.pending?.running), pending: Boolean(record.pending),
    error: current() ? record.error : record.denied ? record.error : null, notice: show ? record.notice : null, applied: show ? record.applied : null,
    current: show ? record.current : null, refresh, decide, checkBusiness, loadMemberships, requestAccess, leave, readAgenda, inspectPending, retryPending };
}
