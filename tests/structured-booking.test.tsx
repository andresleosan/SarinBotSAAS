import { act, createElement } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { StructuredBooking } from '@/components/structured-booking';
import { BookingProposal } from '@/components/booking-proposal';
import { bookingSubjectContent } from '@/lib/booking-subject-legal';
import { apiFetch } from '@/lib/client/api';
import type { BookingCapability, BookingSubjectCase } from '@/lib/booking-subject';
import type { PublicBusiness } from '@/types/firestore';
const authState = vi.hoisted(() => ({ uid: 'demo-user' }));
vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: { uid: authState.uid } }) }));
vi.mock('@/hooks/useEngineHealth', () => ({ useEngineHealth: () => { throw new Error('Structured booking must not mount inference health'); } }));
vi.mock('@/hooks/useDebouncedChat', () => ({ useDebouncedChat: () => { throw new Error('Structured booking must not mount chat'); } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const capability = { configured: true, revision: 1, dataMode: 'general' as const, representedMinorsEnabled: true };
const business = { id: 'demo-business', name: 'Demo', phoneWhatsApp: '573001234567', services: [{ id: 's', name: 'Corte', price: 10000, durationMinutes: 30, bufferMinutes: 10, resourceIds: ['r'] }], resources: [{ id: 'r', name: 'Recurso', active: true }], subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: 9999999999999 } } as unknown as PublicBusiness;
let renderer: ReactTestRenderer | undefined;
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; authState.uid = 'demo-user'; vi.mocked(apiFetch).mockReset(); });

function mockStructuredApi(currentCapability: BookingCapability, restrictedCaseAuthorized = false, availability = [{ resourceId: 'r', resourceName: 'Recurso', slots: ['09:00'] }]) {
  vi.mocked(apiFetch).mockImplementation(async (path, init) => {
    if (path.endsWith('/confirm')) return { appointment: { id: 'demo-confirmed', tenantId: business.id, client: { uid: authState.uid }, status: 'confirmed' } };
    if (path.endsWith('/booking-proposals')) return { proposal: { id: 'demo-self-proposal', businessId: business.id, serviceName: 'Corte', resourceName: 'Recurso', dateKey: '2030-01-01', startTimeStr: '09:00', endTimeStr: '09:30', priceCOP: 10000, intakeFields: [{ key: 'preference', label: 'Preferencia para la cita', required: false }], expiresAt: Date.now() + 600000 } };
    if (path.endsWith('/availability')) return { availability };
    const query = new URL(path, 'http://localhost').searchParams;
    const kind = query.get('subjectKind');
    const subjectCase: BookingSubjectCase = kind === 'self'
      ? { bookingRequestId: query.get('bookingRequestId')!, subjectKind: 'self' }
      : { bookingRequestId: query.get('bookingRequestId')!, subjectKind: 'represented_minor', representativeRole: query.get('representativeRole') as 'parent' | 'legal_guardian' };
    const required = currentCapability.dataMode === 'health' || subjectCase.subjectKind === 'represented_minor';
    const currentBusiness = { ...business, id: query.get('businessId') ?? business.id };
    return { required, active: required && restrictedCaseAuthorized, revision: restrictedCaseAuthorized ? 1 : 0, capability: currentCapability, receipt: null, documents: { ...bookingSubjectContent(currentBusiness, subjectCase, currentCapability), fingerprint: 'a'.repeat(64) } };
  });
}

function latestSubjectRead() {
  const call = vi.mocked(apiFetch).mock.calls.filter(([path]) => path.startsWith('/api/booking-subject-consent?')).at(-1)!;
  const query = new URL(call[0], 'http://localhost').searchParams;
  return { query, uid: call[2] };
}

async function click(label: string) {
  await act(async () => renderer!.root.findAllByType('button').find(button => button.children.join('') === label)!.props.onClick());
}

function textContent(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : textContent(child)).join('');
}

it.each([
  { availability: [] },
  { availability: [{ resourceId: 'r', resourceName: 'Recurso', slots: [] }, { resourceId: 'other', resourceName: 'Otro profesional', slots: [] }] },
])('offers another day or professional only after a successful empty availability search: %j', async ({ availability }) => {
  mockStructuredApi(capability, false, availability);
  await act(async () => { renderer = create(createElement(StructuredBooking, { business, capability, initialSubjectKind: 'self', onConfirmed: vi.fn() })); });
  const emptyNotices = () => renderer!.root.findAllByProps({ role: 'status' }).filter(node => textContent(node).includes('No hay horarios disponibles'));
  expect(emptyNotices()).toHaveLength(0);
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.onChange({ target: { value: 's' } }));
  await click('Consultar horarios');
  expect(emptyNotices()).toHaveLength(1);
  expect(textContent(emptyNotices()[0])).toBe('No hay horarios disponibles para esta selección. Prueba otro día o profesional.');
  expect(renderer!.root.findAllByType('fieldset')).toHaveLength(0);
  expect(renderer!.root.findByProps({ 'aria-label': 'Día de la reserva' }).props.disabled).toBe(false);
  expect(renderer!.root.findByProps({ 'aria-label': 'Recurso de la reserva' }).props.disabled).toBe(false);
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Día de la reserva' }).props.onChange({ target: { value: '2030-01-02' } }));
  expect(emptyNotices()).toHaveLength(0);
  expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path.endsWith('/availability'))).toHaveLength(1);
});

it('shows request failure without reporting empty availability while loading or after an error', async () => {
  mockStructuredApi(capability);
  await act(async () => { renderer = create(createElement(StructuredBooking, { business, capability, initialSubjectKind: 'self', onConfirmed: vi.fn() })); });
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.onChange({ target: { value: 's' } }));
  let reject!: (reason: Error) => void;
  vi.mocked(apiFetch).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  await click('Consultar horarios');
  expect(renderer!.root.findAllByProps({ role: 'status' }).some(node => textContent(node).includes('No hay horarios disponibles'))).toBe(false);
  expect(JSON.stringify(renderer!.toJSON())).toContain('Consultando horarios');
  await act(async () => reject(new Error('No se pudo consultar. Intenta otra vez.')));
  expect(JSON.stringify(renderer!.toJSON())).toContain('No se pudo consultar. Intenta otra vez.');
  expect(renderer!.root.findAllByProps({ role: 'status' }).some(node => textContent(node).includes('No hay horarios disponibles'))).toBe(false);
  expect(renderer!.root.findAllByType('button').find(button => button.children.join('') === 'Consultar horarios')!.props.disabled).toBe(false);
});

it('initializes a catalog service once without choosing a professional, searching or reserving', async () => {
  mockStructuredApi(capability);
  const services = [...business.services, { ...business.services[0], id: 'other', name: 'Consulta' }];
  const onInitialServiceHandled = vi.fn();
  const props = { business: { ...business, services }, capability, initialSubjectKind: 'self' as const, initialServiceId: 's', onInitialServiceHandled, onConfirmed: vi.fn() };
  await act(async () => { renderer = create(createElement(StructuredBooking, props)); });
  expect(renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.value).toBe('s');
  expect(renderer!.root.findByProps({ 'aria-label': 'Recurso de la reserva' }).props.value).toBe('');
  expect(renderer!.root.findAllByProps({ 'aria-pressed': true })).toHaveLength(0);
  expect(textContent(renderer!.root.findByProps({ 'aria-label': 'Detalles del servicio' }))).toContain('30 minutos');
  expect(renderer!.root.findAllByType('button').find(button => button.children.join('') === 'Revisar propuesta')!.props.disabled).toBe(true);
  expect(onInitialServiceHandled).toHaveBeenCalledTimes(1);
  expect(vi.mocked(apiFetch).mock.calls.every(([path]) => path.startsWith('/api/booking-subject-consent?'))).toBe(true);
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.onChange({ target: { value: 'other' } }));
  await act(async () => renderer!.update(createElement(StructuredBooking, { ...props, initialServiceId: undefined })));
  expect(renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.value).toBe('other');
  await click('Iniciar otra reserva');
  expect(renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.value).toBe('');
  expect(onInitialServiceHandled).toHaveBeenCalledTimes(1);
  expect(vi.mocked(apiFetch).mock.calls.every(([path]) => path.startsWith('/api/booking-subject-consent?'))).toBe(true);
});

it('consumes a removed service seed without selecting it or resetting later user changes', async () => {
  mockStructuredApi(capability);
  const onInitialServiceHandled = vi.fn();
  const props = { business, capability, initialSubjectKind: 'self' as const, initialServiceId: 'removed-service', onInitialServiceHandled, onConfirmed: vi.fn() };
  await act(async () => { renderer = create(createElement(StructuredBooking, props)); });
  expect(renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.value).toBe('');
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Detalles del servicio' })).toHaveLength(0);
  expect(onInitialServiceHandled).toHaveBeenCalledTimes(1);
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.onChange({ target: { value: 's' } }));
  await act(async () => renderer!.update(createElement(StructuredBooking, props)));
  expect(renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.value).toBe('s');
  expect(onInitialServiceHandled).toHaveBeenCalledTimes(1);
});

it.each(['account', 'business', 'subject'] as const)('does not transfer the initial service to a changed %s', async changed => {
  mockStructuredApi(capability, true);
  const onInitialServiceHandled = vi.fn();
  const props = { business, capability, initialSubjectKind: 'self' as 'self' | 'represented_minor', initialServiceId: 's', onInitialServiceHandled, onConfirmed: vi.fn() };
  await act(async () => { renderer = create(createElement(StructuredBooking, props)); });
  expect(renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.value).toBe('s');
  if (changed === 'account') authState.uid = 'demo-other-user';
  await act(async () => renderer!.update(createElement(StructuredBooking, {
    ...props,
    ...(changed === 'business' ? { business: { ...business, id: 'demo-other-business' } } : {}),
    ...(changed === 'subject' ? { initialSubjectKind: 'represented_minor' as const } : {}),
  })));
  expect(renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.value).toBe('');
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Detalles del servicio' })).toHaveLength(0);
  expect(onInitialServiceHandled).toHaveBeenCalledTimes(1);
  authState.uid = 'demo-user';
  await act(async () => renderer!.update(createElement(StructuredBooking, props)));
  expect(renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.value).toBe('');
  expect(onInitialServiceHandled).toHaveBeenCalledTimes(1);
});

it('shows selected service metadata as plain text with the customer duration and COP price', async () => {
  mockStructuredApi(capability);
  const service = { ...business.services[0], category: '  Cabello  ', description: '  Acabado <strong>natural</strong>\nIncluye asesoría.  ' };
  await act(async () => { renderer = create(createElement(StructuredBooking, { business: { ...business, services: [service] }, capability, initialSubjectKind: 'self', onConfirmed: vi.fn() })); });
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Detalles del servicio' })).toHaveLength(0);
  const initialRequests = vi.mocked(apiFetch).mock.calls.length;
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.onChange({ target: { value: 's' } }));
  const details = renderer!.root.findByProps({ 'aria-label': 'Detalles del servicio' });
  expect(textContent(details)).toContain('Cabello');
  expect(textContent(details)).toContain('Acabado <strong>natural</strong>\nIncluye asesoría.');
  expect(textContent(details)).toContain('30 minutos');
  expect(textContent(details)).toContain('10.000 COP');
  expect(textContent(details)).not.toContain('40 minutos');
  expect(details.findAllByType('strong')).toHaveLength(0);
  expect(vi.mocked(apiFetch).mock.calls).toHaveLength(initialRequests);
  await click('Consultar horarios'); await click('09:00'); await click('Revisar propuesta');
  expect(renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.disabled).toBe(true);
  expect(textContent(renderer!.root.findByProps({ 'aria-label': 'Detalles del servicio' }))).toContain('30 minutos');
});

it.each([
  { category: undefined, description: undefined },
  { category: '  ', description: '\n ' },
  { category: 42, description: { historic: true } },
  { category: 'c'.repeat(61), description: 'd'.repeat(301) },
])('replaces service details and clears the previous time with optional metadata %j', async metadata => {
  mockStructuredApi(capability);
  const services = [
    { ...business.services[0], category: 'Cabello', description: 'Descripción del corte' },
    { ...business.services[0], id: 'other', name: 'Consulta', price: 0, durationMinutes: 15, ...metadata },
  ] as PublicBusiness['services'];
  await act(async () => { renderer = create(createElement(StructuredBooking, { business: { ...business, services }, capability, initialSubjectKind: 'self', onConfirmed: vi.fn() })); });
  const select = () => renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' });
  await act(async () => select().props.onChange({ target: { value: 's' } }));
  await click('Consultar horarios'); await click('09:00');
  expect(renderer!.root.findByProps({ 'aria-label': 'Recurso de la reserva' }).props.value).toBe('r');
  const initialRequests = vi.mocked(apiFetch).mock.calls.length;
  await act(async () => select().props.onChange({ target: { value: 'other' } }));
  const details = renderer!.root.findByProps({ 'aria-label': 'Detalles del servicio' });
  expect(textContent(details)).toContain('15 minutos');
  expect(textContent(details)).toContain('0 COP');
  expect(textContent(details)).not.toContain('Cabello');
  expect(textContent(details)).not.toContain('Descripción del corte');
  expect(details.findAllByType('p')).toHaveLength(0);
  expect(renderer!.root.findByProps({ 'aria-label': 'Recurso de la reserva' }).props.value).toBe('');
  expect(renderer!.root.findAllByProps({ 'aria-pressed': true })).toHaveLength(0);
  expect(renderer!.root.findAllByType('button').find(button => button.children.join('') === 'Revisar propuesta')!.props.disabled).toBe(true);
  expect(vi.mocked(apiFetch).mock.calls).toHaveLength(initialRequests);
  for (const value of ['', 'removed-service']) {
    await act(async () => select().props.onChange({ target: { value } }));
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Detalles del servicio' })).toHaveLength(0);
  }
});

it.each([false, true])('general self booking stays adult-only when minor bookings are enabled: %s', async representedMinorsEnabled => {
  const general = { ...capability, representedMinorsEnabled };
  mockStructuredApi(general);
  const props = { business, capability: general, initialSubjectKind: 'self' as const, onConfirmed: vi.fn() };
  await act(async () => { renderer = create(createElement(StructuredBooking, props)); });
  const { query } = latestSubjectRead();
  expect(query.get('subjectKind')).toBe('self');
  expect(query.has('representativeRole')).toBe(false);
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Calidad del representante' })).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Nombre breve del menor' })).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Autorizar esta reserva' })).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Permisos de esta reserva' })).toHaveLength(0);
  expect(renderer!.root.findAllByType('input').filter(input => input.props.type === 'checkbox')).toHaveLength(0);
  expect(JSON.stringify(renderer!.toJSON())).toContain('Reserva con calendario');
  expect(renderer!.root.findAllByType('p')[0].children.join('')).toBe('Elige el servicio, el profesional y el horario que prefieras.');
  expect(renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.disabled).toBe(false);
});

it('general self booking uses the existing proposal contact and intake form without a representative', async () => {
  mockStructuredApi(capability);
  const onConfirmed = vi.fn();
  const props = { business, capability, initialSubjectKind: 'self' as const, onConfirmed };
  await act(async () => { renderer = create(createElement(StructuredBooking, props)); });
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.onChange({ target: { value: 's' } }));
  await click('Consultar horarios'); await click('09:00'); await click('Revisar propuesta');
  const requested = vi.mocked(apiFetch).mock.calls.find(([path]) => path.endsWith('/booking-proposals'))!;
  expect(JSON.parse(String(requested[1]?.body))).toMatchObject({ case: { subjectKind: 'self' }, beneficiary: { kind: 'self' } });
  expect(JSON.parse(String(requested[1]?.body)).case).not.toHaveProperty('representativeRole');
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Teléfono para la cita' }).props.onChange({ target: { value: '573001234567' } }));
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Preferencia para la cita' }).props.onChange({ target: { value: 'Preferencia sintética' } }));
  await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  const confirmation = vi.mocked(apiFetch).mock.calls.find(([path]) => path.endsWith('/confirm'))!;
  expect(JSON.parse(String(confirmation[1]?.body))).toEqual({ confirm: true, clientPhone: '573001234567', intakeAnswers: { preference: 'Preferencia sintética' }, beneficiary: { kind: 'self' } });
  expect(onConfirmed).toHaveBeenCalledWith(expect.objectContaining({ id: 'demo-confirmed' }));
  expect(vi.mocked(apiFetch).mock.calls.filter(([path, init]) => path.startsWith('/api/booking-subject-consent') && init?.method === 'POST')).toHaveLength(0);
});

it('starts a fresh case when the explicit subject, business or adult account changes', async () => {
  mockStructuredApi(capability, true);
  const onConfirmed = vi.fn();
  const minorProps = { business, capability, initialSubjectKind: 'represented_minor' as const, onConfirmed };
  await act(async () => { renderer = create(createElement(StructuredBooking, minorProps)); });
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Calidad del representante' }).props.onChange({ target: { value: 'legal_guardian' } }));
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Nombre breve del menor' }).props.onChange({ target: { value: 'Nombre sintético anterior' } }));
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.onChange({ target: { value: 's' } }));
  const minorCaseId = latestSubjectRead().query.get('bookingRequestId');
  const selfProps = { ...minorProps, initialSubjectKind: 'self' as const };
  await act(async () => renderer!.update(createElement(StructuredBooking, selfProps)));
  const selfRead = latestSubjectRead();
  expect(selfRead.query.get('subjectKind')).toBe('self');
  expect(selfRead.query.get('bookingRequestId')).not.toBe(minorCaseId);
  expect(selfRead.query.has('representativeRole')).toBe(false);
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Nombre breve del menor' })).toHaveLength(0);
  expect(renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.value).toBe('');
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Detalles del servicio' })).toHaveLength(0);
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.onChange({ target: { value: 's' } }));
  const nextBusinessProps = { ...selfProps, business: { ...business, id: 'demo-other-business' } };
  await act(async () => renderer!.update(createElement(StructuredBooking, nextBusinessProps)));
  const businessRead = latestSubjectRead();
  expect(businessRead.query.get('businessId')).toBe('demo-other-business');
  expect(businessRead.query.get('bookingRequestId')).not.toBe(selfRead.query.get('bookingRequestId'));
  expect(renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.value).toBe('');
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Detalles del servicio' })).toHaveLength(0);
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.onChange({ target: { value: 's' } }));
  authState.uid = 'demo-other-user';
  await act(async () => renderer!.update(createElement(StructuredBooking, nextBusinessProps)));
  const accountRead = latestSubjectRead();
  expect(accountRead.uid).toBe('demo-other-user');
  expect(accountRead.query.get('bookingRequestId')).not.toBe(businessRead.query.get('bookingRequestId'));
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Detalles del servicio' })).toHaveLength(0);
  await act(async () => renderer!.update(createElement(StructuredBooking, { ...nextBusinessProps, initialSubjectKind: 'represented_minor' as const })));
  const newMinorRead = latestSubjectRead();
  expect(newMinorRead.query.get('subjectKind')).toBe('represented_minor');
  expect(newMinorRead.query.get('representativeRole')).toBe('parent');
  expect(newMinorRead.query.get('bookingRequestId')).not.toBe(accountRead.query.get('bookingRequestId'));
  expect(renderer!.root.findByProps({ 'aria-label': 'Nombre breve del menor' }).props.value).toBe('');
});
it('minor name field appears only after current case authorization and role change resets it', async () => {
  vi.mocked(apiFetch).mockImplementation(async (path, init) => { const query = new URL(path, 'http://localhost').searchParams, body = init?.body ? JSON.parse(String(init.body)) : null, subjectCase = body?.case ?? { bookingRequestId: query.get('bookingRequestId')!, subjectKind: 'represented_minor' as const, representativeRole: query.get('representativeRole') as 'parent' }; return { required: true, active: init?.method === 'POST', revision: init?.method ? 1 : 0, capability, receipt: null, documents: { ...bookingSubjectContent(business, subjectCase, capability), fingerprint: 'a'.repeat(64) } }; });
  await act(async () => { renderer = create(createElement(StructuredBooking, { business, capability, onConfirmed: vi.fn() })); });
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Nombre breve del menor' })).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Detalles del servicio' })).toHaveLength(0);
  for (const checkbox of renderer!.root.findAllByType('input').filter(input => input.props.type === 'checkbox')) await act(async () => checkbox.props.onChange({ target: { checked: true } }));
  await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Nombre breve del menor' })).toHaveLength(1);
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Calidad del representante' }).props.onChange({ target: { value: 'legal_guardian' } }));
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Nombre breve del menor' })).toHaveLength(0);
  expect(renderer!.root.findAllByType('input').filter(input => input.props.type === 'checkbox').every(input => !input.props.checked)).toBe(true);
});
it('health books while inference is offline without mounting a chat', async () => {
  const health = { ...capability, dataMode: 'health' as const };
  vi.mocked(apiFetch).mockImplementation(async (path) => { const query = new URL(path, 'http://localhost').searchParams; return { required: true, active: false, revision: 0, capability: health, receipt: null, documents: { ...bookingSubjectContent(business, { bookingRequestId: query.get('bookingRequestId')!, subjectKind: 'self' }, health), fingerprint: 'a'.repeat(64) } }; });
  await act(async () => { renderer = create(createElement(StructuredBooking, { business, capability: health, onConfirmed: vi.fn() })); });
  expect(JSON.stringify(renderer!.toJSON())).toContain('Reserva sin IA'); expect(renderer!.root.findAllByProps({ 'aria-label': 'Mensaje para Sarin' })).toHaveLength(0);
});
it('retains the original uncertain request when minor capacity is disabled', async () => {
  const proposal = { id: 'demo-proposal', businessId: business.id, serviceName: 'Corte', resourceName: 'Recurso', dateKey: '2030-01-01', startTimeStr: '09:00', endTimeStr: '09:30', priceCOP: 10000, intakeFields: [], expiresAt: Date.now() + 600000 };
  vi.mocked(apiFetch).mockImplementation(async (path, init) => {
    if (path.endsWith('/confirm')) throw new Error('Respuesta perdida');
    if (path.endsWith('/booking-proposals')) return { proposal };
    if (path.endsWith('/availability')) return { availability: [{ resourceId: 'r', resourceName: 'Recurso', slots: ['09:00'] }] };
    const query = new URL(path, 'http://localhost').searchParams, subjectCase = { bookingRequestId: query.get('bookingRequestId')!, subjectKind: 'represented_minor' as const, representativeRole: 'parent' as const };
    return { required: true, active: true, revision: 1, capability, receipt: null, documents: { ...bookingSubjectContent(business, subjectCase, capability), fingerprint: 'a'.repeat(64) } };
  });
  const onConfirmed = vi.fn();
  await act(async () => { renderer = create(createElement(StructuredBooking, { business, capability, onConfirmed })); });
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Nombre breve del menor' }).props.onChange({ target: { value: 'Demo' } }));
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' }).props.onChange({ target: { value: 's' } }));
  const click = async (label: string) => act(async () => renderer!.root.findAllByType('button').find(button => button.children.join('') === label)!.props.onClick());
  await click('Consultar horarios'); await click('09:00'); await click('Revisar propuesta');
  await act(async () => renderer!.root.findByType(BookingProposal).props.onConfirm(proposal.id, { clientPhone: '573001234567', intakeAnswers: {} }));
  expect(renderer!.root.findByProps({ 'aria-label': 'Teléfono para la cita' }).props.disabled).toBe(true);
  const original = vi.mocked(apiFetch).mock.calls.find(call => call[0].endsWith('/confirm'))!;
  await act(async () => renderer!.update(createElement(StructuredBooking, { business, capability: { ...capability, representedMinorsEnabled: false }, enabled: false, onConfirmed })));
  await click('Recuperar confirmación');
  const replays = vi.mocked(apiFetch).mock.calls.filter(call => call[0].endsWith('/confirm'));
  expect(replays).toHaveLength(2); expect(replays[1][1]?.body).toBe(original[1]?.body);
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Nombre breve del menor' })).toHaveLength(0);
});
