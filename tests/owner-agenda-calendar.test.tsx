import { act, createElement } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OwnerAgendaCalendar } from '@/components/owner-agenda-calendar';
import { OwnerAgendaAppointments } from '@/components/owner-agenda-appointments';
import { RepresentationReviewControls } from '@/components/representation-review';
import type { Appointment, Business } from '@/types/firestore';
import type { OwnerAgendaDay } from '@/lib/owner-agenda';

vi.mock('@/components/representation-review', () => ({ RepresentationReviewControls: vi.fn(() => null) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const business = { id: 'demo-shop', resources: [{ id: 'a', name: 'Ana · especialista de cabello y cuidado personal', active: true }, { id: 'b', name: 'Beatriz', active: true }, { id: 'old', name: 'Profesional anterior', active: false }], weeklySchedule: { 1: { isOpen: true, intervals: [{ start: '09:00', end: '18:00' }] } } } as Business;
const source: Appointment = { id: 'demo-visit', tenantId: business.id, dateKey: '2030-01-07', startTimeStr: '09:00', endTimeStr: '09:05', startAt: Date.parse('2030-01-07T14:00:00Z'), endAt: Date.parse('2030-01-07T14:05:00Z'), reservedUntilAt: Date.parse('2030-01-07T14:15:00Z'), type: 'appointment', resourceId: 'a', serviceName: 'Servicio completo de cinco minutos', status: 'confirmed', client: { uid: 'demo-client', name: 'Cliente privado', email: 'private@example.test', phone: '573111111111', intakeAnswers: { health: 'Dato de salud privado' } }, beneficiary: { kind: 'represented_minor', displayName: 'Beneficiario privado', representativeRole: 'parent' }, representationReview: { revision: 1, status: 'declared', reviewedBy: null, reviewedAt: null }, createdBy: 'sarin_client', createdAt: 1 };
const dates = ['2030-01-07', '2030-01-08', '2030-01-09', '2030-01-10', '2030-01-11', '2030-01-12', '2030-01-13'];
const ready = (appointments = [source], dateKey = dates[0]): OwnerAgendaDay => ({ dateKey, state: 'ready', appointments });
type Props = Parameters<typeof OwnerAgendaCalendar>[0];
let renderer: ReactTestRenderer | undefined;
let props: Props;
const content = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(content).join('');
const root = () => renderer!.root;
const button = (label: string) => root().findAllByType('button').find(node => content(node) === label)!;
async function calendar(extra: Partial<Props> = {}) {
  props = { ...props, ...extra };
  await act(async () => { renderer = create(createElement(OwnerAgendaCalendar, props)); });
}
async function list(day: OwnerAgendaDay | null = ready(), extra: Partial<Parameters<typeof OwnerAgendaAppointments>[0]> = {}) {
  await act(async () => { renderer = create(createElement(OwnerAgendaAppointments, { business, dateKey: dates[0], day, resourceId: null, saving: false, onCancel: vi.fn(), onSaved: vi.fn(), ...extra })); });
}
beforeEach(() => {
  vi.clearAllMocks();
  props = { business, mode: 'day', selectedDate: dates[0], resourceId: null, range: { selectedDate: dates[0], dates: [dates[0]], queryDates: [dates[0]], outsideDates: [] }, snapshot: { days: [ready()], checkedAt: 1 }, loading: false, error: null, busy: false, onModeChange: vi.fn(), onDateChange: vi.fn(), onResourceChange: vi.fn(), onRefresh: vi.fn() };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it('dayAndWeekControlsExposePressedState', async () => {
  await calendar();
  expect(button('Día').props['aria-pressed']).toBe(true);
  expect(button('Semana').props['aria-pressed']).toBe(false);
  await act(async () => button('Semana').props.onClick());
  expect(props.onModeChange).toHaveBeenCalledWith('week');
  await act(async () => renderer!.update(createElement(OwnerAgendaCalendar, { ...props, busy: true })));
  for (const node of root().findAll(node => ['button', 'select', 'input'].includes(String(node.type)))) expect(node.props.disabled).toBe(true);
});

it('weekShowsExactlyOneResourceAndSevenDays', async () => {
  await calendar({ mode: 'week', resourceId: 'a', range: { selectedDate: dates[0], dates, queryDates: dates, outsideDates: [] }, snapshot: { days: dates.map(date => ready(date === dates[0] ? [source] : [], date)), checkedAt: 1 } });
  expect(root().findAllByType('option').map(node => node.props.value)).not.toContain('');
  const headers = root().findAllByProps({ 'data-agenda-day': true });
  expect(headers).toHaveLength(7);
  expect(root().findAllByProps({ 'data-agenda-column': true })).toHaveLength(7);
  const focus = vi.fn();
  vi.stubGlobal('document', { getElementById: vi.fn(() => ({ focus })) });
  await act(async () => headers[2].props.onClick());
  expect(props.onDateChange).toHaveBeenCalledWith('2030-01-09');
  await act(async () => renderer!.update(createElement(OwnerAgendaCalendar, { ...props, selectedDate: '2030-01-09' })));
  expect(focus).toHaveBeenCalledOnce();
});

it('partialDayHasErrorNotZero', async () => {
  const day: OwnerAgendaDay = { dateKey: dates[0], state: 'error', message: 'La consulta de este día tardó demasiado' };
  await calendar({ snapshot: { days: [day], checkedAt: 1 } });
  expect(content(root())).toContain('No pudimos cargar este día');
  expect(content(root())).not.toContain('0 citas');
  await act(async () => renderer?.unmount());
  await list(day);
  expect(content(root())).toContain(day.message);
  expect(content(root())).not.toContain('Todavía no hay');
});

it('outsideDayDoesNotClaimEmpty', async () => {
  await list({ dateKey: dates[0], state: 'outside' });
  expect(content(root())).toContain('Fuera del rango consultable');
  expect(content(root())).not.toContain('Todavía no hay');
  expect(root().findByProps({ id: 'owner-agenda-day-details' }).props.tabIndex).toBe(-1);
});

it('inactiveUnknownAndLongNamesAreVisible', async () => {
  await calendar({ snapshot: { days: [ready([source, { ...source, id: 'demo-old', resourceId: 'old' }, { ...source, id: 'demo-missing', resourceId: 'deleted-id' }])], checkedAt: 1 } });
  const options = root().findAllByType('option').map(content);
  expect(options).toContain('Ana · especialista de cabello y cuidado personal');
  expect(options).toContain('Profesional anterior · Inactivo');
  expect(options).toContain('Recurso no disponible · deleted-id');
});

it('bufferUsesDifferentLegend', async () => {
  await calendar();
  expect(content(root())).toContain('Preparación');
  expect(content(root())).toContain('Horario del negocio');
  const service = root().findByProps({ 'data-agenda-service': source.id });
  const buffer = root().findByProps({ 'data-agenda-buffer': source.id });
  expect(service.props.style.height).toBeCloseTo(5 * 64 / 60);
  expect(buffer.props.style.height).toBeCloseTo(10 * 64 / 60);
  expect(buffer.props.style.backgroundImage).toContain('repeating-linear-gradient');
});

it('cancelledRowsRetainStatusWithoutChartBlock', async () => {
  const cancelled = { ...source, status: 'cancelled_by_owner' as const };
  await calendar({ snapshot: { days: [ready([cancelled])], checkedAt: 1 } });
  expect(root().findAllByProps({ 'data-agenda-service': source.id })).toHaveLength(0);
  await act(async () => renderer?.unmount());
  await list(ready([cancelled]));
  expect(content(root())).toContain('Cancelada por negocio');
  expect(root().findAllByType('button')).toHaveLength(0);
});

it('smallEventsHaveFullListDetails', async () => {
  await list();
  expect(content(root())).toContain('09:00');
  expect(content(root())).toContain('09:05');
  expect(content(root())).toContain(source.serviceName);
  expect(content(root())).toContain('Beneficiario privado');
  expect(content(root())).toContain('Gestionada por Cliente privado');
});

it('noHealthOrContactDataInDecorativeChart', async () => {
  await calendar();
  const chart = root().findByProps({ 'aria-hidden': true });
  const text = content(chart);
  for (const privateText of ['Cliente privado', 'private@example.test', '573111111111', 'Dato de salud privado', 'Beneficiario privado']) expect(text).not.toContain(privateText);
  expect(chart.findAll(node => ['button', 'a', 'input', 'select'].includes(String(node.type)))).toHaveLength(0);
  expect(root().findAllByProps({ role: 'grid' })).toHaveLength(0);
});

it('primaryControlsStayTogether', async () => {
  await calendar();
  const controls = root().findByProps({ 'aria-label': 'Controles principales de agenda' });
  expect(controls.findAllByType('button').map(content)).toEqual(['Día', 'Semana']);
  expect(controls.findAllByType('input')).toHaveLength(1);
  expect(controls.findAllByType('select')).toHaveLength(1);
  expect(content(root())).toContain('1. Elige día o semana');
  expect(content(root())).toContain('2. Revisa la ocupación');
});

it('helpAndAppointmentDetailsAreInitiallyCollapsed', async () => {
  await calendar();
  expect(root().findByType('details').props.open).not.toBe(true);
  expect(content(root().findByType('summary'))).toBe('Cómo leer la agenda');
  await act(async () => renderer?.unmount());
  await list();
  expect(root().findByType('details').props.open).not.toBe(true);
  const summary = content(root().findByType('summary'));
  for (const value of ['09:00', '09:05', source.serviceName!, business.resources[0].name, 'Confirmada']) expect(summary).toContain(value);
  expect(summary).not.toContain('Cliente privado');
  expect(content(root())).toContain('3. Abre una cita para ver sus detalles');
});

it('appointmentActionsRemainInsideTheirDetails', async () => {
  const onCancel = vi.fn(), onSaved = vi.fn();
  await list(ready(), { onCancel, onSaved });
  const details = root().findByType('details');
  const cancel = details.findByType('button');
  expect(content(cancel)).toBe('Cancelar cita');
  await act(async () => cancel.props.onClick());
  expect(onCancel).toHaveBeenCalledWith(source.id);
  const review = vi.mocked(RepresentationReviewControls).mock.calls.at(-1)![0];
  expect(review.businessId).toBe(business.id);
  expect(review.appointment).toBe(source);
  review.onSaved(source);
  expect(onSaved).toHaveBeenCalledWith(source);
  expect(Object.keys(review).sort()).toEqual(['appointment', 'businessId', 'onSaved']);
  expect(content(root())).not.toMatch(/Mover|Completar|Marcar ausencia|Reservar aquí/);
});

it('skipChartTargetsDayList', async () => {
  await calendar();
  const link = root().findByProps({ href: '#owner-agenda-day-details' });
  expect(content(link)).toBe('Ver citas del día');
  const scroller = root().findByProps({ 'aria-label': 'Gráfico de ocupación registrada' });
  expect(scroller.props.tabIndex).toBe(0);
  expect(scroller.props.className).toContain('overflow-auto');
});

it('unknownStatusAndInvalidTimesStayExplicitInList', async () => {
  await list(ready([{ ...source, status: 'legacy' as Appointment['status'], startAt: NaN }]));
  expect(content(root())).toContain('Estado sin reconocer');
  expect(content(root())).toContain('Horario no verificable');
  expect(root().findAllByType('button')).toHaveLength(0);
});

it('navigationUsesModeAndPreservesBlankDateWithoutInventingRequests', async () => {
  await calendar();
  await act(async () => button('Anterior').props.onClick());
  expect(props.onDateChange).toHaveBeenLastCalledWith('2030-01-06');
  await act(async () => renderer!.update(createElement(OwnerAgendaCalendar, { ...props, mode: 'week' })));
  await act(async () => button('Anterior').props.onClick());
  expect(props.onDateChange).toHaveBeenLastCalledWith('2029-12-31');
  await act(async () => root().findByType('input').props.onChange({ target: { value: '' } }));
  expect(props.onDateChange).toHaveBeenLastCalledWith('');
  await act(async () => renderer!.update(createElement(OwnerAgendaCalendar, { ...props, selectedDate: '', range: null, snapshot: null })));
  expect(content(root())).toContain('Elige una fecha válida');
  expect(button('Anterior').props.disabled).toBe(true);
  expect(button('Siguiente').props.disabled).toBe(true);
  expect(root().findAllByProps({ 'aria-hidden': true })).toHaveLength(0);
});

it('globalErrorHidesAllPreviousChartRecords', async () => {
  await calendar({ error: 'No tienes autorización para consultar esta agenda.' });
  expect(content(root())).toContain('No tienes autorización');
  expect(content(root())).not.toContain(source.serviceName);
  expect(root().findAllByProps({ 'aria-hidden': true })).toHaveLength(0);
});

it('dayFailureDoesNotAnnounceAWeekAndPartialWeekDoes', async () => {
  const failed: OwnerAgendaDay = { dateKey: dates[0], state: 'error', message: 'Red no disponible' };
  await calendar({ snapshot: { days: [failed], checkedAt: 1 } });
  expect(content(root().findByProps({ 'aria-live': 'polite' }))).not.toContain('Semana incompleta');
  await act(async () => renderer!.update(createElement(OwnerAgendaCalendar, { ...props, mode: 'week' })));
  expect(content(root().findByProps({ 'aria-live': 'polite' }))).toContain('Semana incompleta');
});

it('invalidCalendarDateRemainsASelectionPromptInDayList', async () => {
  await list(null, { dateKey: '2030-02-31' });
  expect(content(root())).toContain('Elige el día que quieres revisar');
  expect(content(root())).not.toContain('Cargando citas');
});

it('outsideWeekDayCannotBecomeSelectedDate', async () => {
  await calendar({ mode: 'week', resourceId: 'a', range: { selectedDate: dates[0], dates, queryDates: dates.slice(0, 2), outsideDates: dates.slice(2) }, snapshot: { days: [ready(), ready([], dates[1]), ...dates.slice(2).map(dateKey => ({ dateKey, state: 'outside' as const }))], checkedAt: 1 } });
  const outsideHeader = root().findAllByProps({ 'data-agenda-day': true })[2];
  expect(outsideHeader.props.disabled).toBe(true);
  await act(async () => outsideHeader.props.onClick());
  expect(props.onDateChange).not.toHaveBeenCalled();
});
