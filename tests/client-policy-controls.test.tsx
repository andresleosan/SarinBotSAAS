import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/client/api', () => ({ apiFetch: state.api, errorMessage: (e: Error) => e.message }));
import { ClientPolicyControls } from '@/components/client-policy-controls';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe('owner client policy controls', () => {
  let renderer: ReactTestRenderer;
  afterEach(async () => { await act(async () => renderer?.unmount()); state.api.mockReset(); });
  it('saves an explicit default limit with its reason', async () => {
    state.api.mockResolvedValue({ policy: { blocked: false, futureAppointmentLimit: 3, reason: null } });
    await act(async () => { renderer = create(createElement(ClientPolicyControls, { businessId: 'one', ownerUid: 'owner', clients: [] })); });
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Máximo de citas futuras' }).props.onChange({ target: { value: '5' } }));
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Motivo del cambio' }).props.onChange({ target: { value: 'Clientes frecuentes' } }));
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    expect(JSON.parse(state.api.mock.calls.at(-1)![1].body)).toEqual({ futureAppointmentLimit: 5, reason: 'Clientes frecuentes' });
  });
  it('discards a response after switching owners', async () => {
    let resolve!: (v: unknown) => void;
    state.api.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValue({ policy: { blocked: false, futureAppointmentLimit: 3, reason: null } });
    await act(async () => { renderer = create(createElement(ClientPolicyControls, { businessId: 'old', ownerUid: 'old-owner', clients: [] })); });
    await act(async () => renderer.update(createElement(ClientPolicyControls, { businessId: 'new', ownerUid: 'new-owner', clients: [] })));
    await act(async () => resolve({ policy: { blocked: true, futureAppointmentLimit: 20, reason: 'private old reason' } }));
    expect(renderer.root.findByProps({ 'aria-label': 'Máximo de citas futuras' }).props.value).toBe('3');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('private old reason');
  });
});
