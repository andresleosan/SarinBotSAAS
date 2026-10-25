vi.mock('@/hooks/use-resource-schedules', () => ({ useResourceSchedules: vi.fn(() => ({ view: null, phase: 'loading' })) }));
import { act, createElement, type ReactNode } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from '@/app/dashboard/page';
import { useResourceSchedules } from '@/hooks/use-resource-schedules';
import { OwnerAgendaCalendar } from '@/components/owner-agenda-calendar';
import { emptyResourceSchedulePolicy } from '@/lib/resource-schedules';
import { ClientPolicyControls } from '@/components/client-policy-controls';
import type { Appointment, Business } from '@/types/firestore';

const state = vi.hoisted(() => ({ user: { uid: 'demo-owner' }, business: null as Business | null, loading: false, businessError: null as string | null, consent: true, api: vi.fn(), notices: [] as { businessId: string | undefined; message: ReactNode }[] }));
vi.mock('@/components/auth-provider', () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, useAuth: () => ({ user: state.user }) }));
vi.mock('@/hooks/useBusiness', () => ({ useBusiness: () => ({ business: state.business, loading: state.loading, error: state.businessError }) }));
vi.mock('@/components/consent-panel', () => ({ useAccountConsent: () => ({ active: state.consent }) }));
vi.mock('@/components/client-policy-controls', () => ({ ClientPolicyControls: () => null }));
vi.mock('@/components/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children, Notice: ({ children }: { children: ReactNode }) => { state.notices.push({ businessId: state.business?.id, message: children }); return createElement('p', {}, children); }, buttonClass: 'button', fieldClass: 'field' }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement('a', { href }, children) }));
vi.mock('@/lib/client/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/client/api')>(), apiFetch: state.api }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const content = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(content).join('');
const fixture = (dateKey = '2026-10-20', overrides: Partial<Appointment> = {}): Appointment => ({ id: `demo-${dateKey}`, tenantId: 'demo-business', resourceId: 'active', type: 'appointment', status: 'confirmed', dateKey, startAt: Date.parse(`${dateKey}T09:00:00-05:00`), endAt: Date.parse(`${dateKey}T09:30:00-05:00`), reservedUntilAt: Date.parse(`${dateKey}T09:40:00-05:00`), startTimeStr: '09:00', endTimeStr: '09:30', serviceName: 'Servicio sintético', client: { uid: 'demo-client', name: 'Cliente sintético', email: 'demo@example.invalid', intakeAnswers: {} }, ...overrides } as Appointment);
const represented = () => fixture('2026-10-20', { beneficiary: { kind: 'represented_minor', displayName: 'Menor sintético', representativeRole: 'parent' }, representationReview: { revision: 0, status: 'declared', reviewedBy: null, reviewedAt: null } });
const reviewed = (row = represented()) => ({ ...row, serviceName: 'Revisión guardada', representationReview: { revision: 1, status: 'reviewed', reviewedBy: 'demo-owner', reviewedAt: 1 } } as Appointment);
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

describe('owner agenda dashboard integration', () => {
  let renderer: ReactTestRenderer;
  const button = (label: string) => renderer.root.findAllByType('button').find(node => content(node) === label)!;
  const date = () => renderer.root.findByProps({ 'aria-label': 'Fecha de la agenda' });
  const resource = () => renderer.root.findByProps({ 'aria-label': 'Profesional o estación de la agenda' });
  const reads = () => state.api.mock.calls.filter(call => !call[1]?.method);
  const writes = () => state.api.mock.calls.filter(call => call[1]?.method);
  const mount = async () => { await act(async () => { renderer = create(createElement(DashboardPage)); }); };
  const update = async () => { await act(async () => renderer.update(createElement(DashboardPage))); };
  it('scheduleControllerIsReadonlyAndRefreshPreservesDateAndActions', async () => { await mount(); expect(vi.mocked(useResourceSchedules)).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'read', businessId: state.business!.id, ownerUid: state.user.uid, enabled: true })); const selectedDate = date().props.value, business = state.business!; vi.mocked(useResourceSchedules).mockReturnValueOnce({ view: { businessId: business.id, ownerUid: state.user.uid, basis: { weeklySchedule: business.weeklySchedule, resources: business.resources }, basisFingerprint: 'a'.repeat(64), policy: emptyResourceSchedulePolicy(business.id), writesEnabled: false, serverNow: 1, operation: null }, phase: 'ready' } as ReturnType<typeof useResourceSchedules>); await update(); expect(date().props.value).toBe(selectedDate); expect(renderer.root.findByType(OwnerAgendaCalendar).props.scheduleContext.state).toBe('ready'); });
  const click = async (label: string) => { await act(async () => { button(label).props.onClick(); }); };
  const changeDate = async (value: string) => { await act(async () => date().props.onChange({ target: { value } })); };
  const submitBlock = async () => { await act(async () => { const times = renderer.root.findAllByType('input').filter(node => node.props.type === 'time'); times[0].props.onChange({ target: { value: '10:00' } }); times[1].props.onChange({ target: { value: '10:30' } }); }); await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); }); };
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T02:00:00Z'));
    state.user = { uid: 'demo-owner' }; state.consent = true; state.loading = false; state.businessError = null; state.notices = [];
    state.business = { id: 'demo-business', ownerUid: 'demo-owner', name: 'Negocio sintético', slug: 'demo', category: 'Servicios', phoneWhatsApp: '', resources: [{ id: 'active', name: 'Activo', active: true }, { id: 'retired', name: 'Retirado', active: false }], services: [], weeklySchedule: {}, sarinConfig: { onboardingCompleted: true, tone: 'Claro', customRules: '', intakeFields: [] }, subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: 2200000000000 } } as unknown as Business;
    state.api.mockReset(); state.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method) { const body = JSON.parse(String(init.body)); return { appointment: fixture(body.dateKey ?? '2026-10-20', init.method === 'POST' ? { id: 'demo-block', type: 'manual_block', startTimeStr: body.startTimeStr, endTimeStr: body.endTimeStr, resourceId: body.resourceId } : { id: body.appointmentId, status: 'cancelled_by_owner' }) }; }
      const url = new URL(path, 'https://example.invalid'); return { appointments: [fixture(url.searchParams.get('date')!, { tenantId: path.includes('other-business') ? 'other-business' : 'demo-business' })] };
    });
  });
  afterEach(async () => { await act(async () => renderer?.unmount()); vi.useRealTimers(); });

  it('defaultsToColombiaDayAllResources', async () => { await mount(); expect(date().props.value).toBe('2026-10-20'); expect(resource().props.value).toBe(''); expect(reads().map(call => call[0])).toEqual(['/api/businesses/demo-business/appointments?date=2026-10-20']); expect(content(renderer.root)).toContain('Servicio sintético'); expect(renderer.root.findAllByType('a').some(node => node.props.href === '/dashboard/qr-kit')).toBe(true); });
  it.each([true, false])('weekSelectsFirstActiveOrHistoricalResource active=%s', async active => {
    if (!active) state.business!.resources = state.business!.resources.filter(row => !row.active);
    state.api.mockResolvedValue({ appointments: [fixture('2026-10-20', { resourceId: 'retired' })] }); await mount();
    state.api.mockImplementation(async (path: string) => ({ appointments: [fixture(new URL(path, 'https://example.invalid').searchParams.get('date')!, { resourceId: 'retired' })] }));
    await click('Semana'); expect(resource().props.value).toBe(active ? 'active' : 'retired');
  });
  it('navigationPreservesSelectedWeekday', async () => { await mount(); await click('Semana'); await click('Siguiente'); expect(date().props.value).toBe('2026-10-27'); await click('Anterior'); expect(date().props.value).toBe('2026-10-20'); });
  it('blockUsesSelectedTuesdayNotMonday', async () => { await mount(); await click('Semana'); await submitBlock(); const call = writes()[0]; expect(JSON.parse(call[1].body)).toEqual({ dateKey: '2026-10-20', startTimeStr: '10:00', endTimeStr: '10:30', resourceId: 'active', requestId: expect.any(String) }); expect(call[0]).toBe('/api/businesses/demo-business/appointments'); expect(call[2]).toBe('demo-owner'); expect(call[3]()).toBe(true); expect(reads()).toHaveLength(15); });
  it('filterDoesNotChangePolicyClientPopulation', async () => {
    state.api.mockResolvedValue({ appointments: [fixture(), fixture('2026-10-20', { id: 'demo-other', resourceId: 'retired', client: { uid: 'demo-other-client', name: 'Otro cliente' } as Appointment['client'] }), fixture('2026-10-20', { id: 'demo-unknown', resourceId: 'removed' })] }); await mount();
    await act(async () => resource().props.onChange({ target: { value: 'active' } }));
    expect(renderer.root.findByType(ClientPolicyControls).props.clients).toEqual([{ uid: 'demo-client', name: 'Cliente sintético' }, { uid: 'demo-other-client', name: 'Otro cliente' }]); expect(reads()).toHaveLength(1);
    const blockSelect = renderer.root.findByType('form').findByType('select'); expect(blockSelect.findAllByType('option').map(node => node.props.value)).toEqual(['active']);
  });
  it.each(['block', 'cancel'])('dashboardBlockAndCancelFreezeViewControls %s', async action => {
    const pending = deferred<unknown>(); await mount(); state.api.mockImplementation((path: string, init?: RequestInit) => init?.method ? pending.promise : Promise.resolve({ appointments: [fixture()] }));
    if (action === 'block') await submitBlock(); else await click('Cancelar cita');
    for (const label of ['Semana', 'Anterior', 'Siguiente', 'Hoy', 'Actualizar']) expect(button(label).props.disabled).toBe(true);
    expect(date().props.disabled).toBe(true); expect(resource().props.disabled).toBe(true);
    await click('Semana'); await changeDate('2026-10-22'); expect(date().props.value).toBe('2026-10-20');
    await act(async () => pending.resolve({ appointment: fixture('2026-10-20', action === 'block' ? { id: 'demo-block', type: 'manual_block', startTimeStr: '10:00', endTimeStr: '10:30' } : { status: 'cancelled_by_owner' }) })); expect(date().props.disabled).toBe(false);
  });
  it('cancelRefreshesRangeWithoutChangingPayload', async () => { await mount(); await click('Semana'); await click('Cancelar cita'); expect(writes()[0][1].method).toBe('PATCH'); expect(JSON.parse(writes()[0][1].body)).toEqual({ appointmentId: 'demo-2026-10-20' }); expect(writes()[0][2]).toBe('demo-owner'); expect(writes()[0][3]()).toBe(true); expect(reads()).toHaveLength(15); });
  it('scopeChangeAbortsDashboardMutationAndMasksDetails', async () => { const pending = deferred<unknown>(); await mount(); const read = state.api.getMockImplementation()!; state.api.mockImplementation((path, init) => init?.method ? pending.promise : read(path, init)); await click('Cancelar cita'); const call = writes()[0]; state.user = { uid: 'other-owner' }; await update(); expect(call[1].signal.aborted).toBe(true); expect(call[3]()).toBe(false); expect(content(renderer.root)).not.toContain('Cliente sintético'); await act(async () => pending.reject(new Error('Error privado anterior'))); expect(content(renderer.root)).not.toContain('Error privado anterior'); });
  it('masksAnExistingMutationErrorDuringTheFirstRenderOfAnotherBusiness', async () => { await mount(); state.api.mockRejectedValue(new Error('Error privado anterior')); await click('Cancelar cita'); expect(content(renderer.root)).toContain('Error privado anterior'); state.business = { ...state.business!, id: 'other-business' }; await update(); expect(state.notices.filter(notice => notice.businessId === 'other-business').map(notice => notice.message)).not.toContain('Error privado anterior'); });
  it('anotherBusinessDoesNotInheritThePreviousResourceFilter', async () => { await mount(); await act(async () => resource().props.onChange({ target: { value: 'active' } })); state.business = { ...state.business!, id: 'other-business', resources: [{ id: 'other-resource', name: 'Otro recurso', active: true }] }; state.api.mockResolvedValue({ appointments: [fixture('2026-10-20', { tenantId: 'other-business', resourceId: 'other-resource' })] }); await update(); expect(resource().props.value).toBe(''); expect(content(renderer.root)).not.toContain('Recurso no disponible · active'); });
  it.each(['retired', 'removed'])('missingHistoricalDayFilterResetsOnlyAfterTheNewDayIsReady %s', async resourceId => {
    state.api.mockResolvedValue({ appointments: [fixture('2026-10-20', { resourceId })] }); await mount(); await act(async () => resource().props.onChange({ target: { value: resourceId } }));
    const pending = deferred<unknown>(); state.api.mockReturnValue(pending.promise); await changeDate('2026-10-21');
    expect(resource().props.value).toBe(resourceId); expect(resource().findAllByType('option').map(node => node.props.value)).toContain(resourceId);
    await act(async () => pending.resolve({ appointments: [fixture('2026-10-21', { serviceName: 'Cita del nuevo día' })] }));
    expect(resource().props.value).toBe(''); expect(content(renderer.root)).toContain('Cita del nuevo día'); expect(renderer.root.findAllByProps({ 'data-agenda-service': 'demo-2026-10-21' })).toHaveLength(1);
  });
  it('historicalDayFilterSurvivesLoadingWhenTheNewDayAlsoHasThatResource', async () => {
    state.api.mockResolvedValue({ appointments: [fixture('2026-10-20', { resourceId: 'retired' })] }); await mount(); await act(async () => resource().props.onChange({ target: { value: 'retired' } }));
    const pending = deferred<unknown>(); state.api.mockReturnValue(pending.promise); await changeDate('2026-10-21'); expect(resource().props.value).toBe('retired');
    await act(async () => pending.resolve({ appointments: [fixture('2026-10-21', { resourceId: 'retired' })] })); expect(resource().props.value).toBe('retired'); expect(content(renderer.root)).toContain('Servicio sintético');
  });
  it('weekToDayReconcilesHistoricalSelectionAfterItsSelectedDayLoads', async () => {
    state.api.mockImplementation(async (path: string) => { const dateKey = new URL(path, 'https://example.invalid').searchParams.get('date')!; return { appointments: [fixture(dateKey, { resourceId: dateKey === '2026-10-20' ? 'retired' : 'active' })] }; });
    await mount(); await act(async () => resource().props.onChange({ target: { value: 'retired' } })); await click('Semana'); await changeDate('2026-10-21');
    const pending = deferred<unknown>(); state.api.mockReturnValue(pending.promise); await click('Día'); expect(resource().props.value).toBe('retired'); expect(resource().findAllByType('option').map(node => node.props.value)).toContain('retired');
    await act(async () => pending.resolve({ appointments: [fixture('2026-10-21', { serviceName: 'Solo recurso activo' })] })); expect(resource().props.value).toBe(''); expect(content(renderer.root)).toContain('Solo recurso activo');
  });
  it('weeklyHistoricalSelectionIsNotDiscardedWhileTheNewRangeLoads', async () => {
    state.api.mockImplementation(async (path: string) => { const dateKey = new URL(path, 'https://example.invalid').searchParams.get('date')!; return { appointments: [fixture(dateKey, { resourceId: 'retired' })] }; });
    await mount(); await act(async () => resource().props.onChange({ target: { value: 'retired' } })); await click('Semana');
    const pending = deferred<unknown>(); state.api.mockImplementation((path: string) => pending.promise.then(() => { const dateKey = new URL(path, 'https://example.invalid').searchParams.get('date')!; return { appointments: [fixture(dateKey, { resourceId: 'retired' })] }; }));
    await click('Siguiente'); expect(resource().props.value).toBe('retired'); expect(resource().findAllByType('option').map(node => node.props.value)).toContain('retired');
    await act(async () => pending.resolve(null)); expect(resource().props.value).toBe('retired');
  });
  it('selectingAnotherDayWithinTheWeekReusesReadsAndPoliciesUseOnlyThatDay', async () => {
    state.api.mockImplementation(async (path: string) => { const dateKey = new URL(path, 'https://example.invalid').searchParams.get('date')!; return { appointments: [fixture(dateKey, { client: { uid: `client-${dateKey}`, name: dateKey } as Appointment['client'] })] }; });
    await mount(); await click('Semana'); expect(reads()).toHaveLength(8); await changeDate('2026-10-21'); expect(reads()).toHaveLength(8); expect(renderer.root.findByType(ClientPolicyControls).props.clients).toEqual([{ uid: 'client-2026-10-21', name: '2026-10-21' }]);
  });
  it('representationSaveReplacesKnownRow', async () => { state.api.mockResolvedValue({ appointments: [represented()] }); await mount(); state.api.mockResolvedValue({ appointment: reviewed() }); await click('Registrar revisión realizada'); expect(content(renderer.root)).toContain('Revisión guardada'); expect(writes()[0][0]).toContain('/representation-review'); expect(JSON.parse(writes()[0][1].body)).toEqual({ expectedRevision: 0, status: 'reviewed' }); });
  it('representationKeepsLocalBusyWithoutFreezingAgenda', async () => { const pending = deferred<unknown>(); state.api.mockResolvedValue({ appointments: [represented()] }); await mount(); state.api.mockReturnValue(pending.promise); await click('Registrar revisión realizada'); expect(button('Registrar revisión realizada').props.disabled).toBe(true); expect(date().props.disabled).toBe(false); expect(resource().props.disabled).toBe(false); expect(button('Semana').props.disabled).toBe(false); await act(async () => pending.resolve({ appointment: reviewed() })); });
  it('representationLateResultAfterDaySwitchIsIgnored', async () => { const pending = deferred<unknown>(); state.api.mockResolvedValue({ appointments: [represented()] }); await mount(); state.api.mockImplementation((path: string, init?: RequestInit) => init?.method ? pending.promise : Promise.resolve({ appointments: [fixture('2026-10-21')] })); await click('Registrar revisión realizada'); await changeDate('2026-10-21'); await act(async () => pending.resolve({ appointment: reviewed() })); expect(content(renderer.root)).not.toContain('Revisión guardada'); expect(content(renderer.root)).not.toContain('Menor sintético'); });
  it.each(['account', 'business'])('representationLateResultAfterAccountOrBusinessSwitchIsIgnored %s', async change => { const pending = deferred<unknown>(); state.api.mockResolvedValue({ appointments: [represented()] }); await mount(); state.api.mockImplementation((path: string, init?: RequestInit) => init?.method ? pending.promise : Promise.resolve({ appointments: [fixture('2026-10-20', { tenantId: change === 'business' ? 'other-business' : 'demo-business' })] })); await click('Registrar revisión realizada'); if (change === 'account') { state.user = { uid: 'other-owner' }; state.business = { ...state.business!, ownerUid: 'other-owner' }; } else state.business = { ...state.business!, id: 'other-business' }; await update(); await act(async () => pending.resolve({ appointment: reviewed() })); expect(content(renderer.root)).not.toContain('Revisión guardada'); expect(content(renderer.root)).not.toContain('Menor sintético'); });
  it('currentRepresentationSaveInvalidatesEarlierRead', async () => {
    state.api.mockResolvedValue({ appointments: [represented()] }); await mount(); const pendingRead = deferred<unknown>(); state.api.mockImplementation((_path: string, init?: RequestInit) => init?.method ? Promise.resolve({ appointment: reviewed() }) : pendingRead.promise);
    await act(async () => vi.advanceTimersByTimeAsync(15000)); const earlier = reads().at(-1)!; await click('Registrar revisión realizada'); expect(earlier[1].signal.aborted).toBe(true); await act(async () => pendingRead.resolve({ appointments: [represented()] })); expect(content(renderer.root)).toContain('Revisión guardada');
  });
  it('expiredSubscriptionStillReadsHistory', async () => { state.business!.subscription.currentPeriodEndsAt = 0; await mount(); expect(content(renderer.root)).toContain('Servicio sintético'); expect(reads()).toHaveLength(1); });
  it('missingAccountConsentDoesNotEnableBlock', async () => { state.consent = false; await mount(); expect(button('Bloquear horario').props.disabled).toBe(true); await submitBlock(); expect(writes()).toHaveLength(0); expect(content(renderer.root)).toContain('Servicio sintético'); });
  it('ownerCancellationPreservesExistingAuthority', async () => { state.consent = false; state.business!.subscription.currentPeriodEndsAt = 0; state.api.mockResolvedValue({ appointments: [fixture('2026-10-20', { resourceId: 'removed', startAt: 1, endAt: 2 })] }); await mount(); expect(button('Cancelar cita').props.disabled).toBe(false); state.api.mockResolvedValue({ appointment: fixture('2026-10-20', { resourceId: 'removed', status: 'cancelled_by_owner' }) }); await click('Cancelar cita'); expect(JSON.parse(writes()[0][1].body)).toEqual({ appointmentId: 'demo-2026-10-20' }); });
  it('emptyDateDoesNotReadOrSubmit', async () => { await mount(); await changeDate(''); const before = reads().length; await submitBlock(); expect(reads()).toHaveLength(before); expect(writes()).toHaveLength(0); expect(button('Bloquear horario').props.disabled).toBe(true); });
  it('hidesPoliciesOnReadErrorRatherThanSupplyingAnEmptyPopulation', async () => { state.api.mockRejectedValue(new Error('Red no disponible')); await mount(); expect(renderer.root.findAllByType(ClientPolicyControls)).toHaveLength(0); expect(content(renderer.root)).toContain('Las políticas de clientes estarán disponibles cuando cargue el día seleccionado.'); });
  it.each(['owner', 'loading', 'error'])('unavailableOwnerAuthorityDoesNotRead %s', async reason => { if (reason === 'owner') state.business!.ownerUid = 'someone-else'; if (reason === 'loading') state.loading = true; if (reason === 'error') state.businessError = 'Sin autoridad'; await mount(); expect(reads()).toHaveLength(0); });
  it.each(['POST', 'PATCH'])('unverifiedMutationDoesNotClaimSuccessOrRetry %s', async method => { await mount(); state.api.mockResolvedValue({}); if (method === 'POST') await submitBlock(); else await click('Cancelar cita'); expect(content(renderer.root)).toContain('No se pudo comprobar el resultado. Actualiza la agenda.'); expect(reads()).toHaveLength(1); expect(writes()).toHaveLength(1); expect(date().props.disabled).toBe(false); });
});
