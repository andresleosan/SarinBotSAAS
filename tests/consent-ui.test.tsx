import { act, createElement, type ReactNode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountConsentProvider, ConsentPanel, PreauthorizationChoices, useAccountConsent } from '@/components/consent-panel';
import { consentContent, type ConsentStatus } from '@/lib/legal';
import { apiFetch } from '@/lib/client/api';
vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
const documents = { ...consentContent('account'), fingerprint: 'a'.repeat(64) };
const initial: ConsentStatus = { active: false, revision: 0, receipt: null, documents };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe('explicit consent controls', () => {
  let renderer: ReactTestRenderer | undefined;
  let controller!: ReturnType<typeof useAccountConsent>;
  function Harness() { controller = useAccountConsent(); return createElement('div', null, createElement(ConsentPanel, { controller, title: 'Cuenta' }), createElement('p', null, 'Historial y cancelación disponibles')); }
  function tree(uid: string) { return createElement(AccountConsentProvider, { uid, children: createElement(Harness) }); }
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
  it('keeps withdrawal closed during a pending or uncertain POST even when polling returns the previous accepted revision', async () => {
    const accepted = { ...initial, active: true, revision: 1 };
    let reject!: (error: Error) => void;
    vi.mocked(apiFetch).mockImplementation((_, init) => init?.method === 'POST' ? new Promise((_done, fail) => { reject = fail; }) : Promise.resolve(accepted));
    await mount(); expect(controller.active).toBe(true);
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
