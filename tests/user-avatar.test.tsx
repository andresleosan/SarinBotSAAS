vi.mock('@/components/consent-panel', () => ({ useAccountConsent: () => ({ active: true }), ConsentPanel: () => null }));
import { act, createElement, type ReactNode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserAvatar } from '@/components/user-avatar';
import { AppShell } from '@/components/app-shell';

const state = vi.hoisted(() => ({ isSuperadmin: false, signOut: vi.fn(), user: { displayName: 'Cuenta sintética', email: 'fixture@example.test', photoURL: 'https://lh3.googleusercontent.com/synthetic-photo' } }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: state.user, signOut: state.signOut, isSuperadmin: state.isSuperadmin }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard/onboarding' }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode }) => createElement('a', props, children) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Google account avatar', () => {
  let renderer: ReactTestRenderer;
  afterEach(async () => { state.isSuperadmin = false; await act(async () => renderer?.unmount()); });
  async function mount(photoURL?: string | null) {
    await act(async () => { renderer = create(createElement(UserAvatar, { name: 'Ángela', photoURL })); });
  }

  it('renders the existing Google photo without sending a referrer', async () => {
    await mount('https://lh3.googleusercontent.com/synthetic-photo=s96-c');
    const image = renderer.root.findByType('img');
    expect(image.props.src).toBe('https://lh3.googleusercontent.com/synthetic-photo=s96-c');
    expect(image.props.referrerPolicy).toBe('no-referrer');
    expect(image.props.alt).toContain('Ángela');
  });

  it.each([
    undefined, null, '', 'http://lh3.googleusercontent.com/photo',
    'https://googleusercontent.com.attacker.test/photo', 'https://notgoogleusercontent.com/photo',
    'https://googleusercontent.com@attacker.test/photo', 'https://user:password@lh3.googleusercontent.com/photo',
    'https://lh3.googleusercontent.com:8443/photo', 'data:image/png;base64,c3ludGhldGlj',
  ])('uses the initial without an image request for %s', async (photoURL) => {
    await mount(photoURL);
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    expect(renderer.root.findByProps({ role: 'img' }).children).toEqual(['Á']);
  });

  it('falls back after a failed image and accepts a later different Google photo', async () => {
    await mount('https://lh3.googleusercontent.com/first');
    await act(async () => renderer.root.findByType('img').props.onError());
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    expect(renderer.root.findByProps({ role: 'img' }).children).toEqual(['Á']);
    await act(async () => renderer.update(createElement(UserAvatar, { name: 'Beatriz', photoURL: 'https://lh3.googleusercontent.com/second' })));
    expect(renderer.root.findByType('img').props.src).toBe('https://lh3.googleusercontent.com/second');
  });

  it('receives the signed-in account photo in the shell without changing sign out', async () => {
    state.signOut.mockClear();
    await act(async () => { renderer = create(createElement(AppShell, { children: 'Contenido' })); });
    expect(renderer.root.findAllByType('img').map(image => image.props.src)).toContain(state.user.photoURL);
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Cerrar sesión' }).props.onClick());
    expect(state.signOut).toHaveBeenCalledTimes(1);
  });

  it('keeps administration navigation focused on the commercial workspace', async () => {
    state.isSuperadmin = true;
    await act(async () => { renderer = create(createElement(AppShell, { admin: true, children: 'Contenido' })); });
    const navigation = renderer.root.findByProps({ 'aria-label': 'Navegación de administración' });
    expect(navigation.findAllByType('a').map(link => link.props.href)).toEqual(['/admin?module=summary&section=overview', '/admin?module=businesses&section=list', '/admin?module=access&section=receipts', '/admin?module=intelligence&section=provider', '/admin/assistant?section=query', '/admin?module=billing&section=settings', '/dashboard']);
  });
});
