import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBusiness } from '@/hooks/useBusiness';
import { apiFetch } from '@/lib/client/api';

const state = vi.hoisted(() => ({ user: { uid: 'first' } as { uid: string } | null }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/lib/client/api', () => ({ apiFetch: vi.fn(), errorMessage: (error: Error) => error.message }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer;
function Probe() { const result = useBusiness(); return createElement('output', null, JSON.stringify(result)); }
function ControlProbe() { const result = useBusiness(); return createElement('button', { onClick: () => result.setBusiness(previous => previous ? { ...previous, name: 'Logo actualizado' } : previous), onDoubleClick: result.refresh }, JSON.stringify(result)); }
const value = () => JSON.parse(renderer.root.findByType('output').children.join(''));
beforeEach(() => { state.user = { uid: 'first' }; vi.mocked(apiFetch).mockReset(); });
afterEach(async () => { await act(async () => renderer?.unmount()); });

it('masks the previous owner and ignores late data when changing Google accounts', async () => {
  const pending: { signal: AbortSignal; resolve: (value: unknown) => void }[] = [];
  vi.mocked(apiFetch).mockImplementation((_path, init) => new Promise(resolve => pending.push({ signal: init!.signal as AbortSignal, resolve })));
  await act(async () => { renderer = create(createElement(Probe)); });
  state.user = { uid: 'second' };
  await act(async () => renderer.update(createElement(Probe)));
  expect(pending[0].signal.aborted).toBe(true);
  await act(async () => pending[0].resolve({ business: { id: 'private-first', ownerUid: 'first' } }));
  expect(value()).toMatchObject({ business: null, loading: true });
  await act(async () => pending[1].resolve({ business: { id: 'second-business', ownerUid: 'second' } }));
  expect(value()).toMatchObject({ business: { id: 'second-business' }, loading: false });
});

it('rejects a different owner in a response and does not poll after sign-out', async () => {
  vi.mocked(apiFetch).mockResolvedValue({ business: { id: 'other-private', ownerUid: 'other' } });
  await act(async () => { renderer = create(createElement(Probe)); });
  expect(value()).toMatchObject({ business: null, loading: false, error: 'No tienes acceso a este negocio.' });
  vi.mocked(apiFetch).mockClear();
  state.user = null;
  await act(async () => renderer.update(createElement(Probe)));
  expect(value()).toMatchObject({ business: null, loading: false, error: null });
  expect(apiFetch).not.toHaveBeenCalled();
});
it('exposes mutation invalidation and explicit refresh from the existing poller', async () => {
  vi.mocked(apiFetch).mockResolvedValue({ business: { id: 'business', ownerUid: 'first', name: 'Anterior' } });
  await act(async () => { renderer = create(createElement(ControlProbe)); });
  await act(async () => renderer.root.findByType('button').props.onClick());
  expect(renderer.root.findByType('button').children.join('')).toContain('Logo actualizado');
  await act(async () => renderer.root.findByType('button').props.onDoubleClick());
  expect(renderer.root.findByType('button').children.join('')).toContain('Anterior');
});
