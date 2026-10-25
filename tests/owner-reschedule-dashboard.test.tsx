import { act, createElement, useState, type ReactNode } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DashboardPage from '@/app/dashboard/page';
import { OwnerRescheduleBoundary } from '@/components/owner-reschedule-boundary';
import { OwnerRescheduleWorkspace } from '@/components/owner-reschedule-workspace';
import { OwnerAgendaAppointments } from '@/components/owner-agenda-appointments';
import { OwnerClientRecordPanel } from '@/components/owner-client-record-panel';
import type { Appointment, Business } from '@/types/firestore';
import type { OwnerRescheduleEntry } from '@/lib/owner-rescheduling';
import { ApiError } from '@/lib/client/api';
import { emptyResourceSchedulePolicy } from '@/lib/resource-schedules';
import { ownerRescheduleBusiness as business, ownerRescheduleSource as original, ownerRescheduleView as view, ownerRescheduleResult as proof, ownerRescheduleNow as now } from './owner-rescheduling-contract';

const ui = vi.hoisted(() => ({ user: { uid: 'demo-owner' } as { uid: string } | null, epoch: 1, business: null as Business | null, row: null as Appointment | null, search: '?other=keep', api: vi.fn(), replace: vi.fn(), invalidate: vi.fn() }));
vi.mock('@/components/auth-provider', () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, useAuth: () => ({ user: ui.user, authEpoch: ui.epoch, isCurrentSession: (uid: string, epoch: number) => uid === ui.user?.uid && epoch === ui.epoch, invalidateSession: ui.invalidate }) }));
vi.mock('@/hooks/useBusiness', () => ({ useBusiness: () => ({ business: ui.business, loading: false, error: null }) }));
vi.mock('@/components/consent-panel', () => ({ useAccountConsent: () => ({ active: true }) }));
vi.mock('@/components/client-policy-controls', () => ({ ClientPolicyControls: () => null }));
vi.mock('@/components/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children, Notice: ({ children }: { children: ReactNode }) => createElement('aside', null, children), buttonClass: 'min-h-11', fieldClass: 'field' }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement('a', { href }, children) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(ui.search), usePathname: () => '/dashboard', useRouter: () => ({ replace: ui.replace }) }));
vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: ui.api }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const source = { appointment: original, expectation: { sourceRevision: 0, sourceFingerprint: 'a'.repeat(64) }, eligible: true, reason: null };
const moved = { ...original, startTimeStr: '10:00', endTimeStr: '10:30', startAt: proof.startAt, endAt: proof.endAt, reservedUntilAt: view.target.reservedUntilAt, rescheduleRevision: 1, lastRescheduleProposalId: view.id, rescheduledAt: now };
let renderer: ReactTestRenderer, rootMode = false, proposal = { ...view }, entryLog: (OwnerRescheduleEntry | null)[];
const applied = vi.fn(), locked = vi.fn();
function BoundaryHarness({ initial = { appointmentId: original.id } }: { initial?: OwnerRescheduleEntry | null }) {
  const [entry, setEntry] = useState(initial);
  return createElement(OwnerRescheduleBoundary, { ownerUid: ui.user?.uid ?? '', authEpoch: ui.epoch, businessId: ui.business!.id, business: ui.business!, entry, onEntryChange: value => { entryLog.push(value); setEntry(value); }, onApplied: applied, onLockedChange: locked });
}
function text(node: ReactTestInstance, visible = false): string {
  if (visible && (node.props.hidden || node.props.inert)) return '';
  return node.children.map(child => typeof child === 'string' ? child : text(child, visible)).join(' ').replace(/\s+/g, ' ').trim();
}
const button = (label: string) => renderer.root.findAllByType('button').find(node => text(node) === label)!;
const click = async (label: string) => act(async () => button(label).props.onClick());
const change = async (label: string, value: string) => act(async () => renderer.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } }));
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const writes = () => ui.api.mock.calls.filter(call => /\/(proposals|confirm)$/.test(call[0]));
const sourceReads = () => ui.api.mock.calls.filter(call => String(call[0]).endsWith('/owner-reschedule'));
async function mount(root = false, initial: OwnerRescheduleEntry | null = { appointmentId: original.id }) { rootMode = root; await act(async () => { renderer = create(root ? createElement(DashboardPage) : createElement(BoundaryHarness, { initial })); }); if (root) await change('Fecha de la agenda', '2030-01-07'); }
async function update() { await act(async () => renderer.update(rootMode ? createElement(DashboardPage) : createElement(BoundaryHarness))); }
async function review() { await click('Consultar horarios'); await change('Nueva hora', '10:00'); await click('Revisar cambio'); }
beforeEach(() => {
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible', activeElement: null, querySelectorAll: () => [] }));
  vi.stubGlobal('window', new EventTarget());
  vi.useFakeTimers(); vi.setSystemTime(now); ui.user = { uid: 'demo-owner' }; ui.epoch = 1; ui.business = structuredClone(business); ui.row = structuredClone(original); ui.search = '?other=keep'; entryLog = []; proposal = { ...view }; applied.mockReset(); locked.mockReset(); ui.invalidate.mockReset();
  ui.replace.mockReset().mockImplementation((href: string) => { ui.search = new URL(href, 'https://example.invalid').search; });
  ui.api.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/businesses') return { business: ui.business };
    if (path.endsWith('/resource-schedules')) return { businessId: business.id, ownerUid: business.ownerUid, policy: emptyResourceSchedulePolicy(business.id), basis: { resources: business.resources, weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, business.weeklySchedule[day] ?? { isOpen: false, intervals: [] }])) }, basisFingerprint: 'a'.repeat(64), writesEnabled: false, serverNow: now, operation: null };
    if (path.includes('/appointments?date=')) return { appointments: new URL(path, 'http://localhost').searchParams.get('date') === ui.row?.dateKey ? [ui.row] : [] };
    if (path.endsWith('/client-record')) return { scope: { businessId: business.id, sourceAppointmentId: original.id, clientUid: 'demo-client' }, filter: 'all', checkedAt: now, rows: [], nextCursor: null };
    if (path.endsWith('/owner-reschedule')) return source;
    if (path.endsWith('/availability')) return { availability: [{ resourceId: 'demo-chair', resourceName: 'Profesional uno', slots: ['10:00'] }] };
    if (path.endsWith('/proposals')) { proposal = { ...view, requestId: JSON.parse(init!.body as string).requestId }; return { proposal }; }
    if (path.endsWith('/confirm')) { ui.row = moved; return { appointment: moved, rescheduleResult: proof, replayed: false }; }
    if (path.includes('/owner-reschedule-proposals/')) return { proposal, state: 'prepared', appointment: original, result: null };
    throw new Error('Unexpected synthetic API path');
  });
});
afterEach(async () => { await act(async () => renderer?.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('onlyOpaqueProposalIdEntersUrl and ownProposalUrlDoesNotResetEntryOrHook', async () => {
  await mount(); await review(); expect(ui.replace).toHaveBeenCalledWith('/dashboard?other=keep&ownerReschedule=demo-proposal', { scroll: false });
  await update(); expect(sourceReads()).toHaveLength(1); expect(writes()).toHaveLength(1); expect(entryLog).toEqual([]);
  expect(ui.search).not.toMatch(/demo-client|demo-source|573001234567|sourceRevision|startTimeStr/);
});
it('invalidDuplicateUrlDoesNotRead', async () => {
  ui.search = '?ownerReschedule=a&ownerReschedule=b'; await mount(false, null);
  expect(ui.api).not.toHaveBeenCalled(); expect(text(renderer.root)).toContain('enlace'); expect(entryLog).toEqual([]);
});
it('urlEntryRecoversButNeverConfirms', async () => {
  ui.search = '?ownerReschedule=demo-proposal'; await mount(false, null);
  expect(entryLog).toEqual([{ proposalId: 'demo-proposal' }]); expect(writes()).toHaveLength(0);
  expect(ui.api.mock.calls[0][0]).toBe(`/api/businesses/${business.id}/owner-reschedule-proposals/demo-proposal`);
});
it('externalUrlCannotReplaceOpenFlow', async () => {
  await mount(); ui.search = '?other=changed&ownerReschedule=demo-external'; await update();
  expect(sourceReads()).toHaveLength(1); expect(ui.api.mock.calls.some(call => String(call[0]).includes('demo-external'))).toBe(false);
  expect(renderer.root.findAllByType('a').some(node => node.props.target === '_blank' && node.props.rel === 'noopener noreferrer' && node.props.href.includes('ownerReschedule=demo-external'))).toBe(true);
  expect(entryLog).toEqual([]);
});
it('sensitiveUrlTransitionCannotReplaceUncertainTuple', async () => {
  await mount(); await review(); ui.api.mockRejectedValueOnce(new Error('lost response')); await click('Confirmar cambio');
  const body = writes().at(-1)![1].body; ui.search = '?ownerReschedule=demo-external&clientPhone=secret'; await update();
  await click('Recuperar la misma confirmación'); expect(writes().at(-1)![1].body).toBe(body); expect(writes().at(-1)![0]).toContain('/demo-proposal/confirm');
  expect(JSON.stringify(ui.api.mock.calls)).not.toContain('secret');
});
it('validated proof calls onApplied once and keeps its result until explicit close', async () => {
  await mount(); await review(); await click('Confirmar cambio'); await update();
  expect(applied).toHaveBeenCalledTimes(1); expect(applied).toHaveBeenCalledWith({ appointment: moved, rescheduleResult: proof });
  expect(renderer.root.findAllByType(OwnerRescheduleWorkspace)).toHaveLength(1); expect(text(renderer.root)).toContain('Cambio comprobado');
  await click('Cerrar cambio'); expect(entryLog.at(-1)).toBe(null); expect(new URLSearchParams(ui.search).has('ownerReschedule')).toBe(false); expect(new URLSearchParams(ui.search).get('other')).toBe('keep');
});
it('a safe explicit source restart removes the prior proposal reference before a new review', async () => {
  await mount(); await review(); ui.api.mockRejectedValueOnce(new ApiError('Source changed', 409, 'OWNER_RESCHEDULE_SOURCE_CHANGED'));
  await click('Confirmar cambio'); await click('Consultar origen de nuevo');
  expect(new URLSearchParams(ui.search).has('ownerReschedule')).toBe(false); expect(new URLSearchParams(ui.search).get('other')).toBe('keep');
  expect(sourceReads()).toHaveLength(2); await review(); expect(new URLSearchParams(ui.search).get('ownerReschedule')).toBe('demo-proposal');
});
it('identityChangeRemovesPrivateWorkspace and cannot publish a late confirmation', async () => {
  await mount(true); await click('Cambiar horario'); await review(); const pending = deferred<unknown>(); ui.api.mockReturnValueOnce(pending.promise);
  await click('Confirmar cambio'); const command = writes().at(-1)!;
  ui.user = { uid: 'demo-other' }; ui.epoch = 2; await update(); expect(text(renderer.root, true)).not.toContain('Cliente sintético'); expect(renderer.root.findAllByType(OwnerRescheduleWorkspace)).toHaveLength(0);
  expect(command[3]()).toBe(false); await act(async () => pending.resolve({ appointment: moved, rescheduleResult: proof, replayed: false }));
  expect(renderer.root.findAllByType(OwnerRescheduleWorkspace)).toHaveLength(0);
});
it('rescheduleLivesOutsideDayKeyedCards, closingCardDetailsKeepsWorkspace and changeOfDayFilterKeepsWorkspace', async () => {
  await mount(true); await click('Cambiar horario'); const workspace = renderer.root.findByType(OwnerRescheduleWorkspace);
  expect(renderer.root.findByType(OwnerAgendaAppointments).findAllByType(OwnerRescheduleWorkspace)).toHaveLength(0);
  await change('Fecha de la agenda', '2030-01-14'); await change('Profesional o estación de la agenda', 'demo-second');
  expect(renderer.root.findByType(OwnerRescheduleWorkspace)).toBe(workspace); expect(sourceReads()).toHaveLength(1);
  expect(renderer.root.findByProps({ 'aria-label': 'Nueva fecha' }).props.value).toBe('2030-01-07');
});
it('pollingDoesNotRemountActiveTuple', async () => {
  await mount(true); await click('Cambiar horario'); await review(); const first = writes()[0][1].body;
  ui.business = { ...business, name: 'Nombre actualizado' }; ui.row = { ...original, serviceName: 'Dato del polling' }; await update(); await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(sourceReads()).toHaveLength(1); expect(writes()).toHaveLength(1); expect(writes()[0][1].body).toBe(first); expect(text(renderer.root)).toContain('Propuesto');
});
it('openFlowBlocksOtherWritesByRef', async () => {
  await mount(true); const cancel = button('Cancelar cita').props.onClick, form = renderer.root.findByType('form'), block = form.props.onSubmit;
  await act(async () => { button('Cambiar horario').props.onClick(); cancel(); block({ preventDefault() {} }); });
  expect(ui.api.mock.calls.filter(call => call[1]?.method && !String(call[0]).endsWith('/owner-reschedule'))).toHaveLength(0);
  expect(button('Cancelar cita').props.disabled).toBe(true); expect(renderer.root.findByProps({ 'aria-label': 'Fecha de la agenda' }).props.disabled).toBe(false);
});
it('applied move closes prior CRM and clears old range while its proof survives a delayed reload', async () => {
  await mount(true); await click('Reservas de esta cuenta'); expect(renderer.root.findAllByType(OwnerClientRecordPanel)).toHaveLength(1);
  await click('Cambiar horario'); await review(); const base = ui.api.getMockImplementation()!, reload = deferred<unknown>();
  ui.api.mockImplementation((path, init) => String(path).includes('/appointments?date=') ? reload.promise : base(path, init));
  await click('Confirmar cambio'); expect(renderer.root.findAllByType(OwnerClientRecordPanel)).toHaveLength(0);
  expect(renderer.root.findByType(OwnerAgendaAppointments).props.day).toBe(null); expect(text(renderer.root)).toContain('Cambio comprobado');
  await act(async () => reload.resolve({ appointments: [moved] })); expect(renderer.root.findByType(OwnerRescheduleWorkspace)).toBeTruthy();
});
it('feature403 and same-owner probe preserve an in-flight confirmation and block a second operation', async () => {
  await mount(true); await click('Cambiar horario'); await review(); const pending = deferred<unknown>(), base = ui.api.getMockImplementation()!;
  ui.api.mockImplementation((path, init) => String(path).endsWith('/confirm') ? pending.promise : base(path, init)); await click('Confirmar cambio'); const call = writes().at(-1)!;
  ui.api.mockImplementation((path, init) => String(path).endsWith('/resource-schedules') ? Promise.reject(new ApiError('Restricted feature', 403, 'FEATURE_CLOSED')) : String(path).endsWith('/confirm') ? pending.promise : base(path, init));
  await act(async () => vi.advanceTimersByTimeAsync(15000)); expect(button('Comprobar acceso')).toBeTruthy(); expect(text(renderer.root, true)).not.toContain('20.000'); expect(call[1].signal.aborted).toBe(false);
  ui.api.mockImplementation((path, init) => String(path).endsWith('/confirm') ? pending.promise : base(path, init)); await click('Comprobar acceso');
  expect(call[3]()).toBe(true); expect(writes()).toHaveLength(2); expect(button('Cancelar cita').props.disabled).toBe(true);
  await act(async () => pending.resolve({ appointment: moved, rescheduleResult: proof, replayed: false })); expect(text(renderer.root, true)).toContain('Cambio comprobado');
});
it.each(['503', 'timeout'] as const)('sameOwnerProbeKeepsRecoveryVisibleWithFailedAgenda (%s)', async failure => {
  await mount(true); await click('Cambiar horario'); await review(); await click('Semana'); ui.api.mockRejectedValueOnce(new Error('Lost response')); await click('Confirmar cambio');
  const base = ui.api.getMockImplementation()!;
  ui.api.mockImplementation((path, init) => String(path).endsWith('/resource-schedules') ? Promise.reject(new ApiError('Feature restricted', 403)) : base(path, init));
  await act(async () => vi.advanceTimersByTimeAsync(15000)); expect(button('Comprobar acceso')).toBeTruthy();
  ui.api.mockImplementation((path, init) => String(path).includes('/appointments?date=2030-01-07') ? failure === '503' ? Promise.reject(new ApiError('Agenda unavailable', 503)) : new Promise(() => {}) : base(path, init));
  await click('Comprobar acceso');
  if (failure === 'timeout') await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(text(renderer.root, true)).toContain('Resultado por comprobar'); expect(text(renderer.root, true)).toContain('Consultar resultado');
  expect(text(renderer.root, true)).toContain(failure === '503' ? 'No pudimos cargar este día' : 'La consulta de este día tardó demasiado'); expect(button('Actualizar')).toBeTruthy();
  ui.api.mockResolvedValueOnce({ proposal, state: 'applied', result: proof, appointment: moved }); await click('Consultar resultado');
  expect(text(renderer.root, true)).toContain('Cambio comprobado'); expect(writes()).toHaveLength(2);
});
it('initialUrlRecoveryRetriesAfterFeatureProtectionAndProbe', async () => {
  ui.search = '?ownerReschedule=demo-proposal'; const base = ui.api.getMockImplementation()!; let denied = false;
  ui.api.mockImplementation((path, init) => {
    if (String(path).includes('/owner-reschedule-proposals/') && !denied) { denied = true; return Promise.reject(new ApiError('Feature restricted', 403)); }
    return base(path, init);
  });
  await mount(true); await click('Comprobar acceso'); expect(text(renderer.root, true)).toContain('Consultar de nuevo');
  expect(button('Cerrar cambio').props.disabled).toBe(true);
  ui.api.mockResolvedValueOnce({ proposal: view, state: 'applied', result: proof, appointment: moved }); await click('Consultar de nuevo');
  expect(text(renderer.root, true)).toContain('Cambio comprobado'); expect(writes()).toHaveLength(0);
});
