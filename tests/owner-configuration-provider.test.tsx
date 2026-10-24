import { act, createElement, type ReactNode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnerConfigurationProvider, useOwnerConfigurationSession } from '@/components/owner-configuration-provider';
import { apiFetch, ApiError } from '@/lib/client/api';
import { configurationFingerprint, createOwnerConfigurationDraft } from '@/lib/owner-configuration';
import type { BusinessConfig } from '@/lib/server/schemas';
import type { Business } from '@/types/firestore';
import { normalizeBusinessSocialLinks } from '@/lib/business-branding';
import { preserveServiceCatalogMetadata } from '@/lib/service-catalog';

const identity = vi.hoisted(() => ({ uid: 'owner', epoch: 1, valid: true }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: identity.uid ? { uid: identity.uid } : null, authEpoch: identity.epoch, loading: false, signingOut: false, isCurrentSession: (uid: string, epoch: number) => identity.valid && identity.uid === uid && identity.epoch === epoch }) }));
vi.mock('@/lib/client/api', () => ({ apiFetch: vi.fn(), ApiError: class extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }, errorMessage: (error: unknown) => error instanceof Error ? error.message : 'Error' }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fixture(): Business {
  return { id: 'business', ownerUid: 'owner', ownerEmail: 'private@example.test', name: 'Negocio', slug: 'negocio', category: 'Servicios', phoneWhatsApp: '573001234567', timezone: 'America/Bogota', subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: 4_000_000_000_000 }, sarinConfig: { onboardingCompleted: true, tone: 'Claro', customRules: 'Regla privada', intakeFields: [{ key: 'note', label: 'Pregunta', required: false }] }, resources: [{ id: 'principal', name: 'Profesional', active: true }], services: [{ id: 'service', name: 'Servicio', durationMinutes: 30, bufferMinutes: 0, price: 10000, resourceIds: ['principal'] }], weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { isOpen: false, intervals: [] }])), createdAt: 1 };
}
function savedBusiness(config: BusinessConfig): Business { return { ...fixture(), ...config, location: config.location ?? undefined, sarinConfig: { onboardingCompleted: true, tone: config.tone, customRules: config.customRules, intakeFields: config.intakeFields } }; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const capability = { configured: true, revision: 1, dataMode: 'general' as const, representedMinorsEnabled: false };
const scope = { uid: 'owner', authEpoch: 1, businessId: 'business' };

describe('owner configuration authority and pending writes', () => {
  let renderer: ReactTestRenderer;
  let api: ReturnType<typeof useOwnerConfigurationSession>;
  let current: Business;
  function Consumer({ children }: { children?: ReactNode }) { api = useOwnerConfigurationSession(); return createElement('div', null, api.session?.draft.name, children); }
  beforeEach(() => { identity.uid = 'owner'; identity.epoch = 1; identity.valid = true; current = fixture(); vi.mocked(apiFetch).mockReset(); vi.mocked(apiFetch).mockImplementation(async (_path, init) => init?.method === 'POST' ? { business: savedBusiness(JSON.parse(String(init.body))) } : { business: structuredClone(current) }); });
  afterEach(async () => { await act(async () => renderer?.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
  async function mount(verify = true) { await act(async () => { renderer = create(createElement(OwnerConfigurationProvider, null, createElement(Consumer))); }); if (verify) await act(async () => { await api.verifyOwner(scope); }); }
  async function edit(name = 'Editado') { await act(async () => { api.edit(scope, { ...api.session!.draft, name }); }); }
  const posts = () => vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  async function pendingSave() {
    const post = deferred<{ business: Business }>();
    vi.mocked(apiFetch).mockImplementation(async (_path, init) => init?.method === 'POST' ? post.promise : { business: structuredClone(current) });
    let saving!: Promise<void>;
    await act(async () => { saving = api.save({ scope, capability, consentActive: true }); });
    return { post, saving };
  }

  it('does not fetch globally and verifies again before exposing a preserved draft', async () => {
    await mount(false); expect(apiFetch).not.toHaveBeenCalled(); expect(api.session).toBeNull();
    await act(async () => { await api.verifyOwner(scope); }); await edit();
    const probe = deferred<{ business: Business }>(); vi.mocked(apiFetch).mockReturnValueOnce(probe.promise);
    let verification!: Promise<Business | null>;
    await act(async () => { verification = api.verifyOwner(scope); });
    expect(api.authority.state).toBe('checking'); expect(api.session).toBeNull();
    await act(async () => { probe.resolve({ business: current }); await verification; });
    expect(api.session!.draft.name).toBe('Editado');
  });
  it.each(['uid', 'epoch'] as const)('masks and purges old memory immediately after %s changes', async kind => {
    await mount(); await edit();
    if (kind === 'uid') identity.uid = 'other'; else identity.epoch++;
    await act(async () => { renderer.update(createElement(OwnerConfigurationProvider, null, createElement(Consumer))); });
    expect(api.session).toBeNull(); expect(JSON.stringify(renderer.toJSON())).not.toContain('Editado');
    identity.uid = 'owner'; identity.epoch = 3;
    await act(async () => { renderer.update(createElement(OwnerConfigurationProvider, null, createElement(Consumer))); });
    await act(async () => { await api.verifyOwner({ uid: 'owner', authEpoch: 3, expectedBusinessId: 'business' }); });
    expect(api.session!.draft.name).toBe('Negocio');
  });
  it.each(['403', '401', 'null', 'wrong-owner', 'wrong-business'] as const)('revokes same tuple on authoritative %s, discarding old edits', async reason => {
    await mount(); await edit(); const generation = api.authority.generation;
    if (reason === '403' || reason === '401') vi.mocked(apiFetch).mockRejectedValueOnce(new ApiError('Denied', Number(reason)));
    else vi.mocked(apiFetch).mockResolvedValueOnce({ business: reason === 'null' ? null : { ...current, ...(reason === 'wrong-owner' ? { ownerUid: 'other' } : { id: 'other' }) } });
    await act(async () => { await api.verifyOwner({ ...scope, expectedBusinessId: scope.businessId }); });
    expect(api.authority.state).toBe('revoked'); expect(api.authority.generation).toBeGreaterThan(generation); expect(api.session).toBeNull();
    await act(async () => { await api.verifyOwner(scope); }); expect(api.session!.draft.name).toBe('Negocio');
  });
  it.each([new TypeError('offline'), new ApiError('Plan', 402), new ApiError('Consent', 428, 'CONSENT_REQUIRED')])('preserves protected memory for recoverable verification failures', async error => {
    await mount(); await edit(); vi.mocked(apiFetch).mockRejectedValueOnce(error);
    await act(async () => { await api.verifyOwner(scope); });
    expect(api.authority.state).toBe('unavailable'); expect(api.session).toBeNull();
    await act(async () => { await api.verifyOwner(scope); }); expect(api.session!.draft.name).toBe('Editado');
  });
  it('ignores logo-only observation and keeps a dirty draft on an external change', async () => {
    await mount(); await edit(); const baseline = api.session!.baseline;
    await act(async () => { api.observe(scope, { ...current, logo: { sha256: 'new-logo' } as Business['logo'] }); });
    expect(api.session!.draft.name).toBe('Editado'); expect(api.session!.external).toBeNull();
    current = { ...current, name: 'Otra vista' };
    await act(async () => { api.observe(scope, current); });
    expect(api.session!.phase).toBe('external-change'); expect(api.session!.baseline).toEqual(baseline);
    await act(async () => { await api.save({ scope, capability, consentActive: true }); }); expect(posts()).toHaveLength(0);
    const reviewed = configurationFingerprint(api.session!.external!);
    current = { ...current, name: 'Cambio posterior' };
    await act(async () => { await api.save({ scope, capability, consentActive: true, reviewedExternalFingerprint: reviewed }); }); expect(posts()).toHaveLength(0);
    await act(async () => { await api.save({ scope, capability, consentActive: true, reviewedExternalFingerprint: configurationFingerprint(api.session!.external!) }); });
    expect(posts()).toHaveLength(1); expect(api.session!.phase).toBe('saved');
  });
  it('uses fresh preflight without resetting dirty, preserves sections and sends no local operation ID', async () => {
    await mount(); await edit();
    await act(async () => { await api.save({ scope, capability, consentActive: true }); });
    const payload = JSON.parse(String(posts()[0][1]?.body));
    expect(payload.name).toBe('Editado'); expect(payload.services).toEqual(current.services); expect(payload.intakeFields).toEqual(current.sarinConfig.intakeFields);
    expect(payload).not.toHaveProperty('localId'); expect(api.session!.phase).toBe('saved');
    expect(api.session!.savedConfiguration).not.toHaveProperty('ownerEmail'); expect(api.session!.savedConfiguration).not.toHaveProperty('subscription');
  });
  it('pending A plus matching GET cannot send B; only the final original POST completes', async () => {
    await mount(); await edit('A'); const { post, saving } = await pendingSave();
    const command = structuredClone(api.session!.pendingCommand!); current = savedBusiness(command.payload);
    await act(async () => { await api.checkOutcome(scope); api.observe(scope, current); api.edit(scope, { ...command.payload, name: 'B' }); api.discard(scope); api.loadExternal(scope); await api.save({ scope, capability, consentActive: true, reviewedExternalFingerprint: command.fingerprint }); });
    expect(posts()).toHaveLength(1); expect(api.session!.phase).toBe('saving'); expect(api.session!.savedConfiguration).toBeNull();
    expect(api.session!.pendingCommand!.payload).toEqual(command.payload); expect(api.session!.baseline.name).toBe('Negocio');
    await act(async () => { post.resolve({ business: current }); await saving; });
    expect(api.session!.phase).toBe('saved'); expect(api.session!.pendingCommand).toBeNull(); expect(api.session!.baseline.name).toBe('A');
  });
  it('a transport failure retains the barrier even after matching GET and navigation', async () => {
    await mount(); await edit('A'); const { post, saving } = await pendingSave(); current = savedBusiness(api.session!.pendingCommand!.payload);
    await act(async () => { post.reject(new TypeError('offline')); await saving; });
    expect(api.session!.phase).toBe('uncertain'); expect(api.session!.pendingCommand!.transport).toBe('failed-unknown');
    await act(async () => { api.go(scope, 'summary'); await api.verifyOwner(scope); await api.checkOutcome(scope); api.discard(scope); api.loadExternal(scope); await api.save({ scope, capability, consentActive: true }); });
    expect(api.session!.phase).toBe('uncertain'); expect(posts()).toHaveLength(1); expect(api.session!.baseline.name).toBe('Negocio');
  });
  it('a different observation cannot prove the original POST failed', async () => {
    await mount(); await edit(); const { post, saving } = await pendingSave(); current = { ...current, name: 'Distinto' };
    await act(async () => { await api.checkOutcome(scope); });
    expect(api.session!.phase).toBe('saving'); expect(api.session!.pendingCommand!.observedCurrent!.name).toBe('Distinto');
    await act(async () => { post.resolve({ business: savedBusiness(api.session!.pendingCommand!.payload) }); await saving; });
  });
  it('blocks concurrent preflights before either could send', async () => {
    await mount(); await edit(); const preflight = deferred<{ business: Business }>(); vi.mocked(apiFetch).mockReturnValueOnce(preflight.promise);
    let first!: Promise<void>;
    await act(async () => { first = api.save({ scope, capability, consentActive: true }); await api.save({ scope, capability, consentActive: true }); api.edit(scope, { ...api.session!.draft, name: 'B' }); });
    expect(api.session!.phase).toBe('checking'); expect(api.session!.draft.name).toBe('Editado');
    await act(async () => { preflight.resolve({ business: current }); await first; }); expect(posts()).toHaveLength(1);
  });
  it('twenty seconds only marks a slow POST; observation has a separate controller', async () => {
    vi.useFakeTimers(); await mount(); await edit(); const { post, saving } = await pendingSave(); const postSignal = posts()[0][1]!.signal!;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(postSignal.aborted).toBe(false); expect(api.session!.pendingCommand!.slow).toBe(true); expect(posts()).toHaveLength(1);
    await act(async () => { await api.checkOutcome(scope); });
    const getSignal = vi.mocked(apiFetch).mock.calls.at(-1)![1]!.signal;
    expect(getSignal).not.toBe(postSignal); expect(postSignal.aborted).toBe(false);
    await act(async () => { post.resolve({ business: savedBusiness(api.session!.pendingCommand!.payload) }); await saving; });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds verification GET at ten seconds even if transport ignores abort', async () => {
    vi.useFakeTimers(); await mount(false); vi.mocked(apiFetch).mockReturnValueOnce(new Promise(() => {}));
    let probe!: Promise<Business | null>;
    await act(async () => { probe = api.verifyOwner(scope); });
    const signal = vi.mocked(apiFetch).mock.calls[0][1]!.signal!;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); await probe; });
    expect(signal.aborted).toBe(true); expect(api.authority.state).toBe('unavailable'); expect(vi.getTimerCount()).toBe(0);
  });
  it('owner denial from an observation aborts pending POST and ignores late success after route unmount', async () => {
    await mount(); await edit(); const { post, saving } = await pendingSave(); const payload = api.session!.pendingCommand!.payload; const signal = posts()[0][1]!.signal!;
    await act(async () => { renderer.update(createElement(OwnerConfigurationProvider, null, createElement('div', null, 'Otra ruta'))); });
    vi.mocked(apiFetch).mockRejectedValueOnce(new ApiError('Owner denied', 403));
    await act(async () => { await api.checkOutcome(scope); }); expect(signal.aborted).toBe(true);
    await act(async () => { post.resolve({ business: savedBusiness(payload) }); await saving; renderer.update(createElement(OwnerConfigurationProvider, null, createElement(Consumer))); });
    expect(api.authority.state).toBe('revoked'); expect(api.session).toBeNull();
    await act(async () => { await api.verifyOwner(scope); }); expect(api.session!.draft.name).toBe('Negocio');
  });
  it.each([400, 402, 409, 428])('a definitive %i write error preserves draft and permits explicit retry', async status => {
    await mount(); await edit(); const { post, saving } = await pendingSave();
    await act(async () => { post.reject(new ApiError('Condición pendiente', status)); await saving; });
    expect(api.session!.pendingCommand).toBeNull(); expect(api.session!.draft.name).toBe('Editado'); expect(api.session!.phase).toBe('error');
  });
  it.each([500, 502])('a %i write response remains uncertain', async status => {
    await mount(); await edit(); const { post, saving } = await pendingSave();
    await act(async () => { post.reject(new ApiError('No confirmado', status)); await saving; });
    expect(api.session!.phase).toBe('uncertain'); expect(api.session!.pendingCommand).not.toBeNull();
  });
  it('an unverifiable final response cannot claim saved', async () => {
    await mount(); await edit(); const { post, saving } = await pendingSave();
    await act(async () => { post.resolve({ business: { ...current, services: [] } }); await saving; });
    expect(api.session!.phase).toBe('uncertain'); expect(api.session!.savedConfiguration).toBeNull();
  });
  it('POST owner denial also purges same-tuple memory', async () => {
    await mount(); await edit(); const { post, saving } = await pendingSave();
    await act(async () => { post.reject(new ApiError('Owner denied', 403)); await saving; });
    expect(api.authority.state).toBe('revoked'); expect(api.session).toBeNull();
  });
  it('protecting a pending POST does not abort it or expose its success before fresh verification', async () => {
    await mount(); await edit(); const { post, saving } = await pendingSave(); const payload = api.session!.pendingCommand!.payload; const signal = posts()[0][1]!.signal!;
    await act(async () => { api.protect(scope, 'No se pudo verificar'); }); expect(api.session).toBeNull(); expect(signal.aborted).toBe(false);
    current = savedBusiness(payload);
    await act(async () => { post.resolve({ business: current }); await saving; }); expect(api.session).toBeNull();
    await act(async () => { await api.verifyOwner(scope); }); expect(api.session!.phase).toBe('saved');
  });
  it('validates hidden issues and refuses consent or commercially blocked writes', async () => {
    await mount(); await edit();
    await act(async () => { await api.save({ scope, capability, consentActive: false }); }); expect(posts()).toHaveLength(0);
    current.subscription.status = 'suspended';
    await act(async () => { await api.save({ scope, capability, consentActive: true }); }); expect(posts()).toHaveLength(0);
    current = fixture();
    await act(async () => { api.edit(scope, { ...api.session!.draft, services: [{ ...current.services[0], resourceIds: ['absent'] }] }); await api.save({ scope, capability, consentActive: true }); });
    expect(api.session!.issues[0].section).toBe('services'); expect(api.session!.section).toBe('services'); expect(posts()).toHaveLength(0);
  });
  it('all closed days can save and restricted intake is excluded without deleting historical tone', async () => {
    await mount(); await act(async () => { await api.save({ scope, capability: { ...capability, dataMode: 'health' }, consentActive: true }); });
    const payload = JSON.parse(String(posts()[0][1]?.body)); expect(payload.intakeFields).toEqual([]); expect(payload.customRules).toBe('Regla privada'); expect(api.session!.phase).toBe('saved');
  });
  it('accepts a ready default general capability without inventing a policy setup gate', async () => {
    await mount(); await edit();
    await act(async () => { await api.save({ scope, capability: { ...capability, configured: false }, consentActive: true }); });
    expect(posts()).toHaveLength(1); expect(api.session!.phase).toBe('saved');
  });
  it('accepts the canonical social URLs returned by the existing successful save contract', async () => {
    await mount();
    await act(async () => { api.edit(scope, { ...api.session!.draft, socialLinks: [{ platform: 'website', url: 'https://example.test' }, { platform: 'instagram', url: 'https://www.instagram.com/sarin?ref=example' }] }); });
    vi.mocked(apiFetch).mockImplementation(async (_path, init) => {
      if (init?.method !== 'POST') return { business: current };
      const payload = JSON.parse(String(init.body)) as BusinessConfig;
      return { business: savedBusiness({ ...payload, socialLinks: normalizeBusinessSocialLinks(payload.socialLinks) }) };
    });
    await act(async () => { await api.save({ scope, capability, consentActive: true }); });
    expect(posts()).toHaveLength(1); expect(api.session!.phase).toBe('saved'); expect(api.session!.pendingCommand).toBeNull();
    expect(api.session!.baseline.socialLinks).toEqual([{ platform: 'website', url: 'https://example.test/' }, { platform: 'instagram', url: 'https://www.instagram.com/sarin' }]);
  });
  it('accepts metadata preserved by the server when reviewed overwrite omits that optional field', async () => {
    await mount(); await edit();
    current.services[0].description = 'Descripción añadida en otra vista';
    await act(async () => { api.observe(scope, current); });
    const reviewed = configurationFingerprint(api.session!.external!);
    vi.mocked(apiFetch).mockImplementation(async (_path, init) => {
      if (init?.method !== 'POST') return { business: current };
      const payload = JSON.parse(String(init.body)) as BusinessConfig;
      return { business: savedBusiness({ ...payload, services: preserveServiceCatalogMetadata(payload.services, current.services) }) };
    });
    await act(async () => { await api.save({ scope, capability, consentActive: true, reviewedExternalFingerprint: reviewed }); });
    expect(posts()).toHaveLength(1); expect(api.session!.phase).toBe('saved'); expect(api.session!.pendingCommand).toBeNull();
    expect(api.session!.baseline.services[0].description).toBe('Descripción añadida en otra vista');
  });
  it('warns before unload only while dirty or an operation remains unresolved, with cleanup', async () => {
    const listeners = new Map<string, (event: { preventDefault: () => void; returnValue: string | undefined }) => void>();
    vi.stubGlobal('window', { addEventListener: (name: string, handler: (event: { preventDefault: () => void; returnValue: string | undefined }) => void) => listeners.set(name, handler), removeEventListener: (name: string) => listeners.delete(name) });
    await mount();
    const clean = { preventDefault: vi.fn(), returnValue: undefined };
    listeners.get('beforeunload')!(clean); expect(clean.preventDefault).not.toHaveBeenCalled();
    await edit(); const dirty = { preventDefault: vi.fn(), returnValue: undefined };
    listeners.get('beforeunload')!(dirty); expect(dirty.preventDefault).toHaveBeenCalledOnce();
    const { post, saving } = await pendingSave();
    await act(async () => { post.reject(new TypeError('offline')); await saving; });
    const uncertain = { preventDefault: vi.fn(), returnValue: undefined };
    listeners.get('beforeunload')!(uncertain); expect(uncertain.preventDefault).toHaveBeenCalledOnce();
    await act(async () => { renderer.unmount(); }); expect(listeners.size).toBe(0);
  });
  it('a changed account aborts pending writes and a late success never repopulates memory', async () => {
    await mount(); await edit(); const { post, saving } = await pendingSave(); const payload = api.session!.pendingCommand!.payload; const signal = posts()[0][1]!.signal!;
    identity.uid = 'other'; identity.epoch++;
    await act(async () => { renderer.update(createElement(OwnerConfigurationProvider, null, createElement(Consumer))); });
    expect(signal.aborted).toBe(true); expect(api.session).toBeNull();
    await act(async () => { post.resolve({ business: savedBusiness(payload) }); await saving; }); expect(api.session).toBeNull();
  });
  it('discard uses external configuration locally and never writes', async () => {
    await mount(); await edit(); current = { ...current, name: 'Nueva publicación' };
    await act(async () => { api.observe(scope, current); api.discard(scope); });
    expect(api.session!.draft).toEqual(createOwnerConfigurationDraft(current)); expect(posts()).toHaveLength(0);
  });
});
