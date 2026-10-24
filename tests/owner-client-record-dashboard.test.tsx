import { act, createElement, type ReactNode } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DashboardPage from '@/app/dashboard/page';
import { OwnerAgendaAppointments } from '@/components/owner-agenda-appointments';
import { OwnerAgendaCalendar } from '@/components/owner-agenda-calendar';
import { OwnerClientRecordPanel } from '@/components/owner-client-record-panel';
import { ClientPolicyControls } from '@/components/client-policy-controls';
import type { Appointment, Business } from '@/types/firestore';
import type { OwnerClientRecordPage } from '@/lib/owner-client-record';
import { makeOwnerClientRecordAppointment } from './owner-client-record-fixture';

const state = vi.hoisted(() => ({ api: vi.fn(), user: { uid: 'demo-owner' }, epoch: 1, business: null as Business | null }));
vi.mock('@/components/auth-provider', () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, useAuth: () => ({ user: state.user, authEpoch: state.epoch, isCurrentSession: (uid: string, epoch: number) => uid === state.user.uid && epoch === state.epoch }) }));
vi.mock('@/hooks/useBusiness', () => ({ useBusiness: () => ({ business: state.business, loading: false, error: null }) }));
vi.mock('@/components/consent-panel', () => ({ useAccountConsent: () => ({ active: true }) }));
vi.mock('@/components/client-policy-controls', () => ({ ClientPolicyControls: () => null }));
vi.mock('@/components/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children, Notice: ({ children }: { children: ReactNode }) => createElement('p', {}, children), buttonClass: 'button', fieldClass: 'field' }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement('a', { href }, children) }));
vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: state.api }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const row = makeOwnerClientRecordAppointment();
const otherDay = '2030-01-08';
const target = makeOwnerClientRecordAppointment({ id: 'demo-target', dateKey: otherDay, startAt: row.startAt + 86400000, endAt: row.endAt + 86400000, reservedUntilAt: row.reservedUntilAt + 86400000, serviceName: 'Canonical target service' });
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const page = (source = row, rows = [target]): OwnerClientRecordPage => ({ scope: { businessId: source.tenantId, sourceAppointmentId: source.id, clientUid: source.client!.uid }, filter: 'all', checkedAt: row.startAt, rows: rows.map(item => ({ appointmentId: item.id, dateKey: item.dateKey, startAt: item.startAt, endAt: item.endAt, status: item.status, resourceLabel: 'Record resource', beneficiaryKind: 'represented_minor' })), nextCursor: null, coverage: { mode: 'indexed_appointments', completeness: 'not_guaranteed' } });
let tree: ReactTestRenderer | undefined;
const focus = vi.fn();
const detail = { open: false, dataset: { ownerAppointmentId: target.id, ownerAppointmentBusiness: target.tenantId, ownerAppointmentDate: target.dateKey }, querySelector: () => ({ focus }) };
const records = () => state.api.mock.calls.filter(call => call[0].endsWith('/client-record'));
const daily = () => state.api.mock.calls.filter(call => !call[1]?.method);
const writes = () => state.api.mock.calls.filter(call => call[1]?.method === 'PATCH');
const buttons = (label: string) => tree!.root.findAllByType('button').filter(node => text(node) === label);
const click = async (label: string, index = 0) => { expect(buttons(label)[index], `button ${label}`).toBeDefined(); await act(async () => buttons(label)[index].props.onClick()); };
const mount = async () => { await act(async () => { tree = create(createElement(DashboardPage)); }); };
const update = async () => { await act(async () => tree!.update(createElement(DashboardPage))); };
const list = () => tree!.root.findByType(OwnerAgendaAppointments).props;
const calendar = () => tree!.root.findByType(OwnerAgendaCalendar).props;
const open = () => click('Reservas de esta cuenta');
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(row.reservedUntilAt); state.user = { uid: 'demo-owner' }; state.epoch = 1; focus.mockReset(); detail.open = false;
  state.business = { id: row.tenantId, ownerUid: 'demo-owner', name: 'Synthetic business', slug: 'demo', resources: [{ id: row.resourceId, name: 'Demo resource', active: true }], services: [], weeklySchedule: {}, sarinConfig: { onboardingCompleted: true }, subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: 2200000000000 } } as unknown as Business;
  state.api.mockReset().mockImplementation(async (path: string) => path.endsWith('/client-record') ? page() : { appointments: [path.includes(otherDay) ? target : row] });
  vi.stubGlobal('document', { activeElement: null, addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [detail] });
});
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

it('onlyOnePanelAndNoPerCardReads', async () => {
  const second = makeOwnerClientRecordAppointment({ id: 'second', client: { ...row.client!, uid: 'second-account', name: 'Second card' } });
  state.api.mockResolvedValue({ appointments: [row, second] }); await mount(); expect(records()).toHaveLength(0); expect(buttons('Reservas de esta cuenta')).toHaveLength(2);
  const pending = deferred<unknown>(); state.api.mockReturnValue(pending.promise); await open(); expect(records()).toHaveLength(1); expect(tree!.root.findAllByType(OwnerClientRecordPanel)).toHaveLength(1);
  const old = records()[0]; state.api.mockResolvedValue(page(second, [])); await click('Reservas de esta cuenta', 1); expect(old[1].signal.aborted).toBe(true); expect(tree!.root.findAllByType(OwnerClientRecordPanel)).toHaveLength(1);
  await act(async () => pending.resolve(page())); expect(text(tree!.root)).not.toContain('Record resource'); expect(text(tree!.root)).toContain('Second card'); expect(daily()).toHaveLength(1);
});
it('postAgendaCardsKeepExistingActionsAndPolicies', async () => {
  await mount(); const clients = tree!.root.findByType(ClientPolicyControls).props.clients; await open();
  const cards = tree!.root.findByType(OwnerAgendaAppointments);
  for (const label of ['Atendida', 'No asisti\u00f3', 'Cancelar cita', 'Registrar revisi\u00f3n realizada']) expect(cards.findAllByType('button').filter(node => text(node) === label)).toHaveLength(1);
  expect(tree!.root.findByType(ClientPolicyControls).props.clients).toEqual(clients); expect(text(tree!.root)).toContain('Synthetic minor'); expect(text(tree!.root)).toContain('+573000000000');
});
it('attendanceOwnBusyDoesNotAbortItsOwnPatchWhenRecordIsClosed', async () => {
  await mount(); await open(); const pending = deferred<unknown>(); state.api.mockReturnValue(pending.promise); await click('Atendida'); await click('Confirmar resultado');
  const call = writes()[0]; expect(call[1].signal.aborted).toBe(false); await click('Cerrar'); expect(call[1].signal.aborted).toBe(false);
  const requestId = JSON.parse(call[1].body).requestId; await act(async () => pending.resolve({ appointment: { ...row, status: 'completed', attendance: { revision: 1, lastEventId: 'a'.repeat(64) } }, applied: { eventId: 'a'.repeat(64), requestId, revision: 1, status: 'completed', recordedAt: row.reservedUntilAt }, replayed: false }));
  expect(writes()).toHaveLength(1); expect(buttons('Corregir resultado')).toHaveLength(1); expect(calendar().busy).toBe(false);
});
it('savingRefBlocksOpenAndNavigate', async () => {
  await mount(); await open(); const panel = tree!.root.findByType(OwnerClientRecordPanel).props; const cards = list();
  await act(async () => { cards.onAttendanceBusyChange(row.id, true); panel.onOpenAppointment({ appointmentId: target.id, dateKey: otherDay }); cards.onOpenClientRecord(row); });
  expect(calendar().selectedDate).toBe(row.dateKey); expect(records()).toHaveLength(1); expect(tree!.root.findAllByType(OwnerClientRecordPanel)).toHaveLength(1);
  await act(async () => cards.onAttendanceBusyChange(row.id, false)); const pending = deferred<unknown>(); state.api.mockReturnValue(pending.promise);
  const current = list(), currentPanel = tree!.root.findByType(OwnerClientRecordPanel).props;
  await act(async () => { current.onCancel(row.id); currentPanel.onOpenAppointment({ appointmentId: target.id, dateKey: otherDay }); }); expect(calendar().selectedDate).toBe(row.dateKey);
  await click('Cerrar'); await act(async () => current.onOpenClientRecord(row)); expect(tree!.root.findAllByType(OwnerClientRecordPanel)).toHaveLength(0);
});
it('recordNavigationUsesExistingAgendaReadAndFocusesCanonicalRow', async () => {
  await mount(); await click('Semana'); await act(async () => calendar().onResourceChange('demo-chair')); await open();
  const pending = deferred<unknown>(); state.api.mockImplementation((path: string) => path.endsWith('/client-record') ? Promise.resolve(page()) : pending.promise);
  const before = daily().length; await click('Ver en agenda'); expect(tree!.root.findAllByType(OwnerClientRecordPanel)).toHaveLength(0); expect(calendar().mode).toBe('day'); expect(calendar().selectedDate).toBe(otherDay); expect(calendar().resourceId).toBeNull(); expect(daily()).toHaveLength(before + 1); expect(focus).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ appointments: [target] })); expect(detail.open).toBe(true); expect(focus).toHaveBeenCalledOnce(); expect(text(tree!.root)).toContain('Canonical target service'); expect(list().day.appointments[0]).toEqual(target);
});
it('missingMovedAppointmentDoesNotInjectDto', async () => {
  await mount(); await open(); state.api.mockResolvedValue({ appointments: [] }); await click('Ver en agenda');
  expect(list().day.appointments).toEqual([]); expect(text(tree!.root)).toContain('La cita ya no est\u00e1 en este d\u00eda. Puede haber cambiado; actualiza la agenda.'); expect(focus).not.toHaveBeenCalled(); expect(daily()).toHaveLength(2);
});
it('navigationCannotFocusAfterLeavingItsGeneration', async () => {
  await mount(); await open(); const pending = deferred<unknown>();
  state.api.mockImplementation((path: string) => path.includes(otherDay) ? pending.promise : Promise.resolve({ appointments: [] }));
  await click('Ver en agenda'); await act(async () => calendar().onDateChange('2030-01-09')); await act(async () => pending.resolve({ appointments: [target] }));
  expect(calendar().selectedDate).toBe('2030-01-09'); expect(focus).not.toHaveBeenCalled(); expect(text(tree!.root)).not.toContain('Canonical target service');
});
it('savedOutcomeInvalidatesOlderRecordRead', async () => {
  await mount(); const pending = deferred<unknown>(), review = deferred<unknown>(); state.api.mockImplementation((path: string) => path.endsWith('/client-record') ? pending.promise : review.promise); await open(); const old = records()[0];
  await click('Registrar revisi\u00f3n realizada'); expect(old[1].signal.aborted).toBe(false); state.api.mockResolvedValue(page(row, []));
  await act(async () => review.resolve({ appointment: { ...row, representationReview: { revision: 2, status: 'reviewed', reviewedBy: 'demo-owner', reviewedAt: row.reservedUntilAt } } }));
  expect(old[1].signal.aborted).toBe(true); expect(records()).toHaveLength(2); expect(tree!.root.findByType(OwnerClientRecordPanel).props.invalidation).toBe(1);
  await act(async () => pending.resolve(page())); expect(text(tree!.root)).not.toContain('Record resource'); expect(list().day.appointments[0].representationReview.revision).toBe(2); expect(daily()).toHaveLength(1);
});
it.each(['account', 'business', 'date', 'epoch'] as const)('accountChangeClosesAndMasksPanel %s', async change => {
  await mount(); const pending = deferred<unknown>(); state.api.mockReturnValue(pending.promise); await open(); const old = records()[0]; const callback = tree!.root.findByType(OwnerClientRecordPanel).props.onOpenAppointment;
  if (change === 'account') { state.user = { uid: 'other-owner' }; state.business = { ...state.business!, ownerUid: 'other-owner' }; }
  if (change === 'business') state.business = { ...state.business!, id: 'other-business' };
  if (change === 'epoch') state.epoch++;
  if (change === 'date') await act(async () => calendar().onDateChange(otherDay)); else await update();
  expect(tree!.root.findAllByType(OwnerClientRecordPanel)).toHaveLength(0); expect(old[1].signal.aborted).toBe(true); await act(async () => { callback({ appointmentId: target.id, dateKey: '2030-01-09' }); pending.resolve(page()); }); expect(calendar().selectedDate).not.toBe('2030-01-09');
  if (change === 'date') { state.api.mockResolvedValue({ appointments: [row] }); await act(async () => calendar().onDateChange(row.dateKey)); expect(tree!.root.findAllByType(OwnerClientRecordPanel)).toHaveLength(0); }
});
it('recordDoesNotChangeQuotaOrSubjectReview', async () => {
  state.business!.subscription.currentPeriodEndsAt = 0; const snapshot = structuredClone(row); await mount(); await open(); await click('Cerrar');
  expect(writes()).toHaveLength(0); expect(daily()).toHaveLength(1); expect(list().day.appointments[0]).toEqual(snapshot); expect(tree!.root.findByType(ClientPolicyControls).props.clients).toEqual([{ uid: row.client!.uid, name: row.client!.name }]);
});
it.each([401, 403])('accessLossClosesDashboardSelection %s', async status => {
  await mount(); state.api.mockImplementation((_path, _init, _uid, _owns, onStatus) => { onStatus(status); return new Promise(() => {}); }); await open(); expect(tree!.root.findAllByType(OwnerClientRecordPanel)).toHaveLength(0);
});
it.each(['', 'x'.repeat(129), 'bad\n', 'bad\u007f'])('invalidUidOffersNoRecordButton %j', async uid => {
  state.api.mockResolvedValue({ appointments: [makeOwnerClientRecordAppointment({ client: { ...row.client!, uid } })] }); await mount(); expect(buttons('Reservas de esta cuenta')).toHaveLength(0); await act(async () => list().onOpenClientRecord(row)); expect(records()).toHaveLength(0);
});
it.each(['a', 'a'.repeat(128), ' account/uid '])('validUidIsUsedExactlyWithoutTrimming %j', async uid => {
  const source = makeOwnerClientRecordAppointment({ client: { ...row.client!, uid } });
  state.api.mockImplementation(async (path: string) => path.endsWith('/client-record') ? page(source, []) : { appointments: [source] });
  await mount(); await open(); expect(records()).toHaveLength(1); expect(JSON.parse(records()[0][1].body)).toEqual({ clientUid: uid, filter: 'all' }); expect(text(tree!.root)).toContain('No hay reservas verificables');
});
it('blocksAndAbsentClientsOfferNoRecordButton', async () => {
  state.api.mockResolvedValue({ appointments: [makeOwnerClientRecordAppointment({ type: 'manual_block' }), makeOwnerClientRecordAppointment({ id: 'no-client', client: undefined })] }); await mount(); expect(buttons('Reservas de esta cuenta')).toHaveLength(0);
});
it('canonicalSourceChangeClosesSelectionBeforeARecordCanPublish', async () => {
  await mount(); const pending = deferred<unknown>(); state.api.mockReturnValue(pending.promise); await open(); const old = records()[0];
  state.api.mockResolvedValue({ appointments: [makeOwnerClientRecordAppointment({ client: { ...row.client!, uid: 'changed-account' } })] }); await act(async () => calendar().onRefresh());
  expect(tree!.root.findAllByType(OwnerClientRecordPanel)).toHaveLength(0); expect(old[1].signal.aborted).toBe(true); await act(async () => pending.resolve(page())); expect(text(tree!.root)).not.toContain('Record resource');
});
it('successfulCancelInvalidatesTheSelectedAccountRecord', async () => {
  await mount(); await open(); const pending = deferred<unknown>(); state.api.mockImplementation((path: string, init?: RequestInit) => path.endsWith('/client-record') ? pending.promise : Promise.resolve({ appointment: { ...row, status: 'cancelled_by_owner' }, appointments: [{ ...row, status: 'cancelled_by_owner' }] }));
  await click('Actualizar', 1); const old = records().at(-1)!; await click('Cancelar cita'); expect(old[1].signal.aborted).toBe(true); expect(records().length).toBeGreaterThan(2); expect(daily()).toHaveLength(2); expect(tree!.root.findByType(OwnerClientRecordPanel).props.invalidation).toBe(1);
});
