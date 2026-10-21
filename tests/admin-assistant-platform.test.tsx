import { act, createElement, type ReactNode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AdminAssistantPage from '@/app/admin/assistant/page';
import type { AdminCopilotBusiness } from '@/types/admin-copilot';

const auth = vi.hoisted(() => ({ user: { uid: 'owner-a' } as { uid: string } | null, gateAdmin: false, shellAdmin: false }));
vi.mock('next/link', () => ({ default: ({ href, className, children }: { href: string; className?: string; children: ReactNode }) => createElement('a', { href, className }, children) }));
vi.mock('@/components/auth-provider', () => ({
  useAuth: () => ({ user: auth.user }),
  AuthGate: ({ admin, children }: { admin: boolean; children: ReactNode }) => { auth.gateAdmin = admin; return children; },
}));
vi.mock('@/components/app-shell', () => ({ AppShell: ({ admin, children }: { admin: boolean; children: ReactNode }) => { auth.shellAdmin = admin; return createElement('main', {}, children); } }));
vi.mock('@/components/admin-copilot', () => ({ AdminCopilot: ({ onBusinessesChange }: { onBusinessesChange: (businesses: AdminCopilotBusiness[]) => void }) => createElement('button', { onClick: () => onBusinessesChange([{ id: 'synthetic-business', name: 'Synthetic' } as AdminCopilotBusiness]) }, 'Copilot') }));
vi.mock('@/components/admin-platform-whatsapp', () => ({ AdminPlatformWhatsApp: ({ scope }: { scope: string | null }) => createElement('section', { 'data-platform': scope ?? 'signed-out' }, 'Platform') }));
vi.mock('@/components/platform-whatsapp-link', () => ({ PlatformWhatsAppLink: () => createElement('div', { 'data-owner-link': true }, 'Owner link') }));
vi.mock('@/components/admin-whatsapp-conversations', () => ({ AdminWhatsAppConversations: ({ businesses }: { businesses: AdminCopilotBusiness[] }) => createElement('section', { 'data-businesses': businesses.map(value => value.id).join(',') }, 'Commercial') }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined;
beforeEach(() => { auth.user = { uid: 'owner-a' }; auth.gateAdmin = false; auth.shellAdmin = false; });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; });

it('keeps admin boundaries, platform placement and exact SarinBot page copy', async () => {
  await act(async () => { renderer = create(createElement(AdminAssistantPage)); });
  expect(auth.gateAdmin).toBe(true); expect(auth.shellAdmin).toBe(true);
  expect(renderer!.root.findAllByType('section').map(node => node.props['data-platform'] ?? 'commercial')).toEqual(['owner-a', 'commercial']);
  const serialized = JSON.stringify(renderer!.toJSON());
  expect(serialized.indexOf('Copilot')).toBeLessThan(serialized.indexOf('Platform'));
  expect(serialized.indexOf('Platform')).toBeLessThan(serialized.indexOf('Commercial'));
  expect(serialized.indexOf('Platform')).toBeLessThan(serialized.indexOf('Owner link'));
  expect(serialized.indexOf('Owner link')).toBeLessThan(serialized.indexOf('Commercial'));
  expect(serialized).toContain('Consulta con SarinBot, revisa los pendientes y decide quién atiende cada conversación.');
  expect(renderer!.root.findByType('a').props.href).toBe('/admin');
  expect(renderer!.root.findByType('a').children).toEqual(['Volver al control de SarinBot']);
});
it('passes business state only to ordinary conversations and remounts it on UID/sign-out changes', async () => {
  await act(async () => { renderer = create(createElement(AdminAssistantPage)); });
  await act(async () => renderer!.root.findByType('button').props.onClick());
  expect(renderer!.root.findAllByType('section').map(node => node.props['data-platform'] ?? node.props['data-businesses'])).toEqual(['owner-a', 'synthetic-business']);
  auth.user = { uid: 'owner-b' }; await act(async () => renderer!.update(createElement(AdminAssistantPage)));
  expect(renderer!.root.findAllByType('section').map(node => node.props['data-platform'] ?? node.props['data-businesses'])).toEqual(['owner-b', '']);
  auth.user = null; await act(async () => renderer!.update(createElement(AdminAssistantPage)));
  expect(renderer!.root.findAllByType('section').map(node => node.props['data-platform'] ?? node.props['data-businesses'])).toEqual(['signed-out', '']);
});
