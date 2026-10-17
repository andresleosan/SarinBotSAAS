import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { RepresentationReviewControls } from '@/components/representation-review';
import type { Appointment } from '@/types/firestore';
const state = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/client/api', () => ({ apiFetch: state.api, errorMessage: (error: Error) => error.message }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: { uid: 'demo-owner' } }) }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer;
afterEach(async () => { await act(async () => renderer?.unmount()); state.api.mockReset(); });
it('needs contact updates review without cancelling the appointment', async () => {
  const appointment = { id: 'demo-appointment', tenantId: 'demo-business', status: 'confirmed', type: 'appointment', beneficiary: { kind: 'represented_minor', displayName: 'SYNTHETIC_PRIVATE_SUBJECT', representativeRole: 'parent' }, client: { uid: 'demo-client' }, representationReview: { revision: 0, status: 'declared', reviewedBy: null, reviewedAt: null } } as Appointment;
  const saved = { ...appointment, representationReview: { revision: 1, status: 'needs_contact', reviewedBy: 'demo-owner', reviewedAt: 1 } }, onSaved = vi.fn(); state.api.mockResolvedValue({ appointment: saved });
  await act(async () => { renderer = create(createElement(RepresentationReviewControls, { businessId: appointment.tenantId, appointment, onSaved })); });
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Marcar representación pendiente de contacto' }).props.onClick());
  expect(onSaved).toHaveBeenCalledWith(saved); expect(state.api.mock.calls[0][0]).toContain('/representation-review'); expect(JSON.parse(state.api.mock.calls[0][1].body)).toEqual({ expectedRevision: 0, status: 'needs_contact' }); expect(state.api.mock.calls[0][2]).toBe('demo-owner');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('parentesco verificado');
});
