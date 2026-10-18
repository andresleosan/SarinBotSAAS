import { act, createElement, StrictMode } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClientAppointmentReminders } from '@/components/client-appointment-reminders';
import { apiFetch } from '@/lib/client/api';
import type { AppointmentReminders, ReminderOccurrence } from '@/types/appointment-reminders';

vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const now = Date.parse('2030-01-02T02:00:00Z');
const occurrence: ReminderOccurrence = { appointmentId: 'visit', sourceRevision: 0, sourceStartAt: Date.parse('2030-01-02T03:00:00Z'), offsetMinutes: 1440 };
const active: AppointmentReminders = { businessId: 'shop', ownerUid: 'customer', serverNow: now, preference: { enabled: true, revision: 1, status: 'active', offsetMinutes: 1440 }, reminders: [{ ...occurrence, availableAt: occurrence.sourceStartAt - 86400000, seenAt: null }] };
type Props = Parameters<typeof ClientAppointmentReminders>[0];
let props: Props, response: AppointmentReminders, renderer: ReactTestRenderer | undefined;
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const button = (label: string) => renderer!.root.findAllByType('button').find(node => text(node) === label)!;
async function mount() { await act(async () => { renderer = create(createElement(StrictMode, null, createElement(ClientAppointmentReminders, props))); }); }
async function update(change: Partial<Props>) { props = { ...props, ...change }; await act(async () => renderer!.update(createElement(StrictMode, null, createElement(ClientAppointmentReminders, props)))); }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); response = structuredClone(active);
  props = { businessId: 'shop', userId: 'customer', now, actionsLocked: false, currentOccurrences: [occurrence], onViewAppointment: vi.fn() };
  vi.mocked(apiFetch).mockReset().mockImplementation(async () => response);
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); });

it('presents an optional per-business switch without asking for browser notification permission', async () => {
  response = { ...active, preference: { ...active.preference, enabled: false, status: 'disabled', revision: 0 }, reminders: [] }; await mount();
  const toggle = renderer!.root.find(node => node.props.role === 'switch'); expect(toggle.props['aria-checked']).toBe(false); expect(text(renderer!.root)).not.toContain('Tu cita se acerca'); expect(text(renderer!.root)).not.toContain('No tienes recordatorios pendientes');
  expect(text(renderer!.root)).toContain('no se envían con la app cerrada'); response = active;
  await act(async () => toggle.props.onClick()); expect(renderer!.root.find(node => node.props.role === 'switch').props['aria-checked']).toBe(true);
});

it('shows only a generic reminder, Colombia date/time and explicit seen controls', async () => {
  await mount(); const visible = text(renderer!.root); expect(visible).toContain('Tu cita se acerca'); expect(visible).toContain('1 de enero de 2030'); expect(visible).toContain('22:00'); expect(visible).toContain('Colombia');
  expect(button('Ver cita')).toBeTruthy(); expect(button('Marcar como visto')).toBeTruthy(); expect(vi.mocked(apiFetch).mock.calls.every(([, init]) => !init?.method)).toBe(true);
  await act(async () => button('Ver cita').props.onClick()); expect(props.onViewAppointment).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(occurrence)); expect(vi.mocked(apiFetch).mock.calls.every(([, init]) => !init?.method)).toBe(true);
});

it('moves an explicitly seen reminder to a native collapsed group and preserves it after reload', async () => {
  await mount(); vi.mocked(apiFetch).mockImplementation(async (_path, init) => { if (init?.method === 'POST') { response = { ...active, reminders: [{ ...active.reminders[0], seenAt: now }] }; return { reminder: response.reminders[0] }; } return response; });
  await act(async () => button('Marcar como visto').props.onClick()); expect(button('Marcar como visto')).toBeUndefined(); expect(renderer!.root.findByType('summary').children.join('')).toContain('Vistos'); expect(renderer!.root.findByType('details').props.open).not.toBe(true);
  await act(async () => renderer!.unmount()); renderer = undefined; await mount(); expect(renderer!.root.findByType('summary').children.join('')).toContain('Vistos'); expect(button('Marcar como visto')).toBeUndefined();
});

it('distinguishes loading, read error/retry and a successful empty response', async () => {
  let finish!: (value: unknown) => void; vi.mocked(apiFetch).mockImplementation(() => new Promise(resolve => { finish = resolve; })); await mount(); expect(text(renderer!.root)).toContain('Cargando recordatorios'); expect(text(renderer!.root)).not.toContain('No tienes recordatorios pendientes');
  await act(async () => finish({ ...active, ownerUid: 'wrong' })); expect(text(renderer!.root)).toContain('No pudimos cargar tus recordatorios'); expect(text(renderer!.root)).not.toContain('No tienes recordatorios pendientes');
  vi.mocked(apiFetch).mockResolvedValue({ ...active, reminders: [] }); await act(async () => button('Reintentar cargar recordatorios').props.onClick()); expect(text(renderer!.root)).toContain('No tienes recordatorios pendientes');
});

it('retains preference controls while the canonical appointments are unavailable and hides stale reminders', async () => {
  props.currentOccurrences = null; await mount(); expect(renderer!.root.find(node => node.props.role === 'switch')).toBeTruthy(); expect(text(renderer!.root)).toContain('Comprobando tus citas'); expect(text(renderer!.root)).not.toContain('Tu cita se acerca'); expect(text(renderer!.root)).not.toContain('No tienes recordatorios pendientes');
});

it('offers explicit reactivation and disabling after consent revisions suspend the preference', async () => {
  response = { ...active, preference: { ...active.preference, status: 'suspended' }, reminders: [] }; await mount(); expect(text(renderer!.root)).toContain('Revisa tus permisos'); expect(button('Reactivar recordatorios')).toBeTruthy(); expect(button('Desactivar recordatorios')).toBeTruthy(); expect(text(renderer!.root)).not.toContain('No tienes recordatorios pendientes');
});

it.each(['lock', 'cancel', 'reschedule', 'account', 'clock'])('rejects retained view actions after %s changes', async change => {
  await mount(); const retained = button('Ver cita').props.onClick;
  if (change === 'lock') await update({ actionsLocked: true });
  if (change === 'cancel') await update({ currentOccurrences: [] });
  if (change === 'reschedule') await update({ currentOccurrences: [{ ...occurrence, sourceRevision: 1, sourceStartAt: occurrence.sourceStartAt + 1000 }] });
  if (change === 'account') await update({ userId: 'other' });
  if (change === 'clock') vi.setSystemTime(occurrence.sourceStartAt);
  await act(async () => retained()); expect(props.onViewAppointment).not.toHaveBeenCalled();
});

it('leaves disabling available while booking actions are locked and disables view/seen', async () => {
  props.actionsLocked = true; await mount(); expect(button('Ver cita').props.disabled).toBe(true); expect(button('Marcar como visto').props.disabled).toBe(true); expect(button('Desactivar recordatorios').props.disabled).toBe(false);
});
