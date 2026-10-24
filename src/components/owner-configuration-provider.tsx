'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth-provider';
import { apiFetch, ApiError, errorMessage } from '@/lib/client/api';
import type { BookingCapability } from '@/lib/booking-subject';
import { normalizeBusinessSocialLinks } from '@/lib/business-branding';
import { businessConfigSchema, type BusinessConfig } from '@/lib/server/schemas';
import { isSubscriptionAllowed } from '@/lib/sarin/subscription';
import { configurationFingerprint, createOwnerConfigurationDraft, effectiveOwnerConfiguration, validateOwnerConfiguration, type ConfigurationIssue, type OwnerConfigurationPhase, type OwnerConfigurationSection } from '@/lib/owner-configuration';
import type { Business } from '@/types/firestore';

export type ConfigurationScope = { uid: string; authEpoch: number; businessId: string };
export type ConfigurationAuthorityState = 'unverified' | 'checking' | 'verified' | 'unavailable' | 'revoked';
export type ConfigurationAuthority = { scope: ConfigurationScope | null; generation: number; state: ConfigurationAuthorityState; error: string | null };
export type PendingConfigurationCommand = { localId: string; payload: BusinessConfig; fingerprint: string; authorityGeneration: number; startedAt: number; transport: 'pending' | 'failed-unknown'; slow: boolean; observedCurrent: BusinessConfig | null };
export type OwnerConfigurationSession = { scope: ConfigurationScope; draft: BusinessConfig; baseline: BusinessConfig; section: OwnerConfigurationSection; phase: OwnerConfigurationPhase; issues: ConfigurationIssue[]; external: BusinessConfig | null; savedConfiguration: BusinessConfig | null; pendingCommand: PendingConfigurationCommand | null; error: string | null };
type VerifyInput = { uid: string; authEpoch: number; expectedBusinessId?: string };
type SaveInput = { scope: ConfigurationScope; capability: BookingCapability; consentActive: boolean; reviewedExternalFingerprint?: string };
type ConfigurationSessionApi = {
  authority: ConfigurationAuthority;
  session: OwnerConfigurationSession | null;
  verifyOwner: (input: VerifyInput) => Promise<Business | null>;
  protect: (scope: ConfigurationScope, message: string) => void;
  revoke: (scope: ConfigurationScope, message: string) => void;
  observe: (scope: ConfigurationScope, business: Business) => void;
  edit: (scope: ConfigurationScope, next: BusinessConfig) => void;
  go: (scope: ConfigurationScope, section: OwnerConfigurationSection) => void;
  discard: (scope: ConfigurationScope) => void;
  save: (input: SaveInput) => Promise<void>;
  checkOutcome: (scope: ConfigurationScope) => Promise<void>;
  loadExternal: (scope: ConfigurationScope) => void;
};
type Snapshot = Pick<ConfigurationSessionApi, 'authority' | 'session'>;
const context = createContext<ConfigurationSessionApi | null>(null);
const clone = (config: BusinessConfig): BusinessConfig => JSON.parse(configurationFingerprint(config)) as BusinessConfig;
const sameScope = (left: ConfigurationScope | null | undefined, right: ConfigurationScope) => left?.uid === right.uid && left.authEpoch === right.authEpoch && left.businessId === right.businessId;
const sameConfig = (left: BusinessConfig, right: BusinessConfig) => configurationFingerprint(left) === configurationFingerprint(right);
const blocked = (session: OwnerConfigurationSession) => session.phase === 'checking' || Boolean(session.pendingCommand);
const ownershipDenied = (error: unknown) => error instanceof ApiError && (error.status === 401 || error.status === 404 || (error.status === 403 && error.code !== 'CONSENT_REQUIRED'));
const definitiveWriteError = (error: unknown) => error instanceof ApiError && [400, 402, 409, 413, 422, 428, 429].includes(error.status);
const uncertainMessage = 'No pudimos confirmar el resultado de la petición. Puedes consultar la configuración actual, pero no volver a guardar desde esta sesión.';

/** Owns only one tab's editable projection. It never starts global network reads. */
export function OwnerConfigurationProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const authRef = useRef(auth); authRef.current = auth;
  const identity = `${auth.user?.uid ?? ''}:${auth.authEpoch}`;
  const lastIdentity = useRef(identity);
  const active = useRef(true);
  const state = useRef<Snapshot>({ authority: { scope: null, generation: 0, state: 'unverified', error: null }, session: null });
  const [snapshot, setSnapshot] = useState(state.current);
  const requests = useRef(new Set<AbortController>());
  const slowTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const verificationVersion = useRef(0);
  const ownsIdentity = useCallback((scope: Pick<ConfigurationScope, 'uid' | 'authEpoch'>) => {
    const current = authRef.current;
    return active.current && current.user?.uid === scope.uid && current.authEpoch === scope.authEpoch && !current.loading && !current.signingOut && current.isCurrentSession(scope.uid, scope.authEpoch);
  }, []);
  const publish = useCallback((next: Snapshot) => {
    state.current = next;
    if (active.current) setSnapshot(next);
  }, []);
  const abortAll = useCallback(() => {
    for (const request of requests.current) request.abort();
    requests.current.clear();
    for (const timer of slowTimers.current) clearTimeout(timer);
    slowTimers.current.clear();
  }, []);
  const clearAuthority = useCallback((message: string | null, authorityState: ConfigurationAuthorityState = 'revoked') => {
    verificationVersion.current++;
    publish({ authority: { scope: null, generation: state.current.authority.generation + 1, state: authorityState, error: message }, session: null });
    abortAll();
  }, [abortAll, publish]);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; state.current = { authority: { scope: null, generation: state.current.authority.generation + 1, state: 'unverified', error: null }, session: null }; abortAll(); };
  }, [abortAll]);
  useLayoutEffect(() => {
    if (lastIdentity.current !== identity || !auth.user || auth.signingOut) {
      lastIdentity.current = identity;
      clearAuthority(null, 'unverified');
    }
  }, [identity, auth.user, auth.signingOut, clearAuthority]);

  const owns = useCallback((scope: Pick<ConfigurationScope, 'uid' | 'authEpoch'>, generation: number) => ownsIdentity(scope) && state.current.authority.generation === generation, [ownsIdentity]);
  const sessionFor = useCallback((scope: ConfigurationScope, requireVerified = true) => {
    const current = state.current;
    return ownsIdentity(scope) && sameScope(current.session?.scope, scope) && (!requireVerified || current.authority.state === 'verified') ? current.session : null;
  }, [ownsIdentity]);
  const updateSession = useCallback((next: OwnerConfigurationSession) => publish({ ...state.current, session: next }), [publish]);
  const revoke = useCallback((scope: ConfigurationScope, message: string) => {
    if (ownsIdentity(scope) && (sameScope(state.current.authority.scope, scope) || sameScope(state.current.session?.scope, scope))) clearAuthority(message);
  }, [clearAuthority, ownsIdentity]);
  const protect = useCallback((scope: ConfigurationScope, message: string) => {
    if (!sessionFor(scope, false)) return;
    verificationVersion.current++;
    publish({ ...state.current, authority: { ...state.current.authority, state: 'unavailable', error: message } });
  }, [publish, sessionFor]);

  const readBusiness = useCallback(async (scope: Pick<ConfigurationScope, 'uid' | 'authEpoch'>, generation: number): Promise<unknown> => {
    const controller = new AbortController(); requests.current.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('No se pudo verificar el negocio. Vuelve a intentarlo.'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => controller.abort(), 10_000);
    });
    try {
      return await Promise.race([apiFetch<unknown>('/api/businesses', { signal: controller.signal }, scope.uid, () => owns(scope, generation)), interrupted]);
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) controller.signal.removeEventListener('abort', onAbort);
      requests.current.delete(controller);
    }
  }, [owns]);

  const inspectBusiness = useCallback((response: unknown, scope: Pick<ConfigurationScope, 'uid' | 'authEpoch'>, expectedBusinessId?: string): Business | null => {
    if (!response || typeof response !== 'object' || !('business' in response)) throw new Error('No se pudo comprobar la respuesta del negocio.');
    const business = response.business as Business | null;
    if (business === null) { clearAuthority(null); return null; }
    if (!business || typeof business !== 'object' || typeof business.id !== 'string' || typeof business.ownerUid !== 'string') throw new Error('No se pudo comprobar la respuesta del negocio.');
    if (business.ownerUid !== scope.uid || (expectedBusinessId && business.id !== expectedBusinessId)) { clearAuthority('Ya no tienes acceso a esta configuración. Verifica de nuevo tu negocio.'); return null; }
    // Inspecting the configurable projection also rejects malformed response shapes.
    createOwnerConfigurationDraft(business);
    if (!business.subscription || typeof business.sarinConfig.onboardingCompleted !== 'boolean') throw new Error('No se pudo comprobar la respuesta del negocio.');
    return business;
  }, [clearAuthority]);

  const observe = useCallback((scope: ConfigurationScope, business: Business) => {
    const session = sessionFor(scope, false);
    if (!session) return;
    if (business.ownerUid !== scope.uid || business.id !== scope.businessId) { revoke(scope, 'Ya no tienes acceso a esta configuración.'); return; }
    if (state.current.authority.state !== 'verified') return;
    const next = createOwnerConfigurationDraft(business);
    if (session.pendingCommand) {
      updateSession({ ...session, pendingCommand: { ...session.pendingCommand, observedCurrent: next } }); return;
    }
    if (session.phase === 'checking') return;
    if (sameConfig(next, session.baseline)) return;
    if (sameConfig(session.draft, session.baseline)) updateSession({ ...session, draft: clone(next), baseline: next, external: null, phase: 'idle', savedConfiguration: null, issues: [], error: null });
    else updateSession({ ...session, external: next, phase: 'external-change', error: null });
  }, [revoke, sessionFor, updateSession]);

  const verifyOwner = useCallback(async (input: VerifyInput): Promise<Business | null> => {
    if (!ownsIdentity(input)) return null;
    const oldScope = state.current.session?.scope;
    if (oldScope && (oldScope.uid !== input.uid || oldScope.authEpoch !== input.authEpoch || (input.expectedBusinessId && oldScope.businessId !== input.expectedBusinessId))) clearAuthority(null, 'unverified');
    const generation = state.current.authority.generation;
    const version = ++verificationVersion.current;
    publish({ ...state.current, authority: { ...state.current.authority, state: 'checking', error: null } });
    try {
      const response = await readBusiness(input, generation);
      if (!owns(input, generation)) return null;
      const business = inspectBusiness(response, input, input.expectedBusinessId ?? state.current.session?.scope.businessId);
      if (!business || !owns(input, generation) || version !== verificationVersion.current) return null;
      const scope: ConfigurationScope = { uid: input.uid, authEpoch: input.authEpoch, businessId: business.id };
      const previous = state.current.session;
      const initial = createOwnerConfigurationDraft(business);
      const session: OwnerConfigurationSession = previous && sameScope(previous.scope, scope) ? previous : { scope, draft: clone(initial), baseline: initial, section: 'summary', phase: 'idle', issues: [], external: null, savedConfiguration: null, pendingCommand: null, error: null };
      publish({ authority: { scope, generation, state: 'verified', error: null }, session });
      observe(scope, business);
      return business;
    } catch (error) {
      if (!owns(input, generation)) return null;
      if (ownershipDenied(error)) clearAuthority(errorMessage(error));
      else if (version === verificationVersion.current) publish({ ...state.current, authority: { ...state.current.authority, state: 'unavailable', error: 'No se pudo verificar tu negocio. Tu borrador de esta visita se conserva; vuelve a intentarlo.' } });
      return null;
    }
  }, [clearAuthority, inspectBusiness, observe, owns, ownsIdentity, publish, readBusiness]);

  const edit = useCallback((scope: ConfigurationScope, next: BusinessConfig) => {
    const session = sessionFor(scope);
    if (!session || blocked(session)) return;
    updateSession({ ...session, draft: clone(next), issues: [], phase: session.external ? 'external-change' : 'idle', error: null, savedConfiguration: null });
  }, [sessionFor, updateSession]);
  const go = useCallback((scope: ConfigurationScope, section: OwnerConfigurationSection) => {
    const session = sessionFor(scope);
    if (session) updateSession({ ...session, section });
  }, [sessionFor, updateSession]);
  const discard = useCallback((scope: ConfigurationScope) => {
    const session = sessionFor(scope);
    if (!session || blocked(session)) return;
    const config = clone(session.external ?? session.baseline);
    updateSession({ ...session, draft: clone(config), baseline: config, external: null, phase: 'idle', issues: [], error: null, savedConfiguration: null, section: 'summary' });
  }, [sessionFor, updateSession]);
  const loadExternal = useCallback((scope: ConfigurationScope) => { discard(scope); }, [discard]);

  const checkOutcome = useCallback(async (scope: ConfigurationScope) => {
    const session = sessionFor(scope, false);
    if (!session?.pendingCommand) return;
    const generation = state.current.authority.generation;
    const localId = session.pendingCommand.localId;
    try {
      const response = await readBusiness(scope, generation);
      if (!owns(scope, generation)) return;
      const business = inspectBusiness(response, scope, scope.businessId);
      const latest = state.current.session;
      if (!business || !owns(scope, generation) || latest?.pendingCommand?.localId !== localId) return;
      updateSession({ ...latest, pendingCommand: { ...latest.pendingCommand, observedCurrent: createOwnerConfigurationDraft(business) } });
    } catch (error) {
      if (!owns(scope, generation)) return;
      if (ownershipDenied(error)) clearAuthority(errorMessage(error));
      else protect(scope, 'No se pudo consultar la configuración actual. El guardado anterior conserva su estado.');
    }
  }, [clearAuthority, inspectBusiness, owns, protect, readBusiness, sessionFor, updateSession]);

  const save = useCallback(async ({ scope, capability, consentActive, reviewedExternalFingerprint }: SaveInput) => {
    const session = sessionFor(scope);
    if (!session || blocked(session)) return;
    if (!consentActive) { updateSession({ ...session, phase: 'error', error: 'Revisa los permisos de tu cuenta antes de guardar.' }); return; }
    const issues = validateOwnerConfiguration(session.draft, capability);
    if (issues.length) { updateSession({ ...session, issues, section: issues[0].section, phase: 'error', error: 'Revisa los campos indicados antes de guardar.' }); return; }
    const payload = businessConfigSchema.parse(effectiveOwnerConfiguration(session.draft, capability));
    if (payload.socialLinks !== undefined) payload.socialLinks = normalizeBusinessSocialLinks(payload.socialLinks);
    const generation = state.current.authority.generation;
    const fingerprint = configurationFingerprint(payload);
    updateSession({ ...session, phase: 'checking', issues: [], error: null, savedConfiguration: null });
    let currentBusiness: Business | null;
    try {
      const response = await readBusiness(scope, generation);
      if (!owns(scope, generation)) return;
      currentBusiness = inspectBusiness(response, scope, scope.businessId);
      if (!currentBusiness || !owns(scope, generation)) return;
      const latest = state.current.session!;
      if (state.current.authority.state !== 'verified') { updateSession({ ...latest, phase: 'error', error: 'Verifica de nuevo tu negocio antes de guardar.' }); return; }
      if (!isSubscriptionAllowed(currentBusiness)) { updateSession({ ...latest, phase: 'error', error: 'Necesitas acceso vigente para guardar la configuración.' }); return; }
      const external = createOwnerConfigurationDraft(currentBusiness);
      if (!sameConfig(external, latest.baseline) && configurationFingerprint(external) !== reviewedExternalFingerprint) {
        updateSession({ ...latest, external, phase: 'external-change', error: 'La configuración publicada cambió en otra vista. Revisa las diferencias antes de guardar.' }); return;
      }
    } catch (error) {
      if (!owns(scope, generation)) return;
      if (ownershipDenied(error)) clearAuthority(errorMessage(error));
      else {
        const latest = state.current.session;
        if (latest) updateSession({ ...latest, phase: 'error', error: 'No se envió la configuración porque no pudimos verificar el negocio.' });
        protect(scope, 'No se pudo verificar el negocio antes de guardar. Tu borrador se conserva.');
      }
      return;
    }
    if (!owns(scope, generation) || !state.current.session) return;
    const command: PendingConfigurationCommand = { localId: crypto.randomUUID(), payload: clone(payload), fingerprint, authorityGeneration: generation, startedAt: Date.now(), transport: 'pending', slow: false, observedCurrent: null };
    updateSession({ ...state.current.session, phase: 'saving', pendingCommand: command, error: null });
    const controller = new AbortController(); requests.current.add(controller);
    const ownsCommand = () => owns(scope, generation) && state.current.session?.pendingCommand?.localId === command.localId;
    const timer = setTimeout(() => {
      if (!ownsCommand()) return;
      const latest = state.current.session!;
      updateSession({ ...latest, pendingCommand: { ...latest.pendingCommand!, slow: true } });
    }, 20_000);
    slowTimers.current.add(timer);
    try {
      // Deliberately no POST deadline, retry or replacement request.
      const response = await apiFetch<unknown>('/api/businesses', { method: 'POST', body: JSON.stringify(command.payload), signal: controller.signal }, scope.uid, () => owns(scope, generation));
      if (!ownsCommand()) return;
      const business = inspectBusiness(response, scope, scope.businessId);
      if (!business || !ownsCommand()) return;
      const parsed = businessConfigSchema.safeParse(createOwnerConfigurationDraft(business));
      // The existing server normalizes fields and preserves omitted catalog
      // metadata against its current record. Its final response is canonical,
      // not necessarily an exact echo of the submitted configuration.
      if (!business.sarinConfig.onboardingCompleted || !parsed.success) throw new Error('No se pudo comprobar el resultado final.');
      const canonical = clone(parsed.data);
      updateSession({ ...state.current.session!, draft: clone(canonical), baseline: canonical, external: null, pendingCommand: null, savedConfiguration: clone(canonical), phase: 'saved', issues: [], error: null, section: 'summary' });
    } catch (error) {
      if (!ownsCommand()) return;
      if (ownershipDenied(error)) { clearAuthority(errorMessage(error)); return; }
      const latest = state.current.session!;
      if (definitiveWriteError(error)) updateSession({ ...latest, pendingCommand: null, phase: 'error', error: errorMessage(error) });
      else updateSession({ ...latest, phase: 'uncertain', pendingCommand: { ...latest.pendingCommand!, transport: 'failed-unknown', slow: false }, error: uncertainMessage });
    } finally {
      clearTimeout(timer); slowTimers.current.delete(timer); requests.current.delete(controller);
    }
  }, [clearAuthority, inspectBusiness, owns, protect, readBusiness, sessionFor, updateSession]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const current = state.current.session;
      if (current && (current.phase === 'checking' || current.pendingCommand || !sameConfig(current.draft, current.baseline))) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  const visible = snapshot.authority.scope && ownsIdentity(snapshot.authority.scope) && snapshot.authority.state === 'verified';
  const authority = lastIdentity.current === identity ? snapshot.authority : { scope: null, generation: snapshot.authority.generation, state: 'unverified' as const, error: null };
  const value = useMemo<ConfigurationSessionApi>(() => ({ authority, session: visible ? snapshot.session : null, verifyOwner, protect, revoke, observe, edit, go, discard, save, checkOutcome, loadExternal }), [authority, visible, snapshot.session, verifyOwner, protect, revoke, observe, edit, go, discard, save, checkOutcome, loadExternal]);
  return <context.Provider value={value}>{children}</context.Provider>;
}

export function useOwnerConfigurationSession(): ConfigurationSessionApi {
  const value = useContext(context);
  if (!value) throw new Error('Falta el proveedor de configuración del negocio.');
  return value;
}
