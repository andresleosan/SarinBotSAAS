import { act, createElement } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { StructuredBooking } from '@/components/structured-booking';
import { ClientWaitlist } from '@/components/client-waitlist';
import { apiFetch } from '@/lib/client/api';
import type { WaitlistController } from '@/hooks/use-waitlist';
import type { PublicBusiness } from '@/types/firestore';
import type { WaitlistRequestView } from '@/types/waitlist';

const access = vi.hoisted(() => ({ active: true }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: { uid: 'demo-client' } }) }));
vi.mock('@/hooks/useBookingSubjectConsent', () => ({ useBookingSubjectConsent: () => ({ active: access.active, loading: false, error: null, status: { required: false } }) }));
vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const business = { id: 'demo-business', phoneWhatsApp: '573000000000', services: [{ id: 'cut', name: 'Corte vigente', price: 15000, durationMinutes: 30, bufferMinutes: 5, resourceIds: ['one'] }], resources: [{ id: 'one', name: 'Profesional vigente', active: true }], subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: 9999999999999 } } as unknown as PublicBusiness;
const request: WaitlistRequestView = { id: 'demo-entry', serviceId: 'cut', dateKey: '2030-01-01', resourceId: 'one', subjectKind: 'self', createdAt: 1000, expiresAt: 9999999999999, status: 'waiting', checkedAt: 1000 };
const controller = (patch: Partial<WaitlistController> = {}): WaitlistController => ({ data: { businessId: business.id, ownerUid: 'demo-client', revision: 0, serverNow: 1000, request: null }, request: null, loading: false, readError: null, actionError: null, busy: false, reconciling: false, operation: null, join: vi.fn(async () => {}), cancel: vi.fn(async () => {}), refresh: vi.fn(async () => {}), canResume: () => true, ...patch });
let renderer: ReactTestRenderer | undefined;
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const buttons = (label: string) => renderer!.root.findAllByType('button').filter(item => text(item) === label);
const field = (label: string) => renderer!.root.findByProps({ 'aria-label': label });
const click = async (label: string) => act(async () => { expect(buttons(label)).toHaveLength(1); await buttons(label)[0].props.onClick(); });
const props = { business, capability: { configured: true, revision: 1, dataMode: 'general' as const, representedMinorsEnabled: false }, initialSubjectKind: 'self' as const, initialServiceId: 'cut', onConfirmed: vi.fn() };
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; access.active = true; vi.mocked(apiFetch).mockReset(); });

it('offers joining only for a current successful empty search and sends its case and exact professional filter', async () => {
  const waitlist = controller(); await act(async () => { renderer = create(createElement(StructuredBooking, { ...props, waitlist })); });
  expect(buttons('Apuntarme a la lista de espera')).toHaveLength(0);
  await act(async () => field('Día de la reserva').props.onChange({ target: { value: '2030-01-01' } }));
  await act(async () => field('Recurso de la reserva').props.onChange({ target: { value: 'one' } }));
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Sin conexión')); await click('Consultar horarios'); expect(buttons('Apuntarme a la lista de espera')).toHaveLength(0);
  vi.mocked(apiFetch).mockResolvedValueOnce({ availability: [] }); await click('Consultar horarios'); await click('Apuntarme a la lista de espera');
  expect(waitlist.join).toHaveBeenCalledWith({ case: { bookingRequestId: expect.any(String), subjectKind: 'self' }, serviceId: 'cut', dateKey: '2030-01-01', resourceId: 'one' });
  const retained = buttons('Apuntarme a la lista de espera')[0].props.onClick;
  await act(async () => field('Día de la reserva').props.onChange({ target: { value: '2030-01-02' } }));
  expect(buttons('Apuntarme a la lista de espera')).toHaveLength(0); await act(async () => retained()); expect(waitlist.join).toHaveBeenCalledTimes(1);
});
it.each(['permission', 'enabled', 'subscription', 'pending', 'request'] as const)('blocks retained joining after %s changes', async gate => {
  const waitlist = controller(); await act(async () => { renderer = create(createElement(StructuredBooking, { ...props, waitlist })); });
  vi.mocked(apiFetch).mockResolvedValueOnce({ availability: [] }); await click('Consultar horarios'); const retained = buttons('Apuntarme a la lista de espera')[0].props.onClick;
  if (gate === 'permission') access.active = false;
  await act(async () => renderer!.update(createElement(StructuredBooking, { ...props, waitlist: { ...waitlist, ...(gate === 'pending' ? { busy: true } : {}), ...(gate === 'request' ? { request } : {}) }, ...(gate === 'enabled' ? { enabled: false } : {}), ...(gate === 'subscription' ? { business: { ...business, subscription: { ...business.subscription, status: 'suspended' } } } : {}) })));
  await act(async () => retained()); expect(waitlist.join).not.toHaveBeenCalled();
});
it('consumes date and professional hints once and starts a new represented case without prior personal data', async () => {
  const hint = { serviceId: 'cut', dateKey: '2030-01-01', resourceId: 'one', subjectKind: 'represented_minor' as const, representativeRole: 'legal_guardian' as const };
  await act(async () => { renderer = create(createElement(StructuredBooking, { ...props, capability: { ...props.capability, representedMinorsEnabled: true }, initialBookingHint: hint })); });
  expect(field('Servicio de la reserva').props.value).toBe('cut'); expect(field('Día de la reserva').props.value).toBe('2030-01-01'); expect(field('Recurso de la reserva').props.value).toBe('one');
  expect(field('Calidad del representante').props.value).toBe('legal_guardian'); expect(field('Nombre breve del menor').props.value).toBe('');
  expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
  await click('Iniciar otra reserva'); expect(field('Servicio de la reserva').props.value).toBe(''); expect(field('Recurso de la reserva').props.value).toBe(''); expect(field('Día de la reserva').props.value).not.toBe('2030-01-01');
});
it('does not label a failed or reconciling read as an empty waitlist', async () => {
  await act(async () => { renderer = create(createElement(ClientWaitlist, { controller: controller({ readError: 'Sin conexión' }), services: [], resources: [], actionsLocked: false, canResume: true, onChoose: vi.fn() })); });
  expect(text(renderer!.root)).not.toContain('No tienes una solicitud'); expect(buttons('Reintentar lista de espera')).toHaveLength(1);
  await act(async () => renderer!.update(createElement(ClientWaitlist, { controller: controller({ reconciling: true, busy: true }), services: [], resources: [], actionsLocked: false, canResume: true, onChoose: vi.fn() })));
  expect(text(renderer!.root)).not.toContain('No tienes una solicitud');
});
it('shows removed catalog options legibly and permits leaving a suspended request without booking permission', async () => {
  const waitlist = controller({ request: { ...request, status: 'suspended', reason: 'service_unavailable', checkedAt: null } });
  await act(async () => { renderer = create(createElement(ClientWaitlist, { controller: waitlist, services: [], resources: [], actionsLocked: false, canResume: false, onChoose: vi.fn() })); });
  expect(text(renderer!.root)).toContain('Servicio no disponible'); expect(text(renderer!.root)).toContain('Profesional no disponible'); expect(text(renderer!.root)).not.toContain('undefined');
  expect(buttons('Salir de la lista')[0].props.disabled).toBe(false); await click('Salir de la lista'); expect(waitlist.cancel).toHaveBeenCalledTimes(1); expect(buttons('Elegir horario')).toHaveLength(0);
});
it('offers an explicit fresh booking only for available status and blocks while another action is locked', async () => {
  const chosen = vi.fn(), waitlist = controller({ request: { ...request, status: 'available' } });
  const panel = (actionsLocked: boolean) => createElement(ClientWaitlist, { controller: waitlist, services: business.services, resources: business.resources, actionsLocked, canResume: true, onChoose: chosen });
  await act(async () => { renderer = create(panel(false)); }); expect(text(renderer!.root)).toContain('hasta que salgas'); await click('Elegir horario'); expect(chosen).toHaveBeenCalledWith(waitlist.request, 0);
  const retained = buttons('Elegir horario')[0].props.onClick; await act(async () => renderer!.update(panel(true))); await act(async () => retained()); expect(chosen).toHaveBeenCalledTimes(1);
});
it('moves focus to the saved request once after a mutation without stealing focus on availability refresh', async () => {
  const focus = vi.fn(), scrollIntoView = vi.fn();
  const panel = (value: WaitlistController) => createElement(ClientWaitlist, { controller: value, services: business.services, resources: business.resources, actionsLocked: false, canResume: true, onChoose: vi.fn() });
  await act(async () => { renderer = create(panel(controller()), { createNodeMock: element => element.type === 'section' ? { focus, scrollIntoView } : null }); });
  expect(focus).not.toHaveBeenCalled();
  const saved = controller({ data: { businessId: business.id, ownerUid: 'demo-client', revision: 1, serverNow: 1000, request }, request });
  await act(async () => renderer!.update(panel(saved))); expect(focus).toHaveBeenCalledTimes(1); expect(scrollIntoView).toHaveBeenCalledTimes(1);
  await act(async () => renderer!.update(panel({ ...saved, request: { ...request, status: 'available' } }))); expect(focus).toHaveBeenCalledTimes(1);
});
