import { act, createElement } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StructuredBooking } from '@/components/structured-booking';
import { BookingProposal } from '@/components/booking-proposal';
import { apiFetch } from '@/lib/client/api';
import type { PublicBusiness } from '@/types/firestore';

const access = vi.hoisted(() => ({ active: true }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: { uid: 'demo-user' } }) }));
vi.mock('@/hooks/useBookingSubjectConsent', () => ({ useBookingSubjectConsent: () => ({ active: access.active, loading: false, error: null, status: { required: false } }) }));
vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
vi.mock('@/hooks/useEngineHealth', () => ({ useEngineHealth: () => { throw new Error('Calendar search must not call inference'); } }));
vi.mock('@/hooks/useDebouncedChat', () => ({ useDebouncedChat: () => { throw new Error('Calendar search must not call chat'); } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const capability = { configured: true, revision: 1, dataMode: 'general' as const, representedMinorsEnabled: false };
const business = { id: 'demo-business', name: 'Demo', phoneWhatsApp: '573001234567', services: [{ id: 'cut', name: 'Corte', price: 15000, durationMinutes: 30, bufferMinutes: 5, resourceIds: ['one'] }], resources: [{ id: 'one', name: 'Ana', active: true }], subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: 9999999999999 } } as unknown as PublicBusiness;
const found = { dateKey: '2030-01-03', availability: [{ resourceId: 'one', resourceName: 'Ana', slots: ['09:00'] }], fromDateKey: '2030-01-02', throughDateKey: '2030-01-15' };
let renderer: ReactTestRenderer | undefined;
const props = { business, capability, initialSubjectKind: 'self' as const, initialServiceId: 'cut', onConfirmed: vi.fn() };
function content(node: ReactTestInstance): string { return node.children.map(child => typeof child === 'string' ? child : content(child)).join(''); }
const buttons = (label: string) => renderer!.root.findAllByType('button').filter(button => content(button) === label);
const statuses = () => renderer!.root.findAllByProps({ role: 'status' }).map(content);
const day = () => renderer!.root.findByProps({ type: 'date' });
async function click(label: string) { const matches = buttons(label); expect(matches).toHaveLength(1); await act(async () => matches[0].props.onClick()); }
async function mount() { await act(async () => { renderer = create(createElement(StructuredBooking, props)); }); await act(async () => day().props.onChange({ target: { value: '2030-01-01' } })); }
async function dailyEmpty() { await mount(); vi.mocked(apiFetch).mockResolvedValueOnce({ availability: [] }); await click('Consultar horarios'); }
beforeEach(() => { access.active = true; vi.spyOn(Date, 'now').mockReturnValue(new Date('2030-01-01T12:00:00Z').getTime()); });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.mocked(apiFetch).mockReset(); vi.restoreAllMocks(); });

it('offers the next-date search only after a successful daily read with no times', async () => {
  await mount();
  expect(buttons('Buscar próxima fecha disponible')).toHaveLength(0);
  let resolve!: (value: unknown) => void;
  vi.mocked(apiFetch).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await click('Consultar horarios');
  expect(buttons('Buscar próxima fecha disponible')).toHaveLength(0);
  await act(async () => resolve({ availability: found.availability }));
  expect(buttons('Buscar próxima fecha disponible')).toHaveLength(0);
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Sin conexión'));
  await click('Consultar horarios');
  expect(buttons('Buscar próxima fecha disponible')).toHaveLength(0);
  vi.mocked(apiFetch).mockResolvedValueOnce({ availability: [] });
  await click('Consultar horarios');
  expect(buttons('Buscar próxima fecha disponible')).toHaveLength(1);
  expect(buttons('Buscar próxima fecha disponible')[0].props.className).toContain('min-h-11');
  expect(vi.mocked(apiFetch).mock.calls.every(([path]) => path.endsWith('/availability'))).toBe(true);
});

it('announces search loading once and lets the client choose a time on the found date', async () => {
  await dailyEmpty();
  let resolve!: (value: unknown) => void;
  vi.mocked(apiFetch).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await click('Buscar próxima fecha disponible');
  expect(buttons('Buscando próxima fecha…')[0].props.disabled).toBe(true);
  expect(statuses().filter(text => text.includes('No hay horarios disponibles'))).toHaveLength(0);
  expect(buttons('Consultar horarios')[0].props.disabled).toBe(true);
  await act(async () => resolve({ nextAvailability: found }));
  expect(day().props.value).toBe('2030-01-03');
  expect(renderer!.root.findByProps({ 'aria-label': 'Recurso de la reserva' }).props.value).toBe('');
  expect(renderer!.root.findAllByProps({ 'aria-pressed': true })).toHaveLength(0);
  expect(buttons('Revisar propuesta')[0].props.disabled).toBe(true);
  expect(statuses().join(' ')).toContain('3 de enero de 2030');
  expect(buttons('09:00')).toHaveLength(1);
  await click('09:00');
  expect(buttons('Revisar propuesta')[0].props.disabled).toBe(false);
  expect(vi.mocked(apiFetch).mock.calls).toHaveLength(2);
});

it('moves focus to the found-date message before the time buttons without stealing it on later renders', async () => {
  let focusedMessage = '', focusCount = 0;
  await act(async () => { renderer = create(createElement(StructuredBooking, props), { createNodeMock: element => {
    const nodeProps = element.props as { role?: string; children?: unknown[] };
    return element.type === 'p' && nodeProps.role === 'status' ? { focus: () => { focusedMessage = (nodeProps.children ?? []).join(''); focusCount++; } } : null;
  } }); });
  await act(async () => day().props.onChange({ target: { value: '2030-01-01' } }));
  vi.mocked(apiFetch).mockResolvedValueOnce({ availability: [] });
  await click('Consultar horarios');
  expect(focusCount).toBe(0);
  vi.mocked(apiFetch).mockResolvedValueOnce({ nextAvailability: found });
  await click('Buscar próxima fecha disponible');
  expect(focusedMessage).toContain('3 de enero de 2030');
  expect(focusCount).toBe(1);
  const resultMessage = renderer!.root.findAllByProps({ role: 'status' }).find(node => content(node).includes('3 de enero de 2030'))!;
  expect(resultMessage.props.tabIndex).toBe(-1);
  expect(buttons('09:00')[0].props.disabled).not.toBe(true);
  await act(async () => renderer!.update(createElement(StructuredBooking, { ...props, onConfirmed: vi.fn() })));
  expect(focusCount).toBe(1);
});

it('explains the bounded empty range in Colombian dates and allows manual selection', async () => {
  await dailyEmpty();
  vi.mocked(apiFetch).mockResolvedValueOnce({ nextAvailability: { ...found, dateKey: null, availability: [] } });
  await click('Buscar próxima fecha disponible');
  expect(statuses()).toHaveLength(1);
  expect(statuses()[0]).toContain('2 de enero de 2030');
  expect(statuses()[0]).toContain('15 de enero de 2030');
  expect(statuses()[0]).toMatch(/elige otro día/i);
  expect(day().props.disabled).toBe(false);
  expect(day().props.value).toBe('2030-01-01');
  await act(async () => day().props.onChange({ target: { value: '2030-01-20' } }));
  expect(statuses()).toHaveLength(0);
  expect(buttons('Buscar próxima fecha disponible')).toHaveLength(0);
});

it('shows an actionable search error without claiming that the calendar is full', async () => {
  await dailyEmpty();
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Sin conexión. Intenta otra vez.'));
  await click('Buscar próxima fecha disponible');
  expect(JSON.stringify(renderer!.toJSON())).toContain('Sin conexión. Intenta otra vez.');
  expect(statuses().some(text => text.includes('No hay horarios disponibles'))).toBe(false);
  expect(buttons('Buscar próxima fecha disponible')[0].props.disabled).toBe(false);
  expect(day().props.value).toBe('2030-01-01');
});

it.each(['enabled', 'permission', 'subscription'] as const)('blocks a retained search click when %s is withdrawn', async gate => {
  await dailyEmpty();
  expect(buttons('Buscar próxima fecha disponible')).toHaveLength(1);
  const retained = buttons('Buscar próxima fecha disponible')[0].props.onClick;
  if (gate === 'permission') access.active = false;
  await act(async () => renderer!.update(createElement(StructuredBooking, { ...props, ...(gate === 'enabled' ? { enabled: false } : {}), ...(gate === 'subscription' ? { business: { ...business, subscription: { ...business.subscription, status: 'suspended' } } as PublicBusiness } : {}) })));
  await act(async () => retained());
  expect(vi.mocked(apiFetch).mock.calls).toHaveLength(1);
});

it('disables the proposal confirmation and blocks its retained callback when the business subscription is suspended', async () => {
  await mount();
  vi.mocked(apiFetch).mockResolvedValueOnce({ availability: found.availability });
  await click('Consultar horarios'); await click('09:00');
  vi.mocked(apiFetch).mockResolvedValueOnce({ proposal: { id: 'demo-proposal', businessId: 'demo-business', serviceName: 'Corte', resourceName: 'Ana', dateKey: '2030-01-01', startTimeStr: '09:00', endTimeStr: '09:30', priceCOP: 15000, intakeFields: [], expiresAt: Date.now() + 600000 } });
  await click('Revisar propuesta');
  expect(buttons('Confirmar cita')[0].props.disabled).toBe(false);
  const retainedConfirm = renderer!.root.findByType(BookingProposal).props.onConfirm;
  await act(async () => renderer!.update(createElement(StructuredBooking, { ...props, business: { ...business, subscription: { ...business.subscription, status: 'suspended' } } as PublicBusiness })));
  expect(buttons('Confirmar cita')[0].props.disabled).toBe(true);
  vi.mocked(apiFetch).mockResolvedValueOnce({ appointment: { id: 'demo-appointment', tenantId: 'demo-business', client: { uid: 'demo-user' } } });
  await act(async () => retainedConfirm('demo-proposal', { clientPhone: '573001234567', intakeAnswers: {} }));
  expect(vi.mocked(apiFetch).mock.calls).toHaveLength(2);
});
