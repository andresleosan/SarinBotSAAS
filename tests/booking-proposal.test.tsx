import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { BookingProposal } from '@/components/booking-proposal';
const proposal = { id: 'synthetic-proposal', businessId: 'business', serviceName: 'Corte', resourceName: 'Mateo', dateKey: '2030-01-07', startTimeStr: '09:00', endTimeStr: '09:30', priceCOP: 20000, expiresAt: 2000000, intakeFields: [{ key: 'note', label: 'Preferencia', required: false }] };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer;
afterEach(async () => { await act(async () => renderer?.unmount()); });
it('shows the server summary and confirms only with locally collected contact', async () => {
  const confirm = vi.fn();
  await act(async () => { renderer = create(createElement(BookingProposal, { proposal, confirming: false, onConfirm: confirm })); });
  expect(confirm).not.toHaveBeenCalled(); expect(JSON.stringify(renderer.toJSON())).toContain('Mateo');
  await act(async () => { renderer.root.findByProps({ 'aria-label': 'Teléfono para la cita' }).props.onChange({ target: { value: '573001234567' } }); renderer.root.findByProps({ 'aria-label': 'Preferencia' }).props.onChange({ target: { value: 'Sin perfume' } }); });
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  expect(confirm).toHaveBeenCalledWith(proposal.id, { clientPhone: '573001234567', intakeAnswers: { note: 'Sin perfume' } });
  await act(async () => renderer.update(createElement(BookingProposal, { proposal, confirming: true, onConfirm: confirm })));
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  expect(confirm).toHaveBeenCalledTimes(1);
});

it('locks contact fields during recovery and retries the same proposal with the collected contact intact', async () => {
  const confirm = vi.fn();
  await act(async () => { renderer = create(createElement(BookingProposal, { proposal, confirming: false, onConfirm: confirm })); });
  await act(async () => {
    renderer.root.findByProps({ 'aria-label': 'Teléfono para la cita' }).props.onChange({ target: { value: '573001234567' } });
    renderer.root.findByProps({ 'aria-label': 'Preferencia' }).props.onChange({ target: { value: 'Sin perfume' } });
  });
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  const recoveringProps = { proposal, confirming: false, recovering: true, onConfirm: confirm };
  await act(async () => renderer.update(createElement(BookingProposal, recoveringProps)));
  expect(renderer.root.findByProps({ 'aria-label': 'Teléfono para la cita' }).props).toMatchObject({ disabled: true, value: '573001234567' });
  expect(renderer.root.findByProps({ 'aria-label': 'Preferencia' }).props).toMatchObject({ disabled: true, value: 'Sin perfume' });
  expect(renderer.root.findByType('button').children.join('')).toBe('Recuperar confirmación');
  expect(renderer.root.findByType('button').props.disabled).toBe(false);
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  expect(confirm.mock.calls).toEqual([
    ['synthetic-proposal', { clientPhone: '573001234567', intakeAnswers: { note: 'Sin perfume' } }],
    ['synthetic-proposal', { clientPhone: '573001234567', intakeAnswers: { note: 'Sin perfume' } }],
  ]);
});

it.each([
  { confirming: true, disabled: false, label: 'Confirmando…' },
  { confirming: false, disabled: true, label: 'Confirmar cita' },
])('blocks recovery submission when confirming=$confirming and disabled=$disabled', async ({ confirming, disabled, label }) => {
  const confirm = vi.fn();
  const props = { proposal, confirming, disabled, recovering: true, onConfirm: confirm };
  await act(async () => { renderer = create(createElement(BookingProposal, props)); });
  expect(renderer.root.findAllByType('input').every(input => input.props.disabled === true)).toBe(true);
  expect(renderer.root.findByType('button').children.join('')).toBe(label);
  expect(renderer.root.findByType('button').props.disabled).toBe(true);
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  expect(confirm).not.toHaveBeenCalled();
});
