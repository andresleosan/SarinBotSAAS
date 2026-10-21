import { act, createElement, type ReactNode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountConsentProvider, ConsentPanel, PreauthorizationChoices, useAccountConsent } from '@/components/consent-panel';
import { consentContent, type ConsentScope, type ConsentStatus } from '@/lib/legal';
import { useConsent } from '@/hooks/useConsent';
import { apiFetch, ApiError } from '@/lib/client/api';
import { historicalAccount } from './fixtures/consent-2026-10-18.1';
vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
const documents = { ...consentContent('account'), fingerprint: 'a'.repeat(64) };
const initial: ConsentStatus = { active: false, revision: 0, receipt: null, documents };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe('explicit consent controls', () => {
  let renderer: ReactTestRenderer | undefined;
  let controller!: ReturnType<typeof useAccountConsent>;
  function Harness() { controller = useAccountConsent(); return createElement('div', null, createElement(ConsentPanel, { controller, title: 'Cuenta' }), createElement('p', null, 'Historial y cancelación disponibles')); }
  function tree(uid: string) { return createElement(AccountConsentProvider, { uid, children: createElement(Harness) }); }
  function Scoped({ uid, scope, blockedReason }: { uid?: string; scope: ConsentScope; blockedReason?: string }) { controller = useConsent(uid, scope, scope === 'business_client' ? { id: 'shop', name: 'Demo', phoneWhatsApp: '12345678' } : undefined); return createElement(ConsentPanel, { controller, blockedReason }); }
  // Independent presentation fixture: using the current support builder here would make RED fail during import.
  const supportStatus: ConsentStatus = { ...initial, documents: { ...documents, scope: 'platform_support' as ConsentScope, business: null, notice: 'Soporte de la plataforma SarinBot', termsAcceptance: 'Acepto soporte', dataAuthorization: 'Autorizo soporte', terms: 'Condiciones exclusivas de soporte', privacy: 'Datos exclusivos de soporte' } };
  async function scoped(scope: ConsentScope = 'platform_support' as ConsentScope, uid: string | null = 'one', blockedReason?: string) { await act(async () => { if (renderer) renderer.update(createElement(Scoped, { uid: uid ?? undefined, scope, blockedReason })); else renderer = create(createElement(Scoped, { uid: uid ?? undefined, scope, blockedReason })); }); }
  async function mount() { await act(async () => { renderer = create(tree('one')); }); }
  const choose = async (index: number, checked: boolean) => { await act(async () => renderer!.root.findAllByType('input')[index].props.onChange({ target: { checked } })); };
  beforeEach(() => { vi.mocked(apiFetch).mockReset().mockResolvedValue(initial); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'signed-proof', expiresAt: Date.now() + 1200000 }), { status: 200 }))); });
  afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
  it('starts with two unchecked decisions, links documents and records explicit choices', async () => {
    await mount();
    expect(renderer!.root.findAllByType('input').map(input => input.props.checked)).toEqual([false, false]);
    expect(renderer!.root.findAllByType('a').map(link => link.props.href)).toEqual(expect.arrayContaining(['/terminos', '/privacidad']));
    expect(renderer!.root.findByProps({ 'aria-label': 'Aceptar condiciones y autorizar datos' }).props.disabled).toBe(true);
    await choose(0, true); await choose(1, true);
    vi.mocked(apiFetch).mockResolvedValueOnce({ ...initial, active: true, revision: 1 });
    await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    const body = JSON.parse(String(vi.mocked(apiFetch).mock.calls.find(call => call[1]?.method === 'POST')?.[1]?.body));
    expect(body).toMatchObject({ scope: 'account', action: 'accept', expectedRevision: 0, fingerprint: documents.fingerprint, termsAccepted: true, dataAuthorized: true, preauthorization: 'signed-proof' });
    expect(controller.active).toBe(true);
  });
  it('polls support without a business and posts both explicit choices without business or proof', async () => {
    vi.mocked(apiFetch).mockResolvedValue(supportStatus); await scoped();
    expect(controller.status?.documents.scope).toBe('platform_support');
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe('/api/consent?scope=platform_support');
    expect(vi.mocked(apiFetch).mock.calls[0]?.[2]).toBe('one');
    expect(renderer!.root.findAllByType('input').map(input => input.props.checked)).toEqual([false, false]);
    await choose(0, true); expect(renderer!.root.findByProps({ 'aria-label': 'Aceptar condiciones y autorizar datos' }).props.disabled).toBe(true);
    await choose(0, false); await choose(1, true); expect(renderer!.root.findByProps({ 'aria-label': 'Aceptar condiciones y autorizar datos' }).props.disabled).toBe(true);
    await choose(0, true); await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    const body = JSON.parse(String(vi.mocked(apiFetch).mock.calls.find(call => call[1]?.method === 'POST')?.[1]?.body));
    expect(body).toMatchObject({ scope: 'platform_support', termsAccepted: true, dataAuthorized: true });
    expect(body).not.toHaveProperty('businessId'); expect(body).not.toHaveProperty('preauthorization');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('exposes the actual scoped legal documents and support withdrawal consequences', async () => {
    const local = { ...controller, status: { ...supportStatus, active: true }, active: true, loading: false, busy: false, error: null, withdrawalRequested: false, decide: vi.fn(), refresh: vi.fn() };
    await act(async () => { renderer = create(createElement(ConsentPanel, { controller: local })); });
    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain('Condiciones exclusivas de soporte'); expect(text).toContain('Datos exclusivos de soporte');
    expect(renderer!.root.findAllByType('summary').length).toBeGreaterThanOrEqual(3);
    expect(text).toMatch(/soporte.*WhatsApp/i);
  });
  it('resets unchecked decisions on revision, fingerprint and scope and respects blocked/busy state', async () => {
    let current = supportStatus; vi.mocked(apiFetch).mockImplementation(async () => current); await scoped();
    expect(controller.status).toEqual(supportStatus);
    for (const changed of [{ ...supportStatus, revision: 1 }, { ...supportStatus, revision: 1, documents: { ...supportStatus.documents, fingerprint: 'b'.repeat(64) } }, { ...supportStatus, revision: 1, documents: { ...supportStatus.documents, scope: 'account' as const, fingerprint: 'b'.repeat(64) } }]) {
      await choose(0, true); await choose(1, true); current = changed; await act(async () => controller.refresh());
      expect(renderer!.root.findAllByType('input').map(input => input.props.checked)).toEqual([false, false]);
    }
    await scoped('platform_support' as ConsentScope, 'one', 'Cuenta requerida'); await choose(0, true); await choose(1, true);
    const submit = renderer!.root.findByProps({ 'aria-label': 'Aceptar condiciones y autorizar datos' }); expect(submit.props.disabled).toBe(true);
    await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    expect(vi.mocked(apiFetch).mock.calls.some(call => call[1]?.method === 'POST')).toBe(false);
  });
  it('masks prior active state on a scope switch and logout and suppresses late support mutations', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ...initial, active: true, revision: 1 }); await scoped('account');
    let finishRead!: (value: ConsentStatus) => void;
    vi.mocked(apiFetch).mockImplementation(() => new Promise(done => { finishRead = done; })); await scoped();
    expect(controller.active).toBe(false); expect(controller.status).toBeNull();
    expect(finishRead).toBeTypeOf('function');
    await act(async () => finishRead(supportStatus));
    let finishPost!: (value: ConsentStatus) => void; let signal!: AbortSignal;
    vi.mocked(apiFetch).mockImplementation((_, init) => { signal = init!.signal as AbortSignal; return new Promise(done => { finishPost = done; }); });
    let pending!: Promise<void>; act(() => { pending = controller.decide('accept'); });
    await scoped('platform_support' as ConsentScope, null);
    expect(signal.aborted).toBe(true); expect(controller.status).toBeNull(); expect(controller.busy).toBe(false);
    await act(async () => { finishPost({ ...supportStatus, active: true, revision: 1 }); await pending; });
    expect(controller.active).toBe(false); expect(controller.status).toBeNull();
  });
  it('retries uncertain support acceptance with the same body and refreshes after conflicts', async () => {
    vi.mocked(apiFetch).mockResolvedValue(supportStatus); await scoped();
    expect(controller.status).toEqual(supportStatus);
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Uncertain')); await act(async () => controller.decide('accept'));
    const original = vi.mocked(apiFetch).mock.calls.find(call => call[1]?.method === 'POST')?.[1]?.body;
    vi.mocked(apiFetch).mockResolvedValueOnce(supportStatus); await act(async () => controller.decide('accept'));
    expect(vi.mocked(apiFetch).mock.calls.filter(call => call[1]?.method === 'POST').at(-1)?.[1]?.body).toBe(original);
    for (const status of [409, 428]) {
      vi.mocked(apiFetch).mockRejectedValueOnce(new ApiError('Changed', status)).mockResolvedValueOnce({ ...supportStatus, revision: status });
      await act(async () => controller.decide('accept'));
      expect(controller.status?.revision).toBe(status);
    }
  });
  it('blocks repeated form submission while a support decision is busy', async () => {
    vi.mocked(apiFetch).mockResolvedValue(supportStatus); await scoped(); await choose(0, true); await choose(1, true);
    let finish!: (value: ConsentStatus) => void;
    vi.mocked(apiFetch).mockImplementation(() => new Promise(done => { finish = done; }));
    let pending!: Promise<void>; act(() => { pending = renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    expect(renderer!.root.findByProps({ 'aria-label': 'Aceptar condiciones y autorizar datos' }).props.disabled).toBe(true);
    await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    expect(vi.mocked(apiFetch).mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
    await act(async () => { finish(supportStatus); await pending; });
  });
  it('suppresses a late support read after changing UID and scope and retains the business request boundary', async () => {
    let finish!: (value: ConsentStatus) => void;
    const businessStatus: ConsentStatus = { ...initial, documents: { ...documents, scope: 'business_client', business: { id: 'shop', name: 'Demo', phoneWhatsApp: '12345678' } } };
    vi.mocked(apiFetch).mockImplementation(url => url.includes('scope=platform_support') ? new Promise(done => { finish = done; }) : Promise.resolve(businessStatus));
    await scoped(); await scoped('business_client', 'two');
    const businessCall = vi.mocked(apiFetch).mock.calls.at(-1)!;
    expect(businessCall[0]).toBe('/api/consent?scope=business_client&businessId=shop'); expect(businessCall[2]).toBe('two');
    await act(async () => finish({ ...supportStatus, active: true, revision: 9 }));
    expect(controller.status).toEqual(businessStatus); expect(controller.active).toBe(false);
  });
  it('downloads saved historical documents rather than the current displayed documents', async () => {
    const receipt = { uid: 'demo-user', scope: 'account' as const, businessId: null, requestId: 'demo-old', action: 'accept' as const, revision: 1, occurredAt: 1, preauthorizedAt: null, termsAccepted: true, dataAuthorized: true, documents: historicalAccount as unknown as ConsentStatus['documents'] };
    let saved!: Blob; const click = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: (value: Blob) => { saved = value; return 'blob:demo'; }, revokeObjectURL: vi.fn() });
    vi.stubGlobal('document', { createElement: () => ({ click }) });
    const local = { ...controller, status: { ...supportStatus, receipt }, active: false, loading: false, busy: false, error: null, withdrawalRequested: false, decide: vi.fn(), refresh: vi.fn() };
    await act(async () => { renderer = create(createElement(ConsentPanel, { controller: local })); });
    await act(async () => renderer!.root.findAllByType('button').find(button => button.children.includes('Descargar mi constancia'))!.props.onClick());
    expect(JSON.parse(await saved.text())).toEqual(receipt); expect(click).toHaveBeenCalledOnce();
  });
  it('keeps new operations closed after a read error while retaining read-only content', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('Sin conexión')); await mount();
    expect(controller.active).toBe(false);
    expect(JSON.stringify(renderer?.toJSON())).toContain('Historial y cancelación disponibles');
    expect(JSON.stringify(renderer?.toJSON())).toContain('Sin conexión');
  });
  it('ignores a pending acceptance when UID changes and immediately masks the prior state', async () => {
    await mount(); let resolve!: (value: ConsentStatus) => void;
    vi.mocked(apiFetch).mockImplementation((_, init) => init?.method === 'POST' ? new Promise(done => { resolve = done as typeof resolve; }) : Promise.resolve(initial));
    let pending!: Promise<void>;
    act(() => { pending = controller.decide('accept'); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => renderer?.update(tree('two')));
    await act(async () => { resolve({ ...initial, active: true, revision: 1 }); await pending; });
    expect(controller.active).toBe(false); expect(controller.status?.revision).toBe(0);
  });
  it.each(['account', 'platform_support'] as ConsentScope[])('keeps %s withdrawal closed during a pending or uncertain POST even when polling returns the previous accepted revision', async scope => {
    const accepted = { ...(scope === 'account' ? initial : supportStatus), active: true, revision: 1 };
    let reject!: (error: Error) => void;
    vi.mocked(apiFetch).mockImplementation((_, init) => init?.method === 'POST' ? new Promise((_done, fail) => { reject = fail; }) : Promise.resolve(accepted));
    await scoped(scope); expect(controller.active).toBe(true);
    let withdrawal!: Promise<void>;
    act(() => { withdrawal = controller.decide('revoke'); });
    expect(controller.active).toBe(false);
    await act(async () => controller.refresh());
    expect(controller.active).toBe(false); expect(controller.busy).toBe(true);
    await act(async () => { reject(new Error('Respuesta perdida')); await withdrawal; });
    await act(async () => controller.refresh());
    expect(controller.active).toBe(false); expect(controller.busy).toBe(false);
    const original = vi.mocked(apiFetch).mock.calls.find(call => call[1]?.method === 'POST')?.[1]?.body;
    vi.mocked(apiFetch).mockResolvedValueOnce({ ...initial, revision: 2 });
    await act(async () => controller.decide('revoke'));
    const posts = vi.mocked(apiFetch).mock.calls.filter(call => call[1]?.method === 'POST');
    expect(posts.at(-1)?.[1]?.body).toBe(original);
    expect(controller.active).toBe(false);
  });
  it('obtains signed proof before enabling the Google acceptance action and clears it when unchecked', async () => {
    const onContinue = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => new Response(JSON.stringify(init?.method === 'POST' ? { token: 'before-google', expiresAt: Date.now() + 1200000 } : { documents }))));
    await act(async () => { renderer = create(createElement(PreauthorizationChoices, { onContinue })); });
    expect(renderer!.root.findByProps({ 'aria-label': 'Aceptar y continuar con Google' }).props.disabled).toBe(true);
    await choose(0, true); await choose(1, true);
    expect(onContinue).not.toHaveBeenCalled();
    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Aceptar y continuar con Google' }).props.onClick());
    expect(onContinue).toHaveBeenCalledWith('before-google');
    await choose(1, false);
    expect(renderer!.root.findByProps({ 'aria-label': 'Aceptar y continuar con Google' }).props.disabled).toBe(true);
  });
});
