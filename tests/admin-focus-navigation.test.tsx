import { act, createElement, type ReactNode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AdminPage from '@/app/admin/page';
vi.mock('@/components/admin-platform-budget', () => ({ AdminPlatformBudget: () => null }));

const state = vi.hoisted(() => ({ api: vi.fn(), search: new URLSearchParams('focusPayment=old-payment') }));
vi.mock('@/lib/client/api', () => ({ apiFetch: state.api, errorMessage: (error: Error) => error.message }));
vi.mock('@/components/auth-provider', () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, useAuth: () => ({ user: { uid: 'admin' }, isSuperadmin: true, signOut: vi.fn() }) }));
vi.mock('@/components/consent-panel', () => ({ useAccountConsent: () => ({ active: true }), ConsentPanel: () => null }));
vi.mock('@/hooks/useEngineHealth', () => ({ useEngineHealth: () => ({ health: null, checking: false, refresh: vi.fn() }) }));
vi.mock('@/components/admin-ai-settings', () => ({ AdminAiSettings: () => null }));
vi.mock('@/components/admin-ai-usage', () => ({ AdminAiUsage: () => null }));
vi.mock('@/components/admin-ai-budget', () => ({ AdminAiBudget: () => createElement('span', {}, 'Budget controls') }));
vi.mock('@/components/admin-booking-data-policy', () => ({ AdminBookingDataPolicy: () => createElement('span', {}, 'Booking policy controls') }));
vi.mock('@/components/admin-invitations', () => ({ AdminInvitations: () => createElement('span', {}, 'Invitation controls') }));
vi.mock('@/components/admin-whatsapp', () => ({ AdminWhatsApp: () => null }));
vi.mock('@/components/sarin-brand', () => ({ SarinBrand: () => createElement('span', {}, 'SarinBot') }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin', useSearchParams: () => state.search, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => createElement('a', props, children) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer;
const focus = vi.fn(), scrollIntoView = vi.fn();
beforeEach(() => {
  focus.mockReset(); scrollIntoView.mockReset();
  vi.stubGlobal('window', { location: { pathname: '/admin', search: '?focusPayment=old-payment', hash: '#payment-old-payment' }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('document', { getElementById: (id: string) => id === 'payment-old-payment' ? { focus, scrollIntoView } : null });
  state.api.mockReset().mockResolvedValue({ settings: { bankAccounts: [] }, businesses: [{ id: 'demo-business', name: 'Synthetic business', ownerEmail: 'demo@example.test', subscription: { status: 'active', currentPeriodEndsAt: 0 } }], receipts: [{ id: 'old-payment', tenantName: 'Synthetic business', ownerEmail: 'demo@example.test', amountCOP: 19000, bankSelected: 'Synthetic bank', status: 'pending', submittedAt: 1 }], allowances: {} });
});
afterEach(async () => { await act(async () => renderer?.unmount()); vi.unstubAllGlobals(); });

it('loads and focuses the linked payment once while preserving focus during refresh', async () => {
  await act(async () => { renderer = create(createElement(AdminPage)); });
  expect(state.api.mock.calls[0][0]).toBe('/api/admin?focusPayment=old-payment');
  expect(renderer.root.findByProps({ id: 'payment-old-payment' }).props.tabIndex).toBe(-1);
  expect(renderer.root.findByProps({ id: 'business-demo-business' }).props.tabIndex).toBe(-1);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  const refresh = renderer.root.findAllByType('button').find(node => node.children.includes('Actualizar bandeja'))!;
  await act(async () => refresh.props.onClick());
  expect(state.api.mock.calls[1][0]).toBe('/api/admin?focusPayment=old-payment');
  expect(focus).toHaveBeenCalledTimes(1);
});

it('makes the assistant reachable from the console and its administrative navigation', async () => {
  await act(async () => { renderer = create(createElement(AdminPage)); });
  const links = renderer.root.findAllByType('a');
  expect(links.filter(node => node.props.href === '/admin/assistant')).toHaveLength(1);
  const navigation = renderer.root.findByProps({ 'aria-label': 'Navegaci\u00f3n de administraci\u00f3n' });
  expect(navigation.findAllByType('a').some(node => node.props.href === '/admin/assistant?section=query')).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain('Budget controls');
  expect(JSON.stringify(renderer.toJSON())).toContain('Booking policy controls');
  expect(JSON.stringify(renderer.toJSON())).toContain('Invitation controls');
});
