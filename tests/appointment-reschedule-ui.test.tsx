import { act, createElement } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppointmentReschedule } from '@/components/appointment-reschedule';
import { apiFetch } from '@/lib/client/api';
import { bookingSubjectContent } from '@/lib/booking-subject-legal';
import type { Appointment, PublicBusiness } from '@/types/firestore';
import type { BookingCapability, BookingSubjectCase } from '@/lib/booking-subject';
const state = vi.hoisted(() => ({ authorized: false, caseReads: [] as BookingSubjectCase[] }));
vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const now = Date.parse('2030-01-01T15:00:00Z');
const business = { id: 'demo-shop', name: 'Negocio', slug: 'shop', phoneWhatsApp: '573000000000', services: [{ id: 'cut', name: 'Corte actual', price: 40000, durationMinutes: 40, bufferMinutes: 5, resourceIds: ['chair'] }], resources: [{ id: 'chair', name: 'Profesional actual', active: true }], sarinConfig: { onboardingCompleted: true, intakeFields: [{ key: 'new', label: 'Pregunta actual', required: true }] }, subscription: { status: 'active', currentPeriodEndsAt: 9999999999999 } } as PublicBusiness;
const source: Appointment = { id: 'demo-visit', tenantId: business.id, type: 'appointment', status: 'confirmed', serviceId: 'cut', serviceName: 'Corte anterior', resourceId: 'chair', dateKey: '2030-01-02', startTimeStr: '09:00', endTimeStr: '09:30', startAt: Date.parse('2030-01-02T14:00:00Z'), endAt: Date.parse('2030-01-02T14:30:00Z'), reservedUntilAt: Date.parse('2030-01-02T14:30:00Z'), price: 30000, client: { uid: 'demo-client', name: 'Adulto', email: '', phone: '573000000000', intakeAnswers: { old: 'original' } }, beneficiary: { kind: 'represented_minor', displayName: 'Menor demo', representativeRole: 'legal_guardian' }, representationReview: { revision: 2, status: 'reviewed', reviewedBy: 'demo-owner', reviewedAt: 1 }, createdAt: 1, createdBy: 'sarin_client' };
const capability: BookingCapability = { configured: true, revision: 1, dataMode: 'health', representedMinorsEnabled: true };
type Props = Parameters<typeof AppointmentReschedule>[0];
let renderer: ReactTestRenderer | undefined, props: Props;
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const button = (label: string) => renderer!.root.findAllByType('button').find(node => text(node) === label)!;
const field = (label: string) => renderer!.root.findByProps({ 'aria-label': label });
async function mount(extra: Partial<Props> = {}) { props = { ...props, ...extra }; await act(async () => { renderer = create(createElement(AppointmentReschedule, props)); }); }
async function update(extra: Partial<Props> = {}) { props = { ...props, ...extra }; await act(async () => renderer!.update(createElement(AppointmentReschedule, props))); }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); state.authorized = false; state.caseReads = [];
  props = { uid: 'demo-client', source, business, capability, enabled: true, sourceCurrent: true, onConfirmed: vi.fn(), onCancel: vi.fn(), onLockedChange: vi.fn() };
  vi.mocked(apiFetch).mockReset().mockImplementation(async (path, init) => {
    if (path.startsWith('/api/booking-subject-consent?')) {
      const query = new URL(path, 'http://localhost').searchParams, subjectCase = { bookingRequestId: query.get('bookingRequestId')!, subjectKind: query.get('subjectKind')!, ...(query.has('representativeRole') ? { representativeRole: query.get('representativeRole')! } : {}) } as BookingSubjectCase;
      state.caseReads.push(subjectCase); const docs = bookingSubjectContent(props.business, subjectCase, props.capability);
      return { required: docs.requirements.dataAuthorized, active: state.authorized, revision: 0, receipt: null, capability: props.capability, documents: { ...docs, fingerprint: 'a'.repeat(64) } };
    }
    if (path.endsWith('/reschedule/availability')) return { availability: [{ resourceId: 'chair', resourceName: 'Profesional actual', slots: ['10:00'] }] };
    if (path.endsWith('/reschedule/proposals')) { const body = JSON.parse(init!.body as string); return { proposal: { id: 'demo-change-proposal', businessId: business.id, serviceName: 'Corte actual', resourceName: 'Profesional actual', dateKey: body.selection.dateKey, startTimeStr: '10:00', endTimeStr: '10:40', priceCOP: 40000, expiresAt: now + 600000, intakeFields: [], subjectCase: body.case, reschedule: { appointmentId: source.id, sourceRevision: 0, source: { dateKey: source.dateKey, startTimeStr: source.startTimeStr, endTimeStr: source.endTimeStr, resourceId: source.resourceId, priceCOP: source.price }, targetServiceId: 'cut', targetResourceId: 'chair' } } }; }
    throw new Error(`Unexpected path ${path}`);
  });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); });

it('asks current health and representation choices for a new fixed case before offering schedule fields', async () => {
  await mount(); expect(state.caseReads).toHaveLength(1); expect(state.caseReads[0]).toMatchObject({ subjectKind: 'represented_minor', representativeRole: 'legal_guardian' }); expect(state.caseReads[0].bookingRequestId).not.toBe(source.subjectAuthorization?.bookingRequestId);
  expect(field('Permisos de esta reserva')).toBeDefined(); expect(renderer!.root.findAllByProps({ 'aria-label': 'Nuevo día de la cita' })).toHaveLength(0);
  expect(renderer!.root.findAllByType('select')).toHaveLength(0); expect(text(renderer!.root)).toContain('Menor demo'); expect(apiFetch).toHaveBeenCalledOnce();
  expect(renderer!.root.findAllByType('input').filter(input => input.props.type !== 'checkbox')).toHaveLength(0);
});

it('keeps the fixed case mounted and blocks a retained return while its authorization is being saved', async () => {
  await mount(); const retainedReturn = button('Volver a Mis citas').props.onClick;
  const readSubject = vi.mocked(apiFetch).getMockImplementation()!;
  let finish!: (value: unknown) => void;
  vi.mocked(apiFetch).mockImplementation((path, init, uid) => path === '/api/booking-subject-consent' ? new Promise(resolve => { finish = resolve; }) : readSubject(path, init, uid));
  for (const checkbox of renderer!.root.findAllByType('input')) await act(async () => checkbox.props.onChange({ target: { checked: true } }));
  let pending!: Promise<void>;
  await act(async () => { pending = renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  expect(button('Volver a Mis citas').props.disabled).toBe(true); expect(props.onLockedChange).toHaveBeenLastCalledWith(true);
  await act(async () => retainedReturn()); expect(props.onCancel).not.toHaveBeenCalled();
  const subjectCase = state.caseReads[0]; state.authorized = true;
  await act(async () => { finish(await readSubject(`/api/booking-subject-consent?${new URLSearchParams({ businessId: business.id, ...subjectCase })}`)); await pending; });
  expect(field('Nuevo día de la cita')).toBeDefined(); expect(button('Volver a Mis citas').props.disabled).toBe(false);
});

it('shows source versus current proposal and confirms without a new phone, intake input or AI', async () => {
  state.authorized = true; await mount(); expect(field('Nuevo día de la cita').props.value).toBe('');
  await act(async () => field('Nuevo día de la cita').props.onChange({ target: { value: '2030-01-03' } }));
  await act(async () => button('Consultar nuevos horarios').props.onClick()); await act(async () => button('10:00').props.onClick()); await act(async () => button('Revisar cambio de horario').props.onClick());
  expect(text(field('Propuesta de cambio de horario'))).toContain('Anterior'); expect(text(field('Propuesta de cambio de horario'))).toContain('Propuesto'); expect(text(field('Propuesta de cambio de horario'))).toContain('40.000'); expect(text(field('Propuesta de cambio de horario'))).toContain('30.000');
  expect(renderer!.root.findAllByType('input')).toHaveLength(0); expect(renderer!.root.findAllByProps({ 'aria-label': 'Destinatario de la reserva' })).toHaveLength(0); expect(renderer!.root.findAllByProps({ 'aria-label': 'Servicio de la reserva' })).toHaveLength(0);
  expect(vi.mocked(apiFetch).mock.calls.some(([path]) => /chat|next/.test(path))).toBe(false);
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error('lost'));
  await act(async () => button('Confirmar cambio de horario').props.onClick()); expect(button('Volver a Mis citas').props.disabled).toBe(true); expect(button('Recuperar cambio de horario')).toBeDefined();
  const call = vi.mocked(apiFetch).mock.calls.at(-1)!; expect(JSON.parse(call[1]!.body as string)).toEqual({ confirm: true, clientPhone: null, intakeAnswers: {}, beneficiary: source.beneficiary });
  await update({ enabled: false, sourceCurrent: false }); await act(async () => button('Recuperar cambio de horario').props.onClick()); expect(vi.mocked(apiFetch).mock.calls.at(-1)![1]!.body).toBe(call[1]!.body);
});

it('keeps a legacy beneficiary absent and allows only the unrestricted general path without a subject read', async () => {
  await mount({ source: { ...source, beneficiary: undefined }, capability: { ...capability, dataMode: 'general', representedMinorsEnabled: false } }); expect(state.caseReads).toEqual([]); expect(field('Nuevo día de la cita')).toBeDefined(); expect(text(renderer!.root)).toContain('sin beneficiario declarado');
});
it('preserves an uncertain legacy confirmation when current policy becomes restricted', async () => {
  await mount({ source: { ...source, beneficiary: undefined }, capability: { ...capability, dataMode: 'general', representedMinorsEnabled: false } });
  await act(async () => field('Nuevo día de la cita').props.onChange({ target: { value: '2030-01-03' } })); await act(async () => button('Consultar nuevos horarios').props.onClick()); await act(async () => button('10:00').props.onClick()); await act(async () => button('Revisar cambio de horario').props.onClick());
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error('lost')); await act(async () => button('Confirmar cambio de horario').props.onClick());
  const original = vi.mocked(apiFetch).mock.calls.at(-1)!;
  await update({ capability: { ...capability, dataMode: 'health' } });
  expect(button('Recuperar cambio de horario')).toBeDefined(); vi.mocked(apiFetch).mockRejectedValueOnce(new Error('still lost'));
  await act(async () => button('Recuperar cambio de horario').props.onClick()); expect(vi.mocked(apiFetch).mock.calls.at(-1)![1]!.body).toBe(original[1]!.body); expect(state.caseReads).toEqual([]);
});
it.each([{ dataMode: 'health' as const, representedMinorsEnabled: false }, { dataMode: 'general' as const, representedMinorsEnabled: true }])('routes restricted legacy identity to business contact without inventing a case: %j', async policy => {
  await mount({ source: { ...source, beneficiary: undefined }, capability: { ...capability, ...policy } }); expect(apiFetch).not.toHaveBeenCalled(); expect(renderer!.root.findAllByProps({ 'aria-label': 'Nuevo día de la cita' })).toHaveLength(0); expect(text(renderer!.root)).toContain('Contacta directamente');
});

it('reports a successful empty daily search honestly and requires a manual next date', async () => {
  await mount({ source: { ...source, beneficiary: undefined }, capability: { ...capability, dataMode: 'general', representedMinorsEnabled: false } });
  vi.mocked(apiFetch).mockResolvedValueOnce({ availability: [] }); await act(async () => field('Nuevo día de la cita').props.onChange({ target: { value: '2030-01-03' } })); await act(async () => button('Consultar nuevos horarios').props.onClick());
  expect(text(renderer!.root)).toContain('No hay horarios disponibles'); expect(text(renderer!.root)).not.toContain('Buscar próxima fecha'); expect(vi.mocked(apiFetch).mock.calls).toHaveLength(1);
});

it('blocks a proposal after the catalog or current source changes without removing recovery', async () => {
  state.authorized = true; await mount(); const retained = button('Consultar nuevos horarios').props.onClick;
  await update({ business: { ...business, services: [{ ...business.services[0], price: 45000 }] } }); vi.mocked(apiFetch).mockClear(); await act(async () => retained()); expect(apiFetch).not.toHaveBeenCalled(); expect(button('Consultar nuevos horarios').props.disabled).toBe(true);
});
