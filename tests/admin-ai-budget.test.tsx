import { act, createElement } from 'react';
import { create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAiBudget } from '@/components/admin-ai-budget';
import { DEFAULT_AI_BUDGET_LIMITS } from '@/lib/server/ai-budget';
const state = vi.hoisted(() => ({ api: vi.fn(), uid: 'admin' }));
vi.mock('@/lib/client/api', () => ({ apiFetch: state.api, errorMessage: (error: Error) => error.message }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: { uid: state.uid }, isSuperadmin: true }) }));
vi.mock('@/components/app-shell', () => ({ Notice: ({ children, error }: any) => createElement('p', { role: error ? 'alert' : 'status' }, children), buttonClass: 'button', fieldClass: 'field' }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const counter = { usedTokens: 2500, reservedTokens: 3000, usedCostNanoUsd: 10000000, reservedCostNanoUsd: 20000000 };
const view = (businessId = 'one') => ({ businessId, name: businessId === 'one' ? 'Barbería Uno' : 'Negocio Dos', settings: { version: 4, paused: false, limits: DEFAULT_AI_BUDGET_LIMITS, reason: 'Setup', updatedAt: 1, updatedBy: 'admin' }, proposedLimits: DEFAULT_AI_BUDGET_LIMITS, gateEnabled: true, periods: { day: '2030-01-31', month: '2030-01' }, global: { day: counter, month: counter }, override: null, limits: { businessDayUsd: 0.1, businessMonthUsd: 2 }, usage: { day: counter, month: counter } });
const businesses = [{ id: 'one', name: 'Barbería Uno' }, { id: 'two', name: 'Negocio Dos' }];
function text(node: ReactTestInstance | string): string { return typeof node === 'string' ? node : node.children.map(text).join(''); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
describe('individual budget administration', () => {
  let renderer: ReactTestRenderer;
  const button = (label: string) => renderer.root.findAllByType('button').find(item => text(item) === label)!;
  const field = (name: string) => renderer.root.findAllByType('input').find(item => item.props.name === name)!;
  const form = () => renderer.root.findByProps({ 'aria-label': 'Límites del negocio' });
  const mount = async () => { await act(async () => { renderer = create(createElement(AdminAiBudget, { businesses })); }); };
  beforeEach(() => { state.uid = 'admin'; state.api.mockReset().mockImplementation(async () => view()); });
  afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); });
  it('shows recorded and reserved amounts and saves the selected business with current versions and identity', async () => {
    await mount();
    expect(text(renderer.root)).toContain('Reservado'); expect(text(renderer.root)).toContain('El presupuesto global sigue aplicándose');
    await act(async () => { field('businessDayUsd').props.onChange({ target: { value: '0.25' } }); field('businessMonthUsd').props.onChange({ target: { value: '3' } }); field('businessReason').props.onChange({ target: { value: 'Más consultas autorizadas' } }); });
    await act(async () => { form().props.onSubmit({ preventDefault() {} }); });
    const call = state.api.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(call[2]).toBe('admin');
    expect(JSON.parse(call[1].body)).toEqual({ action: 'configure_business', businessId: 'one', expectedVersion: 0, expectedSettingsVersion: 4, limits: { businessDayUsd: 0.25, businessMonthUsd: 3 }, reason: 'Más consultas autorizadas' });
    expect(text(renderer.root)).toContain('Límites guardados');
  });
  it('restores inherited values without erasing usage and requires refresh after an uncertain save', async () => {
    const customized = { ...view(), override: { version: 2, limits: { businessDayUsd: 0.25, businessMonthUsd: 3 } } };
    state.api.mockResolvedValue(customized); await mount();
    await act(async () => field('businessReason').props.onChange({ target: { value: 'Volver a la asignación general' } }));
    state.api.mockRejectedValueOnce(new Error('Respuesta perdida'));
    await act(async () => button('Restaurar límites generales').props.onClick());
    expect(JSON.parse(state.api.mock.calls.find(([, init]) => init?.method === 'PATCH')![1].body)).toMatchObject({ limits: null, expectedVersion: 2 });
    expect(button('Guardar límites del negocio').props.disabled).toBe(true);
    expect(text(renderer.root)).toContain('Actualiza');
    state.api.mockResolvedValue(view()); await act(async () => button('Actualizar presupuesto').props.onClick());
    expect(field('businessDayUsd').props.value).toBe('0.1'); expect(text(renderer.root)).toContain('Registrado');
  });
  it('discards a late read after switching businesses and clears the previous identity data', async () => {
    const late = deferred<ReturnType<typeof view>>();
    state.api.mockImplementation((path: string) => path.endsWith('=one') ? late.promise : Promise.resolve(view('two')));
    await mount();
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Negocio del presupuesto' }).props.onChange({ target: { value: 'two' } }));
    await act(async () => late.resolve(view()));
    expect(form().findAllByType('input').some(item => item.props.name === 'businessReason')).toBe(true);
    await act(async () => { field('businessReason').props.onChange({ target: { value: 'Segundo negocio' } }); });
    await act(async () => { form().props.onSubmit({ preventDefault() {} }); });
    expect(JSON.parse(state.api.mock.calls.find(([, init]) => init?.method === 'PATCH')![1].body).businessId).toBe('two');
    const next = deferred<ReturnType<typeof view>>(); state.api.mockReturnValue(next.promise); state.uid = 'other-admin';
    await act(async () => renderer.update(createElement(AdminAiBudget, { businesses })));
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
  });
});
