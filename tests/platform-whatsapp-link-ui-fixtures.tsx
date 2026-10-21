import { act, createElement, Fragment, type ReactElement } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { expect, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { AuthProvider, useAuth } from '@/components/auth-provider';
import { useAccountConsent } from '@/components/consent-panel';
import { PlatformWhatsAppLink } from '@/components/platform-whatsapp-link';
import { consentContent, type ConsentStatus } from '@/lib/legal';
import type { PlatformWhatsAppLinkStatus } from '@/types/platform-whatsapp-link';
export const ids = { challenge: '11111111-1111-4111-8111-111111111111', nextChallenge: '22222222-2222-4222-8222-222222222222', link: '33333333-3333-4333-8333-333333333333', generation: '44444444-4444-4444-8444-444444444444', nextGeneration: '55555555-5555-4555-8555-555555555555' };
export const syntheticCommand = 'sarinbot.link.v1:' + ids.challenge + ':' + 's'.repeat(43) + ':' + 'm'.repeat(43);
export const response = (value: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(value), { status, headers });
export function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
export const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.type === 'code' ? '[ephemeral command]' : node.children.map(text).join('');
export type FirebaseFixture = { user: User | null; listener: ((user: User | null) => Promise<void>) | null };
export function createLinkHarness(firebase: FirebaseFixture) {
  let renderer: ReactTestRenderer | undefined;
  let auth!: ReturnType<typeof useAuth>, account!: ReturnType<typeof useAccountConsent>;
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const browser = Object.assign(new EventTarget(), { location: { href: 'https://synthetic.test/ayuda' } });
  const consent = (scope: 'account' | 'platform_support'): ConsentStatus => ({ active: true, revision: 1, receipt: null, documents: { ...consentContent(scope), fingerprint: (scope === 'account' ? 'a' : 'b').repeat(64) } });
  const data = { account: consent('account'), support: consent('platform_support'), status: { available: true, revokeGeneration: null, current: null, pending: null } as PlatformWhatsAppLinkStatus, admin: true };
  const user = { uid: 'owner-a', displayName: 'Synthetic', providerData: [{ providerId: 'google.com' }], getIdToken: vi.fn(async () => 'synthetic-token'), getIdTokenResult: vi.fn(async () => ({ authTime: 'old-auth-time', issuedAtTime: 'new-issued-time' })) } as unknown as User;
  let mutation: (path: string, init: RequestInit) => Promise<Response> = async (_path, init) => {
    const body = JSON.parse(String(init.body));
    if (init.method === 'DELETE') { data.status = { ...data.status, current: null, pending: null, revokeGeneration: null }; return response({ revoked: true }); }
    if (body.action === 'begin') { data.status = { ...data.status, revokeGeneration: ids.generation, pending: { challengeId: ids.challenge, revision: 1, expiresAt: Date.now() + 600000, maskedPhone: '••••0001', proof: 'pending' } }; return response({ challengeId: ids.challenge, code: syntheticCommand, expiresAt: Date.now() + 600000, whatsappUrl: 'https://wa.me/573000000099' }); }
    if (body.action === 'confirm') { data.status = { ...data.status, pending: null, current: { linkId: ids.link, revision: 1, expiresAt: Date.now() + 86400000, maskedPhone: '••••0001' } }; return response({ linkId: ids.link, revision: 1, expiresAt: Date.now() + 86400000 }); }
    throw Error('Unexpected owner mutation');
  };
  const transport = vi.fn(async (path: string, init: RequestInit = {}): Promise<Response> => {
    if (path === '/api/session') return response({ isSuperadmin: data.admin });
    if (path.startsWith('/api/consent?scope=')) return response(path.endsWith('platform_support') ? data.support : data.account);
    if (path === '/api/consent/preauthorize') return response({ documents: data.account.documents, token: 'synthetic-proof', expiresAt: Date.now() + 1200000 });
    if (path === '/api/consent' && init.method === 'POST') {
      const body = JSON.parse(String(init.body)), current = body.scope === 'account' ? data.account : data.support;
      const next = { ...current, active: body.action === 'accept', revision: current.revision + 1 };
      if (body.scope === 'account') data.account = next; else data.support = next;
      return response(next);
    }
    if (path === '/api/platform-whatsapp/link') return init.method === 'POST' || init.method === 'DELETE' ? mutation(path, init) : response(data.status);
    throw Error('Unexpected synthetic backend path');
  });
  vi.useFakeTimers(); vi.setSystemTime(1000000);
  vi.stubGlobal('document', page); vi.stubGlobal('window', browser); vi.stubGlobal('fetch', transport);
  const storage = { getItem: () => { throw Error('No persistent storage'); }, setItem: () => { throw Error('No persistent storage'); }, removeItem: () => { throw Error('No persistent storage'); }, clear: () => { throw Error('No historical purge'); } };
  vi.stubGlobal('localStorage', storage); vi.stubGlobal('sessionStorage', storage);
  const clipboard = vi.fn(async (_value: string) => {}); vi.stubGlobal('navigator', { clipboard: { writeText: clipboard } });
  function Capture() { auth = useAuth(); account = useAccountConsent(); return null; }
  const root = () => renderer!.root;
  const content = () => text(root());
  const button = (label: string) => root().findAllByType('button').find(node => text(node) === label)!;
  const writes = () => transport.mock.calls.filter(([path, init]) => path === '/api/platform-whatsapp/link' && ['POST', 'DELETE'].includes(init?.method ?? 'GET'));
  const command = () => root().findAllByType('code')[0]?.children.join('') ?? null;
  const scope = () => root().findByProps({ 'aria-label': 'Vincular mi WhatsApp con SarinBot' });
  async function mount(view: ReactElement = createElement(PlatformWhatsAppLink), login = true) {
    await act(async () => { renderer = create(createElement(AuthProvider, { children: createElement(Fragment, null, createElement(Capture), view) })); });
    if (login) await emit(user); else await emit(null);
  }
  async function emit(value: User | null) { firebase.user = value; await act(async () => firebase.listener?.(value)); }
  async function click(label: string) { const control = button(label); expect(Boolean(control)).toBe(true); await act(async () => control.props.onClick()); }
  async function begin() {
    await act(async () => root().findByProps({ id: 'owner-whatsapp-phone' }).props.onChange({ target: { value: '+573000000001' } }));
    const form = root().findAllByType('form').find(node => node.findAllByProps({ id: 'owner-whatsapp-phone' }).length)!;
    await act(async () => form.props.onSubmit({ preventDefault() {} }));
  }
  async function focus() { await act(async () => browser.dispatchEvent(new Event('focus'))); }
  async function unmount() { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
  return { data, user, transport, clipboard, root, content, button, writes, command, scope, mount, emit, click, begin, focus, unmount, page, browser, get auth() { return auth; }, get account() { return account; }, setMutation: (value: typeof mutation) => { mutation = value; } };
}
