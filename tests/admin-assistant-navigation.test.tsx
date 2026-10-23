import { act, createElement, useState, type ReactNode } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AdminAssistantPage from '@/app/admin/assistant/page';
import type { AdminCopilotBusiness, AdminCopilotSnapshot } from '@/types/admin-copilot';
import type { PaymentActionView } from '@/types/admin-payment-actions';
import { LEGAL_VERSION, PLATFORM_SUPPORT_LEGAL_VERSION } from '@/lib/legal';

const state = vi.hoisted(() => ({ api: vi.fn(), search: '', uid: 'admin-a' as string | null, epoch: 1, admin: true, signingOut: false, push: vi.fn(), focus: vi.fn(), chatMount: vi.fn(), realSupport: false }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/assistant', useSearchParams: () => state.search, useRouter: () => ({ push: state.push }) }));
vi.mock('next/link', () => ({ default: ({ children, scroll: _scroll, ...props }: { children: ReactNode; scroll?: boolean }) => createElement('a', props, children) }));
vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: (...args: unknown[]) => state.api(...args) }));
vi.mock('@/lib/client/platform-whatsapp-reauth', () => ({ reauthenticatePlatformWhatsAppOwner: vi.fn() }));
vi.mock('@/components/auth-provider', () => ({
  useAuth: () => ({ user: state.uid ? { uid: state.uid } : null, loading: false, authEpoch: state.epoch, isSuperadmin: state.admin, signingOut: state.signingOut, invalidateSession: vi.fn(), isCurrentSession: (uid: string, epoch: number) => uid === state.uid && epoch === state.epoch && state.admin && !state.signingOut }),
  AuthGate: ({ children }: { children: ReactNode }) => state.uid && state.admin && !state.signingOut ? children : null,
}));
vi.mock('@/components/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => createElement('main', {}, children), Notice: ({ children, error }: { children: ReactNode; error?: boolean }) => createElement('p', { role: error ? 'alert' : 'status' }, children), buttonClass: 'button', fieldClass: 'field' }));
vi.mock('@/components/admin-platform-whatsapp', () => ({ AdminPlatformWhatsApp: ({ scope }: { scope: string | null }) => createElement('div', { 'data-platform': scope }, 'Canal de Sarin') }));
vi.mock('@/components/platform-whatsapp-link', () => ({ PlatformWhatsAppLink: () => createElement('div', {}, 'Vínculo de Sarin') }));
vi.mock('@/components/admin-whatsapp-conversations', () => ({ AdminWhatsAppConversations: ({ businesses }: { businesses: AdminCopilotBusiness[] }) => createElement('div', { 'data-businesses': businesses.map(b => b.id).join(',') }) }));
// Keep the support entry contract; race tests use the real chat with synthetic API transport.
vi.mock('@/components/platform-support-chat', async original => {
  const real = await original<typeof import('@/components/platform-support-chat')>();
  return { PlatformSupportChat: ({ admin, initialThread }: { admin: boolean; initialThread: string | null }) => {
    if (state.realSupport) return createElement(real.PlatformSupportChat, { admin, initialThread });
    return createElement(SupportDraft, { admin, initialThread });
  } };
});
function SupportDraft({ admin, initialThread }: { admin: boolean; initialThread: string | null }) {
  const [draft, setDraft] = useState('');
  state.chatMount(admin, initialThread);
  return createElement('textarea', { 'aria-label': 'Support draft', 'data-thread': initialThread, value: draft, onChange: (event: { target: { value: string } }) => setDraft(event.target.value) });
}
const consent = (scope: 'account' | 'platform_support') => {
  const documents = { scope, fingerprint: 'a'.repeat(64), version: scope === 'account' ? LEGAL_VERSION : PLATFORM_SUPPORT_LEGAL_VERSION };
  return { active: true, loading: false, withdrawalRequested: false, status: { active: true, revision: 1, documents, receipt: { uid: state.uid, scope, action: 'accept', termsAccepted: true, dataAuthorized: true, revision: 1, requestId: proposal, occurredAt: 1792252800000, documents } } };
};
vi.mock('@/components/consent-panel', () => ({ useAccountConsent: () => consent('account'), ConsentPanel: () => null }));
vi.mock('@/hooks/useConsent', () => ({ useConsent: () => consent('platform_support') }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const proposal = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const notice = 'Se conserva la tarea que tienes abierta. Abre este enlace en otra pestaña para revisar el destino sin descartarla';
const snapshot: AdminCopilotSnapshot = {
  generatedAt: 1792252800000, timeZone: 'America/Bogota', scopeBusinessId: null,
  coverage: { limit: 100, businessesLoaded: 1, businessesTruncated: false, paymentsLoaded: 1, paymentsTruncated: false, allowancesUnavailable: 0 },
  businesses: [{ id: 'synthetic', name: 'Synthetic', status: 'active', access: 'subscription', periodEndsAt: null, quotaState: 'active', remainingResponses: 10, usedResponses: 0 }],
  metrics: { businesses: 1, pendingPayments: 1, quotaWarnings: 0, quotaExhausted: 0, expiringSubscriptions: 0 }, attention: [],
  sources: [{ id: 'payment-fixture', kind: 'payment', businessId: 'synthetic', label: 'Pago sintético', detail: 'Pendiente', href: '/admin?focusPayment=fixture#payment-fixture' }],
};
let renderer: ReactTestRenderer | undefined;
let view: PaymentActionView;
const root = () => renderer!.root;
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const panel = (section: string) => root().findAllByType('section').find(node => node.props.id === `assistant-${section}`)!;
const button = (label: string) => root().findAllByType('button').find(node => text(node).includes(label))!;
const confirms = () => state.api.mock.calls.filter(([path]) => path.endsWith('/confirm'));
const targetedReads = () => state.api.mock.calls.filter(([path]) => path.includes('payment-actions?id='));
const click = async (label: string) => act(async () => button(label).props.onClick());
async function mount(search = '', hash = '') {
  state.search = search; Object.assign(window.location, { search, hash });
  await act(async () => { renderer = create(createElement(AdminAssistantPage), { createNodeMock: element => {
    const props = element.props as { id?: string; role?: string };
    return { focus: () => state.focus(props.id ?? props.role ?? element.type), querySelector: () => ({ focus: () => state.focus('assistant-web-support-title') }) };
  } }); });
}
async function go(search: string, hash = '') {
  state.search = search; Object.assign(window.location, { search, hash });
  await act(async () => renderer!.update(createElement(AdminAssistantPage)));
}
beforeEach(() => {
  Object.assign(state, { search: '', uid: 'admin-a', epoch: 1, admin: true, signingOut: false, realSupport: false });
  state.focus.mockReset(); state.push.mockReset(); state.chatMount.mockReset();
  vi.stubGlobal('window', { location: { pathname: '/admin/assistant', search: '', hash: '' }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'visible' });
  view = { proposal: { id: proposal, paymentId: 'fixture', action: 'approve', revision: 3, expiresAt: Date.now() + 300000, state: 'pending' }, business: { id: 'synthetic', name: 'Synthetic review' }, payment: { id: 'fixture', amountCOP: 89000, planId: 'monthly', kind: 'subscription', status: 'pending' }, effect: 'Synthetic effect' };
  state.api.mockReset().mockImplementation(async (path: string) => path.endsWith('/confirm')
    ? { business: view.business, payment: { ...view.payment, status: 'approved' }, effectId: 'synthetic-effect', reviewedAt: Date.now() }
    : path.includes('payment-actions') ? view : snapshot);
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('copilotHiddenStillFeedsBusinessesAndPayments', async () => {
  await mount('?section=business-whatsapp');
  expect(panel('query').props).toMatchObject({ hidden: true, inert: true });
  expect(panel('business-whatsapp').props.hidden).toBe(false);
  expect(root().findAllByType('section').filter(node => node.props.id?.startsWith('assistant-') && !node.props.hidden)).toHaveLength(1);
  expect(root().findByProps({ 'data-businesses': 'synthetic' })).toBeDefined();
  expect(root().findByProps({ 'aria-label': 'Pago pendiente consultado' }).findAllByType('option').map(text)).toContain('Pago sintético · Pendiente');
  expect(state.api.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
});
it('switchPreservesQuestionAndUncertainPaymentTuple', async () => {
  await mount(`?paymentAction=${proposal}`);
  await act(async () => root().findByProps({ name: 'adminQuestion' }).props.onChange({ target: { value: 'Private question' } }));
  state.api.mockRejectedValueOnce(new TypeError('unknown result')); await click('Confirmar aprobación');
  const original = confirms()[0];
  await go('?section=query');
  expect(root().findByProps({ name: 'adminQuestion' }).props.value).toBe('Private question');
  const sectionLinks = root().findByProps({ 'aria-label': 'Tareas del asistente y atención' }).findAllByType('a');
  expect(sectionLinks.map(node => node.props.href)).toEqual(['/admin/assistant?section=query', '/admin/assistant?section=payments', '/admin/assistant?section=platform-whatsapp', '/admin/assistant?section=business-whatsapp', '/admin/assistant?section=web-support']);
  expect(sectionLinks.filter(node => node.props['aria-current'] === 'page').map(text)).toEqual(['Consulta']);
  expect(panel('payments').props).toMatchObject({ hidden: true, inert: true });
  await go(`?paymentAction=${proposal}`); // Back to the exact entry target is still a later navigation.
  expect(text(root())).toContain(notice);
  expect(state.focus.mock.calls.at(-1)?.[0]).toBe('assistant-sensitive-notice');
  expect(button('Reintentar la misma confirmación')).toBeDefined();
  expect(targetedReads()).toHaveLength(1); expect(confirms()).toHaveLength(1);
  await go('?section=payments');
  await click('Reintentar la misma confirmación');
  expect(confirms()).toHaveLength(2);
  expect(confirms()[1][0]).toBe(original[0]); expect(confirms()[1][1].body).toBe(original[1].body);
  expect(JSON.parse(original[1].body)).toMatchObject({ expectedRevision: 3, requestId: expect.any(String), confirmed: true });
});
it('entryPaymentActionUrlReadsButNeverConfirms', async () => {
  await mount(`?paymentAction=${proposal}`);
  expect(panel('payments').props.hidden).toBe(false);
  expect(targetedReads().map(([path]) => path)).toEqual([`/api/admin/copilot/payment-actions?id=${proposal}`]);
  expect(text(root())).toContain('Synthetic review');
  expect(confirms()).toHaveLength(0); expect(text(root())).not.toContain(notice);
});
it('entrySupportUrlOpensCorrectThreadSection', async () => {
  await mount(`?support=${proposal}`);
  expect(panel('web-support').props.hidden).toBe(false);
  expect(root().findByProps({ 'aria-label': 'Support draft' }).props['data-thread']).toBe(proposal);
  await act(async () => root().findByProps({ 'aria-label': 'Support draft' }).props.onChange({ target: { value: 'Private support draft' } }));
  await go('?section=query'); await go(`?support=${other}`);
  expect(root().findByProps({ 'aria-label': 'Support draft' }).props).toMatchObject({ 'data-thread': proposal, value: 'Private support draft' });
  await go(`?support=${proposal}`);
  expect(text(root())).toContain(notice);
  expect(state.focus.mock.calls.at(-1)?.[0]).toBe('assistant-sensitive-notice');
  await go('?section=web-support');
  expect(root().findByProps({ 'aria-label': 'Support draft' }).props.value).toBe('Private support draft');
});
it('laterSensitiveDeepLinkOffersExplicitNewTabWithoutReplacingTask', async () => {
  await mount(`?paymentAction=${proposal}`);
  await go(`?paymentAction=${other}&ignored=private`);
  const link = root().findAllByType('a').find(node => node.props.target === '_blank')!;
  expect(link.props).toMatchObject({ href: `/admin/assistant?paymentAction=${other}`, rel: 'noopener noreferrer' });
  expect(text(root())).toContain(notice); expect(targetedReads()).toHaveLength(1); expect(confirms()).toHaveLength(0);
  expect(state.focus.mock.calls.at(-1)?.[0]).toBe('assistant-sensitive-notice');
  await go(`?support=${other}`);
  expect(root().findAllByType('a').find(node => node.props.target === '_blank')!.props.href).toBe(`/admin/assistant?support=${other}`);
  expect(state.chatMount).not.toHaveBeenCalled();
});
it('supportHashDoesNotAutoCreateConversation', async () => {
  await mount('', '#soporte-web');
  expect(panel('web-support').props.hidden).toBe(false);
  expect(button('Abrir soporte web').props['aria-expanded']).toBe(false);
  expect(state.chatMount).not.toHaveBeenCalled();
  expect(state.focus.mock.calls.at(-1)?.[0]).toBe('assistant-web-support-title');
  expect(state.api.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
});
it('conflictingTargetsShowRecoveryWithoutPrivateRead', async () => {
  await mount(`?paymentAction=${proposal}&support=${other}`);
  expect(panel('query').props.hidden).toBe(false);
  expect(text(root())).toContain('No pudimos abrir esa sección. Elige una tarea del menú');
  expect(targetedReads()).toHaveLength(0); expect(state.chatMount).not.toHaveBeenCalled();
  expect(root().findAllByType('a').some(node => node.props.href === '/admin/assistant?section=query')).toBe(true);
});
it('returnToQueryDoesNotGenerateInference', async () => {
  await mount(); await go('?section=platform-whatsapp'); await go('?section=query');
  expect(panel('query').props.hidden).toBe(false);
  expect(state.api.mock.calls).toHaveLength(1);
  expect(state.api.mock.calls[0][0]).toBe('/api/admin/copilot');
});
it.each(['uid', 'epoch', 'role', 'signingOut', 'logout'])('scopeChangeDropsAllHiddenPrivateState (%s)', async change => {
  await mount(`?support=${proposal}`);
  await act(async () => root().findByProps({ 'aria-label': 'Support draft' }).props.onChange({ target: { value: 'Private support draft' } }));
  await act(async () => root().findByProps({ name: 'adminQuestion' }).props.onChange({ target: { value: 'Private question' } }));
  await go('?section=payments');
  if (change === 'uid') state.uid = 'admin-b';
  if (change === 'epoch') state.epoch++;
  if (change === 'role') state.admin = false;
  if (change === 'signingOut') state.signingOut = true;
  if (change === 'logout') state.uid = null;
  await act(async () => renderer!.update(createElement(AdminAssistantPage)));
  expect(JSON.stringify(renderer!.toJSON())).not.toMatch(/Private question|Private support draft/);
  expect(root().findAllByProps({ 'aria-label': 'Support draft' })).toHaveLength(0);
});


it.each(['success', 'error'] as const)('pending payment %s cannot displace the notice after Back', async outcome => {
  let resolve!: (value: PaymentActionView) => void, reject!: (error: Error) => void;
  const pending = new Promise<PaymentActionView>((done, fail) => { resolve = done; reject = fail; });
  const original = state.api.getMockImplementation()!;
  state.api.mockImplementation((path: string, ...args: unknown[]) => path.includes('payment-actions?id=') ? pending : original(path, ...args));
  await mount(`?paymentAction=${proposal}`);
  const request = targetedReads()[0];
  await go('?section=query'); await go(`?paymentAction=${proposal}`);
  expect(state.focus.mock.calls.at(-1)?.[0]).toBe('assistant-sensitive-notice');
  const focused = state.focus.mock.calls.length;
  await act(async () => { if (outcome === 'success') resolve(view); else reject(new Error('Synthetic delayed failure')); });
  expect(text(root())).toContain(outcome === 'success' ? 'Synthetic review' : 'Synthetic delayed failure');
  expect(panel('payments').props.hidden).toBe(false);
  expect(state.focus).toHaveBeenCalledTimes(focused);
  expect(targetedReads()).toHaveLength(1); expect(targetedReads()[0]).toBe(request);
  expect(request[1].signal.aborted).toBe(false); expect(confirms()).toHaveLength(0);
});
it.each(['success', 'error'] as const)('pending payment %s cannot displace a different target notice', async outcome => {
  let resolve!: (value: PaymentActionView) => void, reject!: (error: Error) => void;
  const pending = new Promise<PaymentActionView>((done, fail) => { resolve = done; reject = fail; });
  const original = state.api.getMockImplementation()!;
  state.api.mockImplementation((path: string, ...args: unknown[]) => path.includes('payment-actions?id=') ? pending : original(path, ...args));
  await mount(`?paymentAction=${proposal}`); await go(`?paymentAction=${other}`);
  const focused = state.focus.mock.calls.length;
  expect(state.focus.mock.calls.at(-1)?.[0]).toBe('assistant-sensitive-notice');
  await act(async () => { if (outcome === 'success') resolve(view); else reject(new Error('Synthetic delayed failure')); });
  expect(state.focus).toHaveBeenCalledTimes(focused);
  expect(text(root())).toContain(outcome === 'success' ? 'Synthetic review' : 'Synthetic delayed failure');
  expect(targetedReads().map(([path]) => path)).toEqual([`/api/admin/copilot/payment-actions?id=${proposal}`]);
  expect(confirms()).toHaveLength(0);
});
it.each(['onKeyDownCapture', 'onClickCapture'] as const)('retained payment explicit %s restores result focus without refocusing the notice', async interaction => {
  await mount(`?paymentAction=${proposal}`);
  expect(state.focus.mock.calls.at(-1)?.[0]).toBe('h3');
  await go(`?paymentAction=${other}`);
  const focused = state.focus.mock.calls.length;
  const stateButton = button('Consultar estado de la propuesta');
  let ancestor = stateButton.parent;
  while (ancestor && !ancestor.props[interaction]) ancestor = ancestor.parent;
  await act(async () => ancestor?.props[interaction]({ key: 'Enter' }));
  await click('Consultar estado de la propuesta');
  expect(state.focus.mock.calls.slice(focused).map(([target]) => target)).toEqual(['h3']);
  expect(targetedReads()).toHaveLength(2); expect(confirms()).toHaveLength(0);
});
it('a pending hidden payment finishes without focusing its hidden review', async () => {
  let resolve!: (value: PaymentActionView) => void;
  const pending = new Promise<PaymentActionView>(done => { resolve = done; });
  const original = state.api.getMockImplementation()!;
  state.api.mockImplementation((path: string, ...args: unknown[]) => path.includes('payment-actions?id=') ? pending : original(path, ...args));
  await mount(`?paymentAction=${proposal}`); await go('?section=query');
  const focused = state.focus.mock.calls.length;
  await act(async () => resolve(view));
  expect(panel('payments').props).toMatchObject({ hidden: true, inert: true });
  expect(text(root())).toContain('Synthetic review');
  expect(state.focus).toHaveBeenCalledTimes(focused);
});
it.each(['notice', 'hidden', 'interaction'] as const)('pending real support send respects %s focus ownership', async destination => {
  state.realSupport = true;
  vi.spyOn(crypto.subtle, 'digest');
  let resolve!: (value: unknown) => void;
  const pending = new Promise(done => { resolve = done; });
  const original = state.api.getMockImplementation()!;
  state.api.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith('/messages') && init?.method === 'POST') return pending;
    if (path.includes('/messages')) return Promise.resolve({ messages: [], cursor: null, hasMore: false, observedAt: Date.now(), revision: 3, notificationStates: [] });
    if (path.endsWith('/conversations')) return Promise.resolve({ conversations: [], cursor: null, hasMore: false, observedAt: Date.now() });
    if (path.endsWith('/notifications')) return Promise.resolve({ configured: false, revision: 0, expiresAt: null });
    if (path.endsWith('/link')) return Promise.resolve({ available: true, current: null, pending: null, revokeGeneration: proposal });
    return original(path, init);
  });
  await mount(`?support=${proposal}`);
  await act(async () => root().findByProps({ id: 'support-message' }).props.onChange({ target: { value: 'Synthetic support send' } }));
  await act(async () => {
    button('Enviar mensaje').props.onClick();
    await Promise.all(vi.mocked(crypto.subtle.digest).mock.results.map(result => result.value));
    await new Promise<void>(done => setImmediate(done));
  });
  const sends = () => state.api.mock.calls.filter(([path, init]) => path.endsWith('/messages') && init?.method === 'POST');
  expect(sends()).toHaveLength(1);
  const request = sends()[0];
  await go(destination === 'hidden' ? '?section=query' : `?support=${other}`);
  const focused = state.focus.mock.calls.length;
  if (destination !== 'hidden') expect(state.focus.mock.calls.at(-1)?.[0]).toBe('assistant-sensitive-notice');
  if (destination === 'interaction') {
    let ancestor = root().findByProps({ id: 'support-message' }).parent;
    while (ancestor && !ancestor.props.onPointerDownCapture) ancestor = ancestor.parent;
    await act(async () => ancestor?.props.onPointerDownCapture({}));
  }
  await act(async () => resolve({ id: 'synthetic-message', sequence: 1, revision: 4 }));
  expect(text(root())).toContain('Mensaje confirmado en la web');
  expect(root().findByProps({ id: 'support-message' }).props).toMatchObject({ disabled: false, value: '' });
  expect(state.focus.mock.calls.slice(focused).map(([target]) => target)).toEqual(destination === 'interaction' ? ['support-message'] : []);
  expect(sends()).toHaveLength(1); expect(sends()[0]).toBe(request);
  expect(request[0]).toBe(`/api/admin/platform-support/conversations/${proposal}/messages`);
  expect(JSON.parse(request[1].body)).toMatchObject({ text: 'Synthetic support send', expectedRevision: 3, requestId: expect.any(String) });
  expect(request[1].signal.aborted).toBe(false);
});
