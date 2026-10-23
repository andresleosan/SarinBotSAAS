import { act, createElement, type ReactNode } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AdminPage from '@/app/admin/page';

const state = vi.hoisted(() => ({
  api: vi.fn(), search: new URLSearchParams(),
  auth: { user: { uid: 'demo-admin' }, authEpoch: 1, isSuperadmin: true, signingOut: false },
  budget: { configured: true, version: 7, dayUsd: 0.25, monthUsd: 3, timezone: 'UTC', day: '2026-10-22', month: '2026-10', usage: { day: { usedMicros: 0, heldMicros: 0, blocked: false }, month: { usedMicros: 0, heldMicros: 0, blocked: false } } },
}));
vi.mock('@/lib/client/api', () => ({ apiFetch: state.api, errorMessage: (error: Error) => error.message }));
vi.mock('@/components/auth-provider', () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, useAuth: () => state.auth }));
vi.mock('@/components/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children, Notice: ({ children, error }: { children: ReactNode; error?: boolean }) => createElement('p', { role: error ? 'alert' : 'status' }, children), buttonClass: '', fieldClass: '' }));
vi.mock('@/hooks/useEngineHealth', () => ({ useEngineHealth: () => ({ health: null, refresh: vi.fn() }) }));
vi.mock('@/lib/client/use-api-poll', () => ({ useApiPoll: () => ({ value: state.budget, error: null, setValue: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/components/admin-ai-settings', () => ({ AdminAiSettings: () => null }));
vi.mock('@/components/admin-ai-budget', () => ({ AdminAiBudget: () => null }));
vi.mock('@/components/admin-ai-usage', () => ({ AdminAiUsage: () => null }));
vi.mock('@/components/admin-booking-data-policy', () => ({ AdminBookingDataPolicy: () => null }));
vi.mock('@/components/admin-whatsapp', () => ({ AdminWhatsApp: () => null }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin', useSearchParams: () => state.search, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => createElement('a', props, children) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const initial = { settings: { companyName: 'Sarin', bankAccounts: [] }, businesses: [{ id: 'demo-business', name: 'Synthetic business', ownerEmail: 'demo@example.test', subscription: { status: 'active', currentPeriodEndsAt: 0 } }], receipts: [{ id: 'old-payment', tenantName: 'Synthetic business', ownerEmail: 'demo@example.test', amountCOP: 19000, bankSelected: 'Synthetic bank', status: 'pending', submittedAt: 1 }], allowances: {} };
const invitation = { id: 'a'.repeat(24), recipientEmail: 'owner@example.test', maskedCode: 'SARIN-secret', codeState: 'available', state: 'issued', createdAt: 1900000000000, expiresAt: 1900600000000, version: 0, usage: null };
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
function deferred() { let resolve!: (value: unknown) => void; let reject!: (reason: Error) => void; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
let tree: ReactTestRenderer;
const focus = vi.fn(), scrollIntoView = vi.fn();
const record = { focus, scrollIntoView };
const panels = () => tree.root.findAll(node => node.type === 'section' && typeof node.props.inert === 'boolean');
const panel = (section: string) => tree.root.find(node => node.type === 'section' && node.props.id === `admin-${section}`);
const reads = () => state.api.mock.calls.filter(([path, init]) => /^\/api\/admin(?:\?|$)/.test(path) && !init?.method);
const patches = () => state.api.mock.calls.filter(([, init]) => init?.method === 'PATCH');
const company = () => tree.root.findAllByType('input').find(node => node.props.maxLength === 120 && node.props.required)!;
const button = (label: string) => tree.root.findAllByType('button').find(node => text(node).includes(label))!;
async function navigate(search: string, hash = '') {
  state.search = new URLSearchParams(search);
  Object.assign(window.location, { pathname: '/admin', search, hash });
  await act(async () => tree.update(createElement(AdminPage)));
}
async function mount(search = '', hash = '') {
  state.search = new URLSearchParams(search);
  Object.assign(window.location, { pathname: '/admin', search, hash });
  await act(async () => { tree = create(createElement(AdminPage)); });
}
beforeEach(() => {
  Object.assign(state.auth, { user: { uid: 'demo-admin' }, authEpoch: 1, isSuperadmin: true, signingOut: false });
  focus.mockReset(); scrollIntoView.mockReset();
  vi.stubGlobal('window', { location: { pathname: '/admin', search: '', hash: '' }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('document', { getElementById: (id: string) => id === 'payment-old-payment' || id === 'payment-next-payment' || id === 'admin-record-notice' ? record : null });
  state.api.mockReset().mockImplementation(async (path: string) => {
    if (path === '/api/admin?focusPayment=next-payment') return { ...initial, receipts: [{ ...initial.receipts[0], id: 'next-payment' }] };
    if (/^\/api\/admin(?:\?|$)/.test(path)) return initial;
    if (path === '/api/admin/invitations') return { invitations: [invitation], nextCursor: null };
    throw new Error(`Unexpected path ${path}`);
  });
});
afterEach(async () => { await act(async () => tree?.unmount()); vi.unstubAllGlobals(); });

it('oneConsoleSectionVisibleAllExistingComponentsMounted', async () => {
  await mount();
  expect(panels()).toHaveLength(11);
  expect(panels().filter(node => !node.props.hidden).map(node => node.props.id)).toEqual(['admin-overview']);
  const budget = tree.root.findByProps({ name: 'dayUsd' });
  const invitations = tree.root.findAllByType('input').find(node => node.props.type === 'email');
  await navigate('?module=access&section=invitations');
  expect(panels().filter(node => !node.props.hidden).map(node => node.props.id)).toEqual(['admin-invitations']);
  expect(tree.root.findByProps({ name: 'dayUsd' })).toBe(budget);
  expect(tree.root.findAllByType('input').find(node => node.props.type === 'email')).toBe(invitations);
  expect(panels().filter(node => node.props.hidden).every(node => node.props.inert)).toBe(true);
});

it('settingsDraftSurvivesModuleSwitchAndFocusedRead', async () => {
  await mount('?module=billing&section=settings');
  await act(async () => company().props.onChange({ target: { value: 'Local draft' } }));
  await act(async () => button('Actualizar bandeja').props.onClick());
  expect(company().props.value).toBe('Local draft');
  await navigate('?module=intelligence&section=provider');
  await navigate('?focusPayment=next-payment');
  await navigate('?module=billing&section=settings');
  expect(company().props.value).toBe('Local draft');
  expect(reads().map(([path]) => path)).toEqual(['/api/admin', '/api/admin', '/api/admin?focusPayment=next-payment', '/api/admin']);
  expect(patches()).toHaveLength(0);
});

it('hiddenBudgetKeepsDraftAndBusyAtSameRevision', async () => {
  await mount('?module=intelligence&section=platform-budget');
  await act(async () => tree.root.findByProps({ name: 'dayUsd' }).props.onChange({ target: { value: '0.5' } }));
  const pending = deferred();
  state.api.mockImplementationOnce(() => pending.promise);
  await act(async () => panel('platform-budget').findByType('form').props.onSubmit({ preventDefault() {} }));
  await navigate('?module=summary');
  expect(panel('platform-budget').props.hidden).toBe(true);
  await navigate('?module=intelligence&section=platform-budget');
  expect(tree.root.findByProps({ name: 'dayUsd' }).props.value).toBe('0.5');
  expect(tree.root.findByProps({ name: 'dayUsd' }).props.disabled).toBe(true);
  expect(JSON.parse(patches()[0][1].body)).toEqual({ expectedVersion: 7, dayUsd: 0.5, monthUsd: 3 });
  expect(patches()).toHaveLength(1);
  await act(async () => pending.resolve(state.budget));
});

it('invitationsKeepPendingCommand', async () => {
  await mount('?module=access&section=invitations');
  await act(async () => button('Revocar código').props.onClick());
  const reason = () => panel('invitations').findByProps({ maxLength: 300 });
  await act(async () => reason().props.onChange({ target: { value: 'Synthetic reason' } }));
  const pending = deferred(); state.api.mockImplementationOnce(() => pending.promise);
  await act(async () => { panel('invitations').findAllByType('form')[1].props.onSubmit({ preventDefault() {} }); });
  const command = patches()[0][1].body;
  await navigate('?module=summary'); await navigate('?module=access&section=invitations');
  expect(reason().props.value).toBe('Synthetic reason'); expect(reason().props.disabled).toBe(true);
  expect(patches()).toHaveLength(1); expect(patches()[0][1].body).toBe(command);
  await act(async () => pending.reject(new Error('Connection uncertain')));
  state.api.mockResolvedValueOnce({ invitation: { ...invitation, state: 'revoked' }, replayed: false });
  await act(async () => panel('invitations').findAllByType('form')[1].props.onSubmit({ preventDefault() {} }));
  expect(patches()[1][1].body).toBe(command);
});

it('moduleNavigationDoesNotPatch', async () => {
  await mount();
  for (const destination of ['?module=businesses', '?module=access', '?module=intelligence', '?module=billing', '']) await navigate(destination);
  expect(patches()).toHaveLength(0); expect(reads()).toHaveLength(1);
});

it('differentFocusedPaymentReloadsExactRead', async () => {
  await mount('?focusPayment=old-payment');
  const obsolete = deferred(); state.api.mockImplementationOnce(() => obsolete.promise);
  await navigate('?focusPayment=next-payment');
  const request = reads()[1];
  expect(request[0]).toBe('/api/admin?focusPayment=next-payment');
  expect(request[2]).toBe('demo-admin'); expect(request[3]()).toBe(true);
  await navigate('?module=billing');
  expect(request[1].signal.aborted).toBe(true); expect(request[3]()).toBe(false);
  await act(async () => obsolete.resolve({ ...initial, settings: { ...initial.settings, companyName: 'Stale' }, receipts: [] }));
  expect(tree.root.findAllByProps({ id: 'payment-old-payment' })).toHaveLength(1);
});

it('refreshDoesNotRefocusRecord', async () => {
  await mount('?focusPayment=old-payment');
  expect(focus).toHaveBeenCalledTimes(1);
  await act(async () => button('Actualizar bandeja').props.onClick());
  expect(focus).toHaveBeenCalledTimes(1);
  await navigate('?focusPayment=next-payment');
  expect(focus).toHaveBeenCalledTimes(2);
  expect(tree.root.findAllByProps({ id: 'admin-record-notice' })).toHaveLength(0);
});

it('missingRecordShowsCoverageNotice', async () => {
  await mount('', '#business-missing');
  expect(text(tree.root)).toContain('El registro enlazado no está entre los datos consultados');
  expect(tree.root.findAllByType('a').some(node => text(node) === 'Ir al resumen' && node.props.href === '/admin?module=summary&section=overview')).toBe(true);
  expect(focus).toHaveBeenCalledTimes(1);
});

it('roleOrEpochChangeDestroysPrivateWorkspace', async () => {
  await mount('?module=billing');
  await act(async () => company().props.onChange({ target: { value: 'Private draft' } }));
  state.auth.authEpoch++;
  await act(async () => tree.update(createElement(AdminPage)));
  expect(company().props.value).toBe('Sarin');
  state.auth.isSuperadmin = false;
  await act(async () => tree.update(createElement(AdminPage)));
  expect(tree.root.findAllByType('input')).toHaveLength(0);
  state.auth.isSuperadmin = true;
  await act(async () => tree.update(createElement(AdminPage)));
  expect(company().props.value).toBe('Sarin');
});

it('lateFocusedReadCannotPopulateNewAuthority', async () => {
  const late = deferred(); state.api.mockImplementationOnce(() => late.promise);
  await mount('?focusPayment=old-payment');
  const old = reads()[0];
  state.auth.user = { uid: 'demo-other' }; state.auth.authEpoch++;
  await act(async () => tree.update(createElement(AdminPage)));
  expect(old[1].signal.aborted).toBe(true); expect(old[3]()).toBe(false);
  await act(async () => late.resolve({ ...initial, settings: { ...initial.settings, companyName: 'Private old account' } }));
  expect(company().props.value).toBe('Sarin');
  expect(reads()[1][2]).toBe('demo-other');
});

it('directed404KeepsRecoveryNavigation', async () => {
  state.api.mockRejectedValueOnce(new Error('No se encontró el comprobante (404).'));
  await mount('?focusPayment=missing-payment');
  expect(text(tree.root)).toContain('No se pudo consultar el registro enlazado.');
  expect(focus).toHaveBeenCalledTimes(1);
  expect(tree.root.findAllByType('a').some(node => text(node) === 'Ir al resumen')).toBe(true);
  await navigate('?module=summary&section=overview');
  expect(panel('overview').props.hidden).toBe(false);
  expect(reads().map(([path]) => path)).toEqual(['/api/admin?focusPayment=missing-payment', '/api/admin']);
});

it('manualRefreshCannotPopulateAnotherDestination', async () => {
  await mount('?focusPayment=old-payment');
  const pending = deferred(); state.api.mockImplementationOnce(() => pending.promise);
  await act(async () => { button('Actualizar bandeja').props.onClick(); });
  const request = reads()[1];
  expect(request[2]).toBe('demo-admin'); expect(request[3]()).toBe(true);
  await navigate('?module=billing');
  expect(request[1].signal.aborted).toBe(true); expect(request[3]()).toBe(false);
  await act(async () => pending.resolve({ ...initial, receipts: [] }));
  expect(tree.root.findAllByProps({ id: 'payment-old-payment' })).toHaveLength(1);
});
