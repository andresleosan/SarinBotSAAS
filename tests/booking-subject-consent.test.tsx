import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { BookingSubjectConsent } from '@/components/booking-subject-consent';
import { useBookingSubjectConsent } from '@/hooks/useBookingSubjectConsent';
import { bookingSubjectContent, type BookingSubjectConsentStatus } from '@/lib/booking-subject-legal';
import { apiFetch } from '@/lib/client/api';
vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const business = { id: 'demo', name: 'Demo', phoneWhatsApp: '573001234567' }, subjectCase = { bookingRequestId: 'demo-ui-case', subjectKind: 'represented_minor' as const, representativeRole: 'parent' as const }, capability = { configured: true, revision: 1, dataMode: 'health' as const, representedMinorsEnabled: true };
const initial: BookingSubjectConsentStatus = { required: true, active: false, revision: 0, capability, receipt: null, documents: { ...bookingSubjectContent(business, subjectCase, capability), fingerprint: 'a'.repeat(64) } };
let renderer: ReactTestRenderer | undefined, controller!: ReturnType<typeof useBookingSubjectConsent>;
function Harness({ uid = 'demo-user' }: { uid?: string }) { controller = useBookingSubjectConsent(uid, business, subjectCase); return createElement(BookingSubjectConsent, { controller }); }
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.mocked(apiFetch).mockReset(); });
it('pediatrics requires all applicable explicit unchecked choices', async () => {
  vi.mocked(apiFetch).mockResolvedValue(initial); await act(async () => { renderer = create(createElement(Harness)); });
  const choices = renderer!.root.findAllByType('input'); expect(choices.map(input => input.props.checked)).toEqual([false, false, false]);
  const button = () => renderer!.root.findByProps({ 'aria-label': 'Autorizar esta reserva' }); expect(button().props.disabled).toBe(true);
  for (const input of choices.slice(0, 2)) await act(async () => input.props.onChange({ target: { checked: true } })); expect(button().props.disabled).toBe(true);
  await act(async () => choices[2].props.onChange({ target: { checked: true } })); expect(button().props.disabled).toBe(false);
  vi.mocked(apiFetch).mockResolvedValueOnce({ ...initial, active: true, revision: 1 });
  await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  expect(controller.active).toBe(true); const call = vi.mocked(apiFetch).mock.calls.find(call => call[1]?.method === 'POST')!;
  expect(call[2]).toBe('demo-user'); expect(JSON.parse(String(call[1]?.body))).toMatchObject({ case: subjectCase, decisions: { dataAuthorized: true, sensitiveDataAuthorized: true, representationDeclared: true } });
});
it('withdrawal stays closed across stale refresh and reuses its uncertain request', async () => {
  const accepted = { ...initial, active: true, revision: 1 }; let reject!: (value: Error) => void, currentRead = accepted;
  vi.mocked(apiFetch).mockImplementation((_, init) => init?.method === 'POST' ? new Promise((_resolve, fail) => { reject = fail; }) : Promise.resolve(currentRead));
  await act(async () => { renderer = create(createElement(Harness)); }); expect(controller.active).toBe(true);
  let pending!: Promise<void>; act(() => { pending = controller.revoke(); }); expect(controller.active).toBe(false);
  await act(async () => controller.refresh()); expect(controller.active).toBe(false);
  await act(async () => { reject(new Error('Respuesta perdida')); await pending; }); currentRead = { ...accepted, documents: { ...accepted.documents, fingerprint: 'b'.repeat(64) } }; await act(async () => controller.refresh()); expect(controller.active).toBe(false);
  const body = vi.mocked(apiFetch).mock.calls.find(call => call[1]?.method === 'POST')![1]?.body;
  vi.mocked(apiFetch).mockResolvedValueOnce({ ...initial, revision: 2 }); await act(async () => controller.revoke());
  expect(vi.mocked(apiFetch).mock.calls.filter(call => call[1]?.method === 'POST').at(-1)![1]?.body).toBe(body);
});
