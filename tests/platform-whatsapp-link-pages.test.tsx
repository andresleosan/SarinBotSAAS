import { act, createElement, Fragment, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reauthenticateWithPopup, signOut } from 'firebase/auth';
import HelpPage from '@/app/ayuda/page';
import AdminAssistantPage from '@/app/admin/assistant/page';
import { PlatformWhatsAppLink } from '@/components/platform-whatsapp-link';
import { createLinkHarness, deferred, ids, response, syntheticCommand } from './platform-whatsapp-link-ui-fixtures';
const firebase = vi.hoisted(() => ({ user: null as User | null, listener: null as ((user: User | null) => Promise<void>) | null }));
vi.mock('@/lib/firebase/client', () => ({ getFirebaseClient: () => ({ auth: { currentUser: firebase.user } }) }));
vi.mock('firebase/auth', () => ({ GoogleAuthProvider: class {}, onIdTokenChanged: vi.fn((_auth, listener) => { firebase.listener = listener; return vi.fn(); }), signInWithPopup: vi.fn(), signInWithCredential: vi.fn(), signOut: vi.fn(), reauthenticateWithPopup: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => createElement('a', props, children) }));
vi.mock('@/components/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => createElement('main', { 'data-admin-shell': true }, children) }));
vi.mock('@/components/admin-copilot', () => ({ AdminCopilot: () => createElement('div', null, 'Copilot fixture') }));
vi.mock('@/components/admin-platform-whatsapp', () => ({ AdminPlatformWhatsApp: () => createElement('div', null, 'Reception fixture') }));
vi.mock('@/components/admin-whatsapp-conversations', () => ({ AdminWhatsAppConversations: () => createElement('div', null, 'Tenant conversations fixture') }));
// Preserve the actual page/AuthGate/owner-link flow while isolating unrelated sibling workspaces.
vi.mock('@/components/admin-payment-confirmation', () => ({ AdminPaymentConfirmation: () => null }));
vi.mock('@/components/admin-platform-support', () => ({ AdminPlatformSupport: () => null }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let h: ReturnType<typeof createLinkHarness>;
beforeEach(() => { firebase.user = null; firebase.listener = null; h = createLinkHarness(firebase); vi.mocked(reauthenticateWithPopup).mockReset().mockImplementation(async () => ({ user: h.user } as never)); vi.mocked(signOut).mockReset().mockImplementation(async () => { firebase.user = null; await firebase.listener?.(null); }); });
afterEach(async () => h.unmount());
const pending = () => { h.data.status = { ...h.data.status, revokeGeneration: ids.generation, pending: { challengeId: ids.challenge, revision: 1, expiresAt: Date.now() + 600000, maskedPhone: '••••0001', proof: 'verified' } }; };

describe('actual public Help and gated Admin owner integration', () => {
  it('retains public help and legal/commercial contact while logged out without owner reads or private input', async () => {
    await h.mount(createElement(HelpPage), false);
    expect(h.content()).toContain('La atención automatizada por WhatsApp todavía no está activa');
    expect(h.content()).toContain('Prueba pagada para el negocio'); expect(h.content()).toContain('alsdevstudio@alsdevstudio.com');
    expect(h.root().findAllByProps({ id: 'owner-whatsapp-phone' })).toHaveLength(0);
    expect(h.transport.mock.calls.some(([path]) => path === '/api/platform-whatsapp/link')).toBe(false);
    expect(h.command() === null).toBe(true);
  });
  it('allows a verified ordinary owner to link in Help while the actual admin gate stays closed', async () => {
    h.data.admin = false; await h.mount(createElement(Fragment, null, createElement(HelpPage), createElement(AdminAssistantPage)));
    expect(h.auth.isCurrentSession('owner-a', h.auth.authEpoch)).toBe(true); expect(h.auth.isSuperadmin).toBe(false);
    expect(h.content()).toContain('Acceso restringido'); expect(h.content()).not.toContain('Copilot fixture');
    await h.begin(); expect(h.command() === syntheticCommand).toBe(true);
    expect(h.content()).toContain('Soporte y consultas sobre datos');
  });
  it.each(['begin', 'confirm', 'revoke'] as const)('keeps the actual Admin workspace, command and immutable %s body across real popup + two same-UID listener validations', async action => {
    await h.mount(createElement(AdminAssistantPage)); await h.begin();
    if (action === 'confirm') { pending(); await h.focus(); }
    const panel = h.root().findByType(PlatformWhatsAppLink), commandNode = h.root().findByType('code');
    const epoch = h.auth.authEpoch;
    h.setMutation(async () => response({ code: 'LINK_RECENT_AUTH_REQUIRED' }, 428));
    if (action === 'begin') await h.begin(); else await h.click(action === 'confirm' ? 'Confirmar este número en la web' : 'Revocar vinculación de WhatsApp');
    const original = h.writes().at(-1)![1]?.body, count = h.writes().length;
    const first = deferred<Response>(), latest = deferred<Response>();
    const backend = h.transport.getMockImplementation()!;
    let sessions = 0;
    h.transport.mockImplementation((path, init) => path === '/api/session' ? (++sessions === 1 ? first.promise : latest.promise) : backend(path, init));
    vi.mocked(reauthenticateWithPopup).mockImplementationOnce(async () => { void firebase.listener?.(h.user); return { user: h.user } as never; });
    vi.mocked(h.user.getIdTokenResult).mockImplementationOnce(async () => { void firebase.listener?.(h.user); return { authTime: 'old-auth-time', issuedAtTime: 'new-token' } as never; });
    await h.click('Volver a verificar mi identidad');
    expect(sessions).toBe(2); expect(h.auth.authEpoch).toBe(epoch); expect(h.auth.loading).toBe(false);
    expect(h.root().findByType(PlatformWhatsAppLink) === panel).toBe(true);
    expect(h.root().findByType('code') === commandNode).toBe(true); expect(h.command() === syntheticCommand).toBe(true);
    expect(h.writes()).toHaveLength(count); expect(h.writes().at(-1)![1]?.body === original).toBe(true);
    await act(async () => latest.resolve(response({ isSuperadmin: true })));
    await act(async () => first.resolve(response({ isSuperadmin: false })));
    expect(h.root().findByType('code') === commandNode).toBe(true); expect(h.auth.authEpoch).toBe(epoch);
    await h.click('Reintentar la misma solicitud');
    expect(h.writes()).toHaveLength(count + 1); expect(h.writes().at(-1)![1]?.body === original).toBe(true);
  });
  it.each(['error', 'revoked', 'malformed', 'false', 'timeout'])('closes the actual private panel on current %s and preserves public help', async kind => {
    await h.mount(createElement(AdminAssistantPage)); await h.begin();
    const late = deferred<Response>(), backend = h.transport.getMockImplementation()!;
    h.transport.mockImplementation((path, init) => path === '/api/session' ? late.promise : backend(path, init));
    act(() => { void firebase.listener?.(h.user); });
    expect(h.command() === syntheticCommand).toBe(true);
    if (kind === 'timeout') {
      await act(async () => vi.advanceTimersByTimeAsync(10000));
      await act(async () => late.resolve(response({ isSuperadmin: true })));
    } else await act(async () => { if (kind === 'error') late.reject(Error('Session unavailable')); else late.resolve(response(kind === 'malformed' ? {} : { isSuperadmin: kind !== 'false' }, kind === 'revoked' ? 401 : 200)); });
    expect(h.command() === null).toBe(true); expect(h.content()).not.toContain('Copilot fixture'); expect(h.auth.isSuperadmin).toBe(false);
    if (kind !== 'false') { await h.emit(h.user); expect(h.auth.user).toBeNull(); }
    await h.unmount(); h = createLinkHarness(firebase);
    h.data.admin = false; await h.mount(createElement(HelpPage)); expect(h.content()).toContain('Soporte y consultas sobre datos');
  });
  it('does not extend the first actual-panel deadline when a later token validation supersedes it', async () => {
    await h.mount(createElement(AdminAssistantPage)); await h.begin();
    const first = deferred<Response>(), second = deferred<Response>(), backend = h.transport.getMockImplementation()!;
    let count = 0; h.transport.mockImplementation((path, init) => path === '/api/session' ? (++count === 1 ? first.promise : second.promise) : backend(path, init));
    act(() => { void firebase.listener?.(h.user); });
    await act(async () => vi.advanceTimersByTimeAsync(9000)); act(() => { void firebase.listener?.(h.user); });
    await act(async () => vi.advanceTimersByTimeAsync(999)); expect(Boolean(h.command())).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(1)); expect(h.command() === null).toBe(true);
    await act(async () => { second.resolve(response({ isSuperadmin: true })); first.resolve(response({ isSuperadmin: true })); });
    expect(h.command() === null).toBe(true); expect(h.auth.isSuperadmin).toBe(false);
  });
  it('ignores A late true after superseding B fails on the actual workspace', async () => {
    await h.mount(createElement(AdminAssistantPage)); await h.begin();
    const first = deferred<Response>(), second = deferred<Response>(), backend = h.transport.getMockImplementation()!;
    let count = 0; h.transport.mockImplementation((path, init) => path === '/api/session' ? (++count === 1 ? first.promise : second.promise) : backend(path, init));
    act(() => { void firebase.listener?.(h.user); void firebase.listener?.(h.user); });
    await act(async () => second.resolve(response({}, 401))); expect(h.command() === null).toBe(true);
    await act(async () => first.resolve(response({ isSuperadmin: true }))); expect(h.auth.user).toBeNull(); expect(h.command() === null).toBe(true);
  });
  it('starts logout synchronously for both panel mounts and ignores revalidation while Firebase logout is pending', async () => {
    await h.mount(createElement(Fragment, null, createElement(HelpPage), createElement(AdminAssistantPage)));
    const epoch = h.auth.authEpoch, predicate = h.auth.isCurrentSession, logout = deferred<void>();
    vi.mocked(signOut).mockReturnValueOnce(logout.promise);
    const backend = h.transport.getMockImplementation()!, session = deferred<Response>();
    h.transport.mockImplementation((path, init) => path === '/api/session' ? session.promise : backend(path, init));
    act(() => { void firebase.listener?.(h.user); });
    let pending!: Promise<void>;
    await act(async () => { pending = h.auth.signOut(); expect(predicate('owner-a', epoch)).toBe(false); });
    expect(h.root().findAllByProps({ id: 'owner-whatsapp-phone' })).toHaveLength(0);
    expect(h.content()).toContain('Prueba pagada para el negocio'); expect(h.auth.user).toBeNull();
    await act(async () => session.resolve(response({ isSuperadmin: true }))); expect(h.auth.user).toBeNull();
    await act(async () => { firebase.user = null; logout.resolve(); await pending; });
    expect(h.auth.authEpoch).toBeGreaterThan(epoch);
  });
  it('recovers a fast failed same-UID logout through fresh status/consent with a new epoch and no old command or retry', async () => {
    await h.mount(createElement(AdminAssistantPage)); await h.begin();
    h.setMutation(async () => response({ code: 'LINK_RECENT_AUTH_REQUIRED' }, 428)); await h.click('Revocar vinculación de WhatsApp');
    const epoch = h.auth.authEpoch, before = h.writes().length;
    vi.mocked(signOut).mockRejectedValueOnce(Error('Synthetic logout failed'));
    await act(async () => h.auth.signOut());
    expect(h.auth.authEpoch).toBeGreaterThan(epoch); expect(h.auth.user?.uid).toBe('owner-a');
    expect(h.command() === null).toBe(true); expect(h.button('Reintentar la misma solicitud')).toBeUndefined(); expect(h.writes()).toHaveLength(before);
    expect(h.transport.mock.calls.filter(([path]) => path === '/api/session').length).toBeGreaterThanOrEqual(2);
  });
});

it('keeps public Help present during its actual current-session error and nonextendable timeout', async () => {
  await h.mount(createElement(HelpPage)); await h.begin();
  const wait = deferred<Response>(), backend = h.transport.getMockImplementation()!;
  h.transport.mockImplementation((path, init) => path === '/api/session' ? wait.promise : backend(path, init));
  act(() => { void firebase.listener?.(h.user); });
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(h.command() === null).toBe(true); expect(h.content()).toContain('Prueba pagada para el negocio'); expect(h.content()).toContain('Soporte y consultas sobre datos');
  await act(async () => wait.resolve(response({ isSuperadmin: true })));
  expect(h.command() === null).toBe(true); expect(h.content()).toContain('Iniciar sesión para vincular WhatsApp');
});
it('does not mount the actual admin workspace for an initial unverified login or reopen after same-UID invalidation', async () => {
  const wait = deferred<Response>(), backend = h.transport.getMockImplementation()!;
  h.transport.mockImplementation((path, init) => path === '/api/session' ? wait.promise : backend(path, init));
  await h.mount(createElement(AdminAssistantPage), false);
  firebase.user = h.user; act(() => { void firebase.listener?.(h.user); });
  expect(h.content()).not.toContain('Copilot fixture'); expect(h.root().findAllByType(PlatformWhatsAppLink)).toHaveLength(0);
  await act(async () => wait.resolve(response({ isSuperadmin: true }))); await h.begin();
  const epoch = h.auth.authEpoch; await act(async () => h.auth.invalidateSession('owner-a', epoch));
  await h.emit(h.user); expect(h.command() === null).toBe(true); expect(h.content()).not.toContain('Copilot fixture');
});
it('requires fresh code-free reads after same-UID logout and relogin and rejects old action callbacks', async () => {
  await h.mount(createElement(AdminAssistantPage)); await h.begin();
  const stale = h.button('Revocar vinculación de WhatsApp').props.onClick, epoch = h.auth.authEpoch;
  await act(async () => h.auth.signOut()); await h.emit(h.user);
  expect(h.auth.authEpoch).toBeGreaterThan(epoch); expect(h.command() === null).toBe(true);
  await act(async () => stale()); expect(h.writes()).toHaveLength(1);
  expect(h.transport.mock.calls.filter(([path]) => path === '/api/platform-whatsapp/link').length).toBeGreaterThanOrEqual(3);
});
