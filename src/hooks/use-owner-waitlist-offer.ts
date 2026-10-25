"use client";
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { apiFetch, ApiError, errorMessage } from '@/lib/client/api';
import { parseOwnerWaitlistDate } from '@/lib/owner-waitlist';
import { ownerWaitlistOfferContextSchema, ownerWaitlistOfferRecoverySchema, ownerWaitlistOfferResultSchema, ownerWaitlistOfferPageSchema, waitlistOfferCloseResultSchema, ownerWaitlistOfferCommandSchema, compareOwnerWaitlistOffers, type OwnerWaitlistOfferContext, type OwnerWaitlistOfferPage, type OwnerWaitlistOfferRecovery, type OwnerWaitlistOfferCommand, type OwnerWaitlistOfferCursor, type OwnerWaitlistOfferQuery } from '@/lib/waitlist-offers';
export type OwnerWaitlistOfferInput = { businessId: string | null; ownerUid: string | null; authEpoch: number; enabled: boolean; available?: boolean; otherActionPending?: boolean };
type State = { key: string; context: OwnerWaitlistOfferContext|null; page: OwnerWaitlistOfferPage|null; recovery: OwnerWaitlistOfferRecovery|null; command: OwnerWaitlistOfferCommand|null; dateKey: string; filter: OwnerWaitlistOfferQuery['filter']; loading: boolean; busy: boolean; uncertain: boolean; error: string|null; notice: string|null };
type Pending = { key: string; kind: 'create'; recordId: string; command: OwnerWaitlistOfferCommand; conflict?: boolean; cancel?: () => void } | { key: string; kind: 'withdraw'|'close-expired'; offerId: string; cancel?: () => void };
const today = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
const blank = (key: string): State => ({ key, context: null, page: null, recovery: null, command: null, dateKey: today(), filter: 'all', loading: false, busy: false, uncertain: false, error: null, notice: null });
export function useOwnerWaitlistOffer(input: OwnerWaitlistOfferInput) {
  const auth = useAuth(), key = JSON.stringify([input.businessId, input.ownerUid, input.authEpoch, input.enabled, auth.user?.uid, auth.authEpoch]);
  const current = useRef({input, auth, key}); current.current = {input, auth, key};
  const [snapshot, setSnapshot] = useState(() => blank(key)), state = useRef(snapshot), mounted = useRef(true), denied = useRef<string|null>(null);
  const reading = useRef<{ cancel: () => void }|null>(null), pending = useRef<Pending|null>(null), selectedRecord = useRef<string|null>(null);
  function valid(expected: string) { const c = current.current, s = c.input; return mounted.current && c.key === expected && s.enabled && denied.current !== expected && Boolean(s.businessId && s.ownerUid) && c.auth.user?.uid === s.ownerUid && c.auth.authEpoch === s.authEpoch && c.auth.isCurrentSession(s.ownerUid!, s.authEpoch); }
  const available = () => valid(current.current.key) && current.current.input.available !== false;
  function patch(value: Partial<State>) { if (!mounted.current) return; const expected = current.current.key; state.current = {...(state.current.key === expected ? state.current : blank(expected)), ...value, key: expected}; setSnapshot(state.current); }
  function cancelRead() { const old = reading.current; reading.current = null; old?.cancel(); }
  function deny(expected: string) { if (expected !== current.current.key) return; denied.current = expected; cancelRead(); pending.current?.cancel?.(); pending.current = null; selectedRecord.current = null; patch({...blank(expected), error:'Ya no tienes acceso a estas ofertas. Verifica tu cuenta y negocio.'}); }
  const base = () => `/api/businesses/${encodeURIComponent(current.current.input.businessId!)}/owner-waitlist`;
  const status = (expected: string) => (code: number) => { if (code === 401 || code === 403) deny(expected); };
  function scope(value: {businessId: string; viewerUid: string}, expected: string) { if (value.businessId !== current.current.input.businessId || value.viewerUid !== current.current.input.ownerUid) { deny(expected); throw Error('No se pudo verificar el ámbito de la oferta.'); } }
  async function read<T>(path: string, init: RequestInit, decode: (raw: unknown) => T, accept: (value: T) => void) {
    if (!available()) return;
    const expected = current.current.key; cancelRead();
    const abort = new AbortController(); let reject!: (error: Error) => void, finished = false;
    const canceled = new Promise<never>((_, no) => { reject = no; });
    const active = {cancel: () => { abort.abort(); reject(Error('La consulta superó el tiempo de espera. Inténtalo de nuevo.')); }};
    reading.current = active; const owns = () => !finished && valid(expected) && current.current.input.available !== false && reading.current === active;
    patch({loading:true, error:null}); const timer = setTimeout(active.cancel, 10000);
    try { const raw = await Promise.race([apiFetch<unknown>(path, {...init, signal:abort.signal}, current.current.input.ownerUid!, owns, status(expected)), canceled]); if (owns()) accept(decode(raw)); }
    catch(error) { if (owns()) patch({loading:false, error:errorMessage(error)}); }
    finally { finished = true; clearTimeout(timer); if (reading.current === active) reading.current = null; }
  }
  async function open(recordId: string) {
    if (!available() || pending.current?.kind === 'create' && pending.current.recordId !== recordId) return;
    const expected = current.current.key; selectedRecord.current = recordId;
    await read(base() + '/' + encodeURIComponent(recordId) + '/offer-context', {}, raw => {
      const value = ownerWaitlistOfferContextSchema.parse(raw); scope({businessId:value.detail.businessId,viewerUid:value.detail.ownerUid}, expected);
      if (value.detail.row.recordId !== recordId) throw Error('El contexto no corresponde a la solicitud.');
      return value;
    }, context => {
      const p = pending.current;
      if (p?.kind === 'create' && p.conflict && (context.headRevision > p.command.expectedHeadRevision || context.detail.row.waitlistRevision > p.command.expectedWaitlistRevision)) {
        pending.current = null; patch({command:null,busy:false,uncertain:false,notice:'Se comprobó el estado actual tras el conflicto. No es una constancia de la publicación anterior.'});
      }
      patch({context, recovery:context.currentOffer, loading:false, ...(pending.current ? {} : {command:null})});
    });
  }
  function select(resourceId: string, startTimeStr: string) {
    const s = state.current, context = s.context;
    if (!available() || current.current.input.otherActionPending || pending.current || !context?.eligible || !context.writesEnabled || !context.detail.availability.some(r => r.resourceId === resourceId && r.slots.includes(startTimeStr))) return;
    const row = context.detail.row;
    patch({command:ownerWaitlistOfferCommandSchema.parse({requestId:crypto.randomUUID(),entryId:row.entryId,expectedWaitlistRevision:row.waitlistRevision,expectedHeadRevision:context.headRevision,selection:{resourceId,startTimeStr}}),recovery:null,error:null,notice:null});
  }
  async function send(p: Pending) {
    if (!available() || pending.current !== p || state.current.busy) return;
    const abort = new AbortController(); let finished = false, reject!: (error: Error) => void;
    const canceled = new Promise<never>((_, no) => { reject = no; });
    p.cancel = () => { abort.abort(); reject(Error('La cuenta o el ámbito cambiaron.')); };
    const owns = () => !finished && valid(p.key) && pending.current === p;
    patch({busy:true,error:null,notice:null});
    const timer = setTimeout(() => { if (owns()) patch({notice:'La operación está demorando. Comprueba el estado; no envíes otra intención.'}); }, 20000);
    const path = p.kind === 'create' ? base()+'/'+encodeURIComponent(p.recordId)+'/offers' : base()+'/offers/'+encodeURIComponent(p.offerId)+'/'+p.kind;
    const body = p.kind === 'create' ? p.command : p.kind === 'withdraw' ? {withdraw:true} : {closeExpired:true};
    try {
      const raw = await Promise.race([apiFetch<unknown>(path,{method:'POST',body:JSON.stringify(body),signal:abort.signal},current.current.input.ownerUid!,owns,status(p.key)),canceled]);
      if (!owns()) return;
      if (p.kind === 'create') {
        const value = ownerWaitlistOfferResultSchema.parse(raw), r = value.recovery, t = r.offer.target; scope(r,p.key);
        if (r.offer.waitlistRecordId !== p.recordId || r.offer.entryId !== p.command.entryId || t.resourceId !== p.command.selection.resourceId || t.startTimeStr !== p.command.selection.startTimeStr || value.appliedHeadRevision !== p.command.expectedHeadRevision+1) throw Error('No se pudo verificar el resultado de esta publicación.');
        pending.current = null; cancelRead(); patch({recovery:r,context:null,command:null,busy:false,loading:false,uncertain:false,notice:'Oferta publicada en Sarin. No se envió un aviso externo ni se retuvo el horario.'});
      } else {
        const value = waitlistOfferCloseResultSchema.parse(raw); scope(value,p.key);
        if (value.offerId !== p.offerId || value.persistedState === 'offered') throw Error('Falta comprobar el cierre de la oferta.');
        const r = state.current.recovery;
        if (!r || r.offer.id !== p.offerId || value.proof && value.proof.entryId !== r.offer.entryId) throw Error('El cierre no corresponde a esta oferta.');
        const recovery = ownerWaitlistOfferRecoverySchema.parse({...r,serverNow:Math.max(r.serverNow,value.proof?.confirmedAt??0),offer:{...r.offer,persistedState:value.persistedState},proof:value.proof,usability:null});
        pending.current = null; cancelRead(); patch({recovery,busy:false,loading:false,uncertain:false,notice:value.persistedState === 'booked' ? 'Se comprobó una reserva vinculada. Este cierre no cancela la cita.' : 'Se comprobó el cierre de la oferta. La solicitud sigue su propio estado.'});
      }
    } catch(error) { if (owns()) { if (p.kind === 'create' && error instanceof ApiError && error.status === 409 && ['OFFER_CHANGED','OFFER_EXISTS','OFFER_REQUEST_REUSED'].includes(error.code??'')) p.conflict = true; patch({busy:false,uncertain:true,error:errorMessage(error)}); } }
    finally { finished=true; clearTimeout(timer); p.cancel=undefined; }
  }
  async function publish() { const s=state.current; if (!available() || current.current.input.otherActionPending || pending.current || s.busy || !s.command || !s.context) return; const p:Pending={key:current.current.key,kind:'create',recordId:s.context.detail.row.recordId,command:s.command}; pending.current=p; await send(p); }
  async function retryPending() { if (pending.current && !state.current.busy) await send(pending.current); }
  async function openOffer(offerId: string) {
    if (pending.current && pending.current.kind !== 'create' && pending.current.offerId !== offerId) return;
    const expected=current.current.key;
    await read(base()+'/offers/'+encodeURIComponent(offerId),{},raw=>{const r=ownerWaitlistOfferRecoverySchema.parse(raw);scope(r,expected);if(r.offer.id!==offerId)throw Error('La oferta recibida no corresponde a la consulta.');return r;},recovery=>{
      const p=pending.current;
      if(p && p.kind!=='create' && p.offerId===offerId && recovery.offer.persistedState!=='offered') { p.cancel?.();pending.current=null;patch({busy:false,uncertain:false,notice:'Se comprobó el resultado persistido de la oferta.'}); }
      patch({recovery,loading:false});
    });
  }
  async function recover() { const p=pending.current; if(p?.kind==='create') await open(p.recordId); else if(p) await openOffer(p.offerId); else if(state.current.recovery) await openOffer(state.current.recovery.offer.id); else if(selectedRecord.current) await open(selectedRecord.current); }
  async function closeOffer(action: 'withdraw'|'close-expired') { const r=state.current.recovery; if(!available() || pending.current || state.current.busy || !r || r.offer.persistedState!=='offered')return;const p:Pending={key:current.current.key,kind:action,offerId:r.offer.id};pending.current=p;await send(p); }
  async function query(dateKey=state.current.dateKey,filter:OwnerWaitlistOfferQuery['filter']=state.current.filter,cursor?:OwnerWaitlistOfferCursor) {
    if(!available())return;
    try { parseOwnerWaitlistDate(dateKey,Date.now()); } catch {patch({error:'Elige una fecha válida hasta los próximos 366 días.'});return;}
    const changed=state.current.dateKey!==dateKey||state.current.filter!==filter;
    patch({dateKey,filter,...(changed?{page:null}:{} )}); const expected=current.current.key;
    await read(base()+'/offers/query',{method:'POST',body:JSON.stringify({dateKey,filter,...(cursor?{cursor}:{})})},raw=>{const value=ownerWaitlistOfferPageSchema.parse(raw);scope(value,expected);if(value.dateKey!==dateKey||value.filter!==filter||cursor&&value.rows.some(r=>compareOwnerWaitlistOffers({id:cursor.offerId,createdAt:cursor.createdAt},r)>=0))throw Error('La página no corresponde a la consulta.');return value;},page=>patch({page,loading:false}));
  }
  async function loadOlder() { if(state.current.page?.nextCursor&&!state.current.loading)await query(state.current.dateKey,state.current.filter,state.current.page.nextCursor); }
  function close() {cancelRead();if(!pending.current)patch({context:null,recovery:null,command:null,loading:false});else patch({loading:false});}
  useEffect(()=>{mounted.current=true;cancelRead();pending.current?.cancel?.();pending.current=null;selectedRecord.current=null;patch(blank(key));return()=>{mounted.current=false;cancelRead();pending.current?.cancel?.();};},[key]);
  useEffect(()=>{if(input.available===false){cancelRead();patch({loading:false});}},[key,input.available]);
  const effective=snapshot.key===key&&available()?snapshot:blank(key);
  return {...effective,open,select,publish,retryPending,recover,openOffer,closeOffer,query,loadOlder,close};
}
export type OwnerWaitlistOfferController = ReturnType<typeof useOwnerWaitlistOffer>;
