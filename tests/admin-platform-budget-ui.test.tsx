import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminPlatformBudget } from '@/components/admin-platform-budget';
const f = vi.hoisted(() => ({ auth: { user: { uid: 'demo-admin' }, isSuperadmin: true, signingOut: false, authEpoch: 1 }, value: null as any, fetch: vi.fn(), refresh: vi.fn(), setValue: vi.fn() }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => f.auth }));
vi.mock('@/components/app-shell', () => ({ Notice: ({ children }: any) => <p>{children}</p>, buttonClass: '', fieldClass: '' }));
vi.mock('@/lib/client/api', () => ({ apiFetch: (...args: unknown[]) => f.fetch(...args), errorMessage: () => 'No se pudo guardar.' }));
vi.mock('@/lib/client/use-api-poll', () => ({ useApiPoll: () => ({ value: f.value, error: null, setValue: f.setValue, refresh: f.refresh }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let tree: ReactTestRenderer | null;
beforeEach(() => {
  tree = null; f.auth.isSuperadmin = true; f.auth.signingOut = false; f.fetch.mockReset(); f.refresh.mockReset(); f.setValue.mockReset();
  f.value = { configured: true, version: 7, dayUsd: 0.25, monthUsd: 3, timezone: 'UTC', day: '2026-10-22', month: '2026-10', usage: { day: { usedMicros: 10000, heldMicros: 20000, blocked: false }, month: { usedMicros: 40000, heldMicros: 20000, blocked: false } } };
});
afterEach(async () => { await act(async () => tree?.unmount()); });
async function mount() { await act(async () => { tree = create(<AdminPlatformBudget />); }); return tree!; }
it('shows approved limits and pending usage without writing on load or edit', async () => {
  const t = await mount();
  expect(t.root.findByProps({ name: 'dayUsd' }).props.value).toBe('0.25');
  expect(t.root.findByProps({ name: 'monthUsd' }).props.value).toBe('3');
  expect(JSON.stringify(t.toJSON())).toContain('Reservado o pendiente');
  await act(async () => t.root.findByProps({ name: 'dayUsd' }).props.onChange({ target: { value: '0.5' } }));
  expect(f.fetch).not.toHaveBeenCalled();
  f.fetch.mockResolvedValue({ ...f.value, version: 8, dayUsd: 0.5 });
  await act(async () => t.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  expect(f.fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(f.fetch.mock.calls[0][1].body)).toEqual({ expectedVersion: 7, dayUsd: 0.5, monthUsd: 3 });
});
it('hides controls on loss of administrative authority and never retries a conflicting save', async () => {
  const t = await mount(); f.fetch.mockRejectedValue({ status: 409 });
  await act(async () => t.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  expect(f.refresh).toHaveBeenCalledTimes(1); expect(f.fetch).toHaveBeenCalledTimes(1);
  await act(async () => t.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  expect(f.fetch).toHaveBeenCalledTimes(1);
  f.auth.isSuperadmin = false; await act(async () => t.update(<AdminPlatformBudget />));
  expect(t.toJSON()).toBeNull();
});
