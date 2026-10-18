import { act, createElement, StrictMode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppointmentReminders } from '@/hooks/use-appointment-reminders';
import { apiFetch, ApiError } from '@/lib/client/api';
import type { AppointmentReminders, ReminderOccurrence } from '@/types/appointment-reminders';

vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const now = Date.parse('2030-01-01T15:00:00Z');
const occurrence: ReminderOccurrence = { appointmentId: 'visit', sourceRevision: 0, sourceStartAt: now + 3600000, offsetMinutes: 1440 };
const active: AppointmentReminders = { businessId: 'shop', ownerUid: 'customer', serverNow: now, preference: { enabled: true, revision: 1, status: 'active', offsetMinutes: 1440 }, reminders: [{ ...occurrence, availableAt: now - 82800000, seenAt: null }] };
const disabled: AppointmentReminders = { ...active, preference: { enabled: false, revision: 0, status: 'disabled', offsetMinutes: 1440 }, reminders: [] };
type Props = { businessId?: string; userId?: string; now?: number; currentOccurrences?: ReminderOccurrence[] | null; actionsLocked?: boolean };
let renderer: ReactTestRenderer | undefined, controller!: ReturnType<typeof useAppointmentReminders>, response: AppointmentReminders, page: EventTarget & { visibilityState: string }, browser: EventTarget;
function Harness({ businessId = 'shop', userId = 'customer', now: clock = now, currentOccurrences = [occurrence], actionsLocked = false }: Props) { controller = useAppointmentReminders(businessId, userId, { now: clock, currentOccurrences, actionsLocked }); return null; }
async function mount(props: Props = {}) { await act(async () => { renderer = create(createElement(StrictMode, null, createElement(Harness, props))); }); }
async function update(props: Props) { await act(async () => renderer!.update(createElement(StrictMode, null, createElement(Harness, props)))); }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); response = structuredClone(active);
  page = Object.assign(new EventTarget(), { visibilityState: 'visible' }); browser = new EventTarget(); vi.stubGlobal('document', page); vi.stubGlobal('window', browser);
  vi.mocked(apiFetch).mockReset().mockImplementation(async () => response);
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });

it('reads only its scope, keeps the preference off and never marks reminders during reads or refreshes', async () => {
  response = disabled; await mount(); expect(controller.preference?.status).toBe('disabled'); expect(controller.reminders).toEqual([]);
  await act(async () => { browser.dispatchEvent(new Event('focus')); });
  expect(vi.mocked(apiFetch).mock.calls.every(([path, init, uid]) => path === '/api/businesses/shop/reminders' && !init?.method && uid === 'customer')).toBe(true);
});

it('enables with the observed revision and blocks duplicate mutations in the same event', async () => {
  response = disabled; await mount(); const pending = deferred<AppointmentReminders>();
  vi.mocked(apiFetch).mockImplementation(async (_path, init) => init?.method ? pending.promise : response);
  let first!: Promise<void>; await act(async () => { first = controller.setEnabled(true); void controller.setEnabled(true); });
  expect(controller.savingPreference).toBe(true);
  expect(vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
  expect(JSON.parse(vi.mocked(apiFetch).mock.calls.at(-1)![1]!.body as string)).toEqual({ enabled: true, expectedRevision: 0 });
  response = active; await act(async () => { pending.resolve(active); await first; }); expect(controller.preference?.status).toBe('active'); expect(controller.reminders).toHaveLength(1);
});

it('hides immediately on disable, aborts an older read and cannot be reactivated by its late result', async () => {
  await mount(); const oldRead = deferred<AppointmentReminders>(), save = deferred<AppointmentReminders>(); let signal!: AbortSignal;
  vi.mocked(apiFetch).mockImplementation((_path, init) => { if (init?.method) return save.promise; signal = init!.signal as AbortSignal; return oldRead.promise; });
  await act(async () => browser.dispatchEvent(new Event('focus'))); let mutation!: Promise<void>;
  await act(async () => { mutation = controller.setEnabled(false); }); expect(controller.reminders).toEqual([]); expect(signal.aborted).toBe(true);
  await act(async () => oldRead.resolve(active)); expect(controller.reminders).toEqual([]);
  response = { ...disabled, preference: { ...disabled.preference, revision: 2 } }; vi.mocked(apiFetch).mockResolvedValue(response);
  await act(async () => { save.resolve(response); await mutation; }); expect(controller.preference?.status).toBe('disabled');
});

it('reconciles an uncertain preference with GET without replaying the old decision', async () => {
  await mount(); const read = deferred<AppointmentReminders>();
  vi.mocked(apiFetch).mockImplementation((_path, init) => init?.method ? Promise.reject(new Error('Respuesta perdida')) : read.promise);
  await act(async () => controller.setEnabled(false)); expect(controller.reconciling).toBe(true); expect(controller.reminders).toEqual([]);
  await act(async () => controller.setEnabled(true)); expect(vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
  await act(async () => read.resolve({ ...disabled, preference: { ...disabled.preference, revision: 2 } })); expect(controller.reconciling).toBe(false); expect(controller.preference?.status).toBe('disabled');
});

it('keeps a failed reconciliation explicit and retries only the read', async () => {
  await mount(); vi.mocked(apiFetch).mockRejectedValue(new Error('Sin conexión'));
  await act(async () => controller.setEnabled(false)); expect(controller.readError).toContain('Sin conexión'); expect(controller.reconciling).toBe(true); expect(controller.reminders).toEqual([]);
  vi.mocked(apiFetch).mockResolvedValue({ ...disabled, preference: { ...disabled.preference, revision: 2 } }); await act(async () => controller.refresh());
  expect(controller.reconciling).toBe(false); expect(controller.readError).toBeNull(); expect(vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
});

it('clears an obsolete lost-preference error only after GET confirms the actual saved state, without replaying PATCH', async () => {
  response = disabled; await mount(); const read = deferred<AppointmentReminders>();
  vi.mocked(apiFetch).mockImplementation((_path, init) => init?.method ? Promise.reject(new TypeError('Failed to fetch')) : read.promise);
  await act(async () => controller.setEnabled(true)); expect(controller.actionError).toBeTruthy(); expect(controller.reconciling).toBe(true);
  await act(async () => read.resolve(active)); expect(controller.preference?.status).toBe('active'); expect(controller.reminders).toHaveLength(1); expect(controller.actionError).toBeNull();
  expect(vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
});

it('keeps both connection failures understandable in Spanish while preference reconciliation remains unresolved', async () => {
  await mount(); vi.mocked(apiFetch).mockRejectedValue(new TypeError('Failed to fetch'));
  await act(async () => controller.setEnabled(false)); expect(controller.actionError).toContain('conexión'); expect(controller.readError).toContain('conexión');
  expect(`${controller.actionError} ${controller.readError}`).not.toContain('Failed to fetch'); expect(controller.reconciling).toBe(true); expect(controller.reminders).toEqual([]);
  expect(vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
});

it('preserves an unrelated seen failure and its exact retry when the automatic GET succeeds', async () => {
  await mount(); vi.mocked(apiFetch).mockImplementation(async (_path, init) => { if (init?.method === 'POST') throw new Error('No se confirmó el visto'); return active; });
  await act(async () => controller.markSeen(occurrence)); expect(controller.readError).toBeNull(); expect(controller.actionError).toBe('No se confirmó el visto'); expect(controller.retryOccurrence).toEqual(occurrence);
});

it('keeps a definite preference rejection actionable after GET confirms that it remains disabled', async () => {
  response = disabled; await mount(); vi.mocked(apiFetch).mockImplementation(async (_path, init) => { if (init?.method === 'PATCH') throw new ApiError('Revisa tus permisos antes de activar recordatorios.', 428); return disabled; });
  await act(async () => controller.setEnabled(true)); expect(controller.preference?.status).toBe('disabled'); expect(controller.reconciling).toBe(false); expect(controller.actionError).toContain('Revisa tus permisos');
});

it('shows suspended permissions without reminders and explicitly re-enables with the current revision', async () => {
  response = { ...active, preference: { ...active.preference, status: 'suspended' }, reminders: [] }; await mount(); expect(controller.preference?.status).toBe('suspended'); expect(controller.reminders).toEqual([]);
  response = { ...active, preference: { ...active.preference, revision: 2 } }; await act(async () => controller.setEnabled(true));
  const write = vi.mocked(apiFetch).mock.calls.find(([, init]) => init?.method); expect(JSON.parse(write![1]!.body as string)).toEqual({ enabled: true, expectedRevision: 1 }); expect(controller.preference?.status).toBe('active');
});

it('marks only after an explicit action and preserves a durable original seen timestamp', async () => {
  await mount(); expect(controller.reminders[0].seenAt).toBeNull(); const seenAt = now - 10;
  vi.mocked(apiFetch).mockImplementation(async (_path, init) => { if (init?.method) { response = { ...active, reminders: [{ ...active.reminders[0], seenAt }] }; return { reminder: response.reminders[0] }; } return response; });
  const retained = controller.markSeen; await act(async () => { void retained(occurrence); void retained(occurrence); });
  expect(controller.reminders[0].seenAt).toBe(seenAt); const writes = vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method); expect(writes).toHaveLength(1); expect(writes[0][0]).toBe('/api/businesses/shop/reminders/seen'); expect(JSON.parse(writes[0][1]!.body as string)).toEqual(occurrence);
  await act(async () => controller.markSeen(occurrence)); expect(vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
});

it('retries a lost seen response using the identical occurrence and never marks a changed occurrence', async () => {
  await mount(); let writes = 0;
  vi.mocked(apiFetch).mockImplementation(async (_path, init) => { if (init?.method) { writes++; if (writes === 1) throw new Error('Respuesta perdida'); response = { ...active, reminders: [{ ...active.reminders[0], seenAt: now }] }; return { reminder: response.reminders[0] }; } return response; });
  await act(async () => controller.markSeen(occurrence)); expect(controller.retryOccurrence).toEqual(occurrence);
  await act(async () => controller.retrySeen()); const bodies = vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method).map(([, init]) => init!.body); expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]); expect(controller.retryOccurrence).toBeNull();
});

it.each(['cancel', 'reschedule', 'revision', 'canonical-read', 'clock', 'lock'])('rejects a retained seen action after %s', async change => {
  await mount(); const retained = controller.markSeen;
  if (change === 'cancel') await update({ currentOccurrences: [] });
  if (change === 'reschedule') await update({ currentOccurrences: [{ ...occurrence, sourceStartAt: occurrence.sourceStartAt + 1000 }] });
  if (change === 'revision') await update({ currentOccurrences: [{ ...occurrence, sourceRevision: 2 }] });
  if (change === 'canonical-read') await update({ currentOccurrences: null });
  if (change === 'clock') vi.setSystemTime(occurrence.sourceStartAt);
  if (change === 'lock') await update({ actionsLocked: true });
  vi.mocked(apiFetch).mockClear(); await act(async () => retained(occurrence)); expect(apiFetch).not.toHaveBeenCalled();
  if (change !== 'lock' && change !== 'clock') expect(controller.reminders).toEqual([]);
});

it.each(['account', 'business', 'unmount'])('aborts outstanding requests, discards late data and rejects retained writes after %s', async change => {
  await mount(); const retained = controller.setEnabled, read = deferred<AppointmentReminders>(); let signal!: AbortSignal;
  vi.mocked(apiFetch).mockImplementation((_path, init) => { signal = init!.signal as AbortSignal; return read.promise; }); await act(async () => browser.dispatchEvent(new Event('focus'))); const previous = signal;
  if (change === 'account') await update({ userId: 'other' });
  if (change === 'business') await update({ businessId: 'other-shop' });
  if (change === 'unmount') { await act(async () => renderer!.unmount()); renderer = undefined; }
  expect(previous.aborted).toBe(true); vi.mocked(apiFetch).mockClear(); await act(async () => { read.resolve(active); await retained(false); }); expect(apiFetch).not.toHaveBeenCalled();
  if (change !== 'unmount') expect(controller.reminders).toEqual([]);
});

it('rejects a retained preference handler after the observed revision changes', async () => {
  await mount(); const retained = controller.setEnabled; response = { ...active, preference: { ...active.preference, revision: 3 } }; await act(async () => browser.dispatchEvent(new Event('focus'))); vi.mocked(apiFetch).mockClear();
  await act(async () => retained(false)); expect(apiFetch).not.toHaveBeenCalled();
});

it('never turns read errors or foreign responses into a successful empty result', async () => {
  await mount(); vi.mocked(apiFetch).mockRejectedValue(new Error('Lectura fallida')); await act(async () => browser.dispatchEvent(new Event('focus'))); expect(controller.readError).toContain('Lectura fallida'); expect(controller.reminders).toEqual([]);
  vi.mocked(apiFetch).mockResolvedValue({ ...active, ownerUid: 'other' }); await act(async () => controller.refresh()); expect(controller.readError).toBeTruthy(); expect(controller.reminders).toEqual([]);
});

it('keeps unverified old reminders hidden while a failed read is retried', async () => {
  await mount(); vi.mocked(apiFetch).mockRejectedValue(new Error('Lectura fallida')); await act(async () => browser.dispatchEvent(new Event('focus')));
  const read = deferred<AppointmentReminders>(); vi.mocked(apiFetch).mockReturnValue(read.promise); await act(async () => controller.refresh());
  expect(controller.reminders).toEqual([]); vi.mocked(apiFetch).mockClear(); await act(async () => controller.markSeen(occurrence)); expect(apiFetch).not.toHaveBeenCalled();
  await act(async () => read.resolve(active)); expect(controller.reminders).toHaveLength(1);
});

it('uses the server clock at the inclusive 24-hour and exclusive start boundaries', async () => {
  const boundary = { ...occurrence, sourceStartAt: now + 86400000 }; response = { ...active, reminders: [{ ...boundary, availableAt: now, seenAt: null }] }; await mount({ currentOccurrences: [boundary] }); expect(controller.reminders).toHaveLength(1);
  await update({ currentOccurrences: [boundary], now: boundary.sourceStartAt }); expect(controller.reminders).toEqual([]);
  await update({ currentOccurrences: [boundary], now }); vi.setSystemTime(now + 86400000); vi.mocked(apiFetch).mockClear(); await act(async () => controller.markSeen(boundary)); expect(apiFetch).not.toHaveBeenCalled();
});

it('removes a reminder exactly at its start without a parent render, poll response or additional request', async () => {
  const imminent = { ...occurrence, sourceStartAt: now + 1000 }; response = { ...active, reminders: [{ ...imminent, availableAt: imminent.sourceStartAt - 86400000, seenAt: null }] };
  await mount({ currentOccurrences: [imminent] }); vi.mocked(apiFetch).mockClear();
  await act(async () => vi.advanceTimersByTimeAsync(999)); expect(controller.reminders).toHaveLength(1);
  await act(async () => vi.advanceTimersByTimeAsync(1)); expect(controller.reminders).toEqual([]); expect(apiFetch).not.toHaveBeenCalled();
});

it('clears the expiry timer while hidden and excludes expired reminders immediately on foreground even if the read is pending', async () => {
  const imminent = { ...occurrence, sourceStartAt: now + 1000 }; response = { ...active, reminders: [{ ...imminent, availableAt: imminent.sourceStartAt - 86400000, seenAt: null }] };
  await mount({ currentOccurrences: [imminent] }); page.visibilityState = 'hidden'; await act(async () => page.dispatchEvent(new Event('visibilitychange'))); expect(vi.getTimerCount()).toBe(0);
  await act(async () => vi.advanceTimersByTimeAsync(1000)); const read = deferred<AppointmentReminders>(); vi.mocked(apiFetch).mockReturnValue(read.promise);
  page.visibilityState = 'visible'; await act(async () => page.dispatchEvent(new Event('visibilitychange'))); expect(controller.reminders).toEqual([]);
  await act(async () => renderer!.unmount()); renderer = undefined; expect(vi.getTimerCount()).toBe(0);
});

it('stops polling when hidden, resumes on foreground and removes every timer after unmount', async () => {
  await mount(); vi.mocked(apiFetch).mockClear(); page.visibilityState = 'hidden'; await act(async () => page.dispatchEvent(new Event('visibilitychange'))); await act(async () => vi.advanceTimersByTimeAsync(45000)); expect(apiFetch).not.toHaveBeenCalled();
  page.visibilityState = 'visible'; await act(async () => page.dispatchEvent(new Event('visibilitychange'))); expect(apiFetch).toHaveBeenCalledTimes(1);
  await act(async () => renderer!.unmount()); renderer = undefined; vi.mocked(apiFetch).mockClear(); await act(async () => vi.advanceTimersByTimeAsync(45000)); expect(apiFetch).not.toHaveBeenCalled();
});

it('does not offer retry for a stale occurrence conflict', async () => {
  await mount(); vi.mocked(apiFetch).mockImplementation(async (_path, init) => { if (init?.method) throw new ApiError('La cita cambió', 409); return { ...active, reminders: [] }; });
  await act(async () => controller.markSeen(occurrence)); expect(controller.retryOccurrence).toBeNull(); expect(controller.actionError).toContain('La cita cambió'); expect(controller.reminders).toEqual([]);
});
