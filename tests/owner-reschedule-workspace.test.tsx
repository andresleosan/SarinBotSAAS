import { act, createElement } from 'react';
import { create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useOwnerReschedule } from '@/hooks/use-owner-reschedule';
import { OwnerRescheduleWorkspace } from '@/components/owner-reschedule-workspace';
import { apiFetch } from '@/lib/client/api';
import type { OwnerRescheduleEntry } from '@/lib/owner-rescheduling';
import { ownerRescheduleBusiness as business, ownerRescheduleSource as original, ownerRescheduleView as view, ownerRescheduleResult as proof, ownerRescheduleNow as now } from './owner-rescheduling-contract';

const auth = vi.hoisted(() => ({ user: { uid: 'demo-owner' }, authEpoch: 1, isCurrentSession: () => true, invalidateSession: vi.fn() }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => auth }));
vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer, controller!: ReturnType<typeof useOwnerReschedule>;
const onClose = vi.fn(), onViewCurrentDay = vi.fn();
const source = { appointment: original, expectation: { sourceRevision: 0, sourceFingerprint: 'a'.repeat(64) }, eligible: true, reason: null };
function Harness({ retired = false, entry = { appointmentId: original.id } }: { retired?: boolean; entry?: OwnerRescheduleEntry }) {
  controller = useOwnerReschedule({ ownerUid: 'demo-owner', authEpoch: 1, businessId: business.id, entry, enabled: true, business: retired ? { ...business, resources: business.resources.map(item => ({ ...item, active: item.id !== 'demo-chair' })) } : business });
  return createElement(OwnerRescheduleWorkspace, { controller, onClose, onViewCurrentDay });
}
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join(' ').replace(/\s+/g, ' ').trim();
const button = (label: string) => renderer.root.findAllByType('button').find(node => text(node) === label)!;
const click = async (label: string) => act(async () => button(label).props.onClick());
const change = async (label: string, value: string) => act(async () => renderer.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } }));
const mutations = () => vi.mocked(apiFetch).mock.calls.filter(call => /\/(proposals|confirm)$/.test(call[0]));
async function mount(props: Parameters<typeof Harness>[0] = {}) { await act(async () => { renderer = create(createElement(Harness, props)); }); }
async function review() { await click('Consultar horarios'); await change('Nueva hora', '10:00'); await click('Revisar cambio'); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); onClose.mockReset(); onViewCurrentDay.mockReset();
  vi.mocked(apiFetch).mockReset().mockImplementation(async (path, init) => {
    if (path.endsWith('/availability')) return { availability: [{ resourceId: 'demo-chair', resourceName: 'Profesional uno', slots: ['10:00'] }] };
    if (path.endsWith('/proposals')) return { proposal: { ...view, requestId: JSON.parse(init!.body as string).requestId } };
    return source;
  });
});
afterEach(async () => { await act(async () => renderer?.unmount()); vi.useRealTimers(); });

it('threeStepsDoNotMutateOnSelection', async () => {
  await mount(); expect(text(renderer.root)).toContain('Consultar origen'); expect(text(renderer.root)).toContain('Elegir horario'); expect(text(renderer.root)).toContain('Revisar y confirmar');
  await change('Nueva fecha', '2030-01-14'); await change('Profesional', 'demo-second'); expect(mutations()).toHaveLength(0);
  expect(controller.selection.startTimeStr).toBe('');
});
it('beforeAfterShowsPriceAndBuffer', async () => {
  await mount(); await review(); const content = text(renderer.root);
  expect(content).toContain('Antes'); expect(content).toContain('Propuesto'); expect(content).toContain('20.000'); expect(content).toContain('25.000');
  expect(content).toContain('15 min'); expect(content).toContain('Profesional uno'); expect(content).toContain('no aparta el horario');
  expect(mutations()).toHaveLength(1); expect(button('Confirmar cambio')).toBeTruthy();
});
it('noExternalMessageOrPaymentPromise', async () => {
  await mount(); await review(); expect(text(renderer.root)).toContain('Este cambio no procesa cobros ni envía avisos externos');
});
it.each(['restricted_policy', 'source_started', 'unsupported_source', 'service_unavailable', 'subscription_unavailable', 'business_unconfigured'])('healthMinorAndStartedReasonsAreClear (%s)', async reason => {
  vi.mocked(apiFetch).mockResolvedValueOnce({ ...source, eligible: false, reason }); await mount();
  expect(renderer.root.findAllByProps({ 'aria-label': 'Nueva hora' })).toHaveLength(0); expect(button('Confirmar cambio')).toBeUndefined();
  expect(renderer.root.findAllByProps({ role: 'status' }).some(node => text(node).length > 20)).toBe(true); expect(mutations()).toHaveLength(0);
});
it('noSlotDifferentFromValidatedResponseCanBeProposed', async () => {
  await mount(); await click('Consultar horarios'); await change('Nueva hora', '23:00');
  expect(controller.selection.startTimeStr).toBe(''); expect(button('Revisar cambio').props.disabled).toBe(true);
  await click('Revisar cambio'); expect(mutations()).toHaveLength(0);
});
it('uncertainStateOffersSameConfirmationOnly', async () => {
  await mount(); await review(); vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Respuesta perdida')); await click('Confirmar cambio');
  expect(text(renderer.root)).toContain('Resultado por comprobar'); expect(button('Recuperar la misma confirmación')).toBeTruthy();
  expect(button('Cerrar cambio').props.disabled).toBe(true); await click('Cerrar cambio'); expect(onClose).not.toHaveBeenCalled();
});
it('sourceDetailsDoNotRepeatPrivateAnswers', async () => {
  await mount(); await review(); expect(text(renderer.root)).not.toMatch(/573001234567|demo@example|Respuesta sintética|retired_question/);
  const details = renderer.root.findAllByType('details'); expect(details.some(node => text(node).includes('Qué conserva este cambio') && node.props.open !== true)).toBe(true);
});
it('inactiveOriginRequiresExplicitTargetAndNoHourIsPreselected', async () => {
  await mount({ retired: true }); expect(controller.selection).toEqual({ dateKey: '2030-01-07', resourceId: '', startTimeStr: '' });
  expect(renderer.root.findByProps({ 'aria-label': 'Profesional' }).props.value).toBe(''); expect(mutations()).toHaveLength(0);
});
it('applied proof and a later current position remain distinct and navigation is explicit', async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce({ proposal: view, state: 'applied', result: proof, appointment: { ...original, status: 'cancelled_by_owner', rescheduleRevision: 2 } });
  await mount({ entry: { proposalId: view.id } }); const content = text(renderer.root);
  expect(content).toContain('Este cambio'); expect(content).toContain('Estado actual de la cita'); expect(content).toContain('10:00'); expect(content).toContain('09:00');
  expect(content).not.toContain('Salir sin cambiar');
  expect(onViewCurrentDay).not.toHaveBeenCalled(); await click('Ver día actualizado'); expect(onViewCurrentDay).toHaveBeenCalledWith('2030-01-07'); expect(mutations()).toHaveLength(0);
});
it('a later current resource and price remain visible beside the original reviewed result', async () => {
  const current = { ...original, resourceId: 'demo-second', serviceName: 'Corte posterior', price: 30000, rescheduleRevision: 2 };
  vi.mocked(apiFetch).mockResolvedValueOnce({ proposal: view, state: 'applied', result: proof, appointment: current });
  await mount({ entry: { proposalId: view.id } }); const content = text(renderer.root);
  expect(content).toContain('Profesional dos'); expect(content).toContain('30.000'); expect(content).toContain('Corte posterior'); expect(content).toContain('25.000');
});
