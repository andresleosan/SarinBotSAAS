vi.mock('@/components/consent-panel', () => ({ useAccountConsent: () => ({ active: true }) }));
import { act, createElement, StrictMode } from 'react';
import { create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ api: vi.fn(), user: { uid: 'admin' } as { uid: string } | null, admin: true }));
vi.mock('@/lib/client/api', () => ({ apiFetch: state.api, errorMessage: (error: Error) => error.message }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: state.user, isSuperadmin: state.admin }) }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: import('react').ReactNode; href: string }) => createElement('a', { href }, children) }));
import { AdminInvitations } from '@/components/admin-invitations';
import { InvitationRedeem } from '@/components/invitation-redeem';
import { ResponseQuota } from '@/components/response-quota';
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const invitation = { id: 'a'.repeat(24), recipientEmail: 'owner@example.test', maskedCode: 'SARIN-…secret', codeState: 'available', state: 'issued', createdAt: 1900000000000, expiresAt: 1900600000000, version: 0, usage: null };
const code = '000042';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe('invitation interfaces', () => {
  let renderer: ReactTestRenderer;
  const button = (label: string) => renderer.root.findAllByType('button').find(node => text(node).includes(label))!;
  beforeEach(() => { state.user = { uid: 'admin' }; state.admin = true; state.api.mockReset().mockResolvedValue({ invitations: [invitation], nextCursor: null }); });
  afterEach(async () => { await act(async () => renderer?.unmount()); vi.unstubAllGlobals(); });
  it('keeps a new code in memory after a copy failure and discards it explicitly', async () => {
    await act(async () => { renderer = create(createElement(AdminInvitations)); });
    const email = renderer.root.findAllByType('input').find(node => node.props.type === 'email')!;
    await act(async () => email.props.onChange({ target: { value: invitation.recipientEmail } }));
    state.api.mockResolvedValueOnce({ invitation, code, replayed: false });
    await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    expect(text(renderer.root)).toContain(code);
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('No disponible')) } });
    await act(async () => button('Copiar código').props.onClick());
    expect(text(renderer.root)).toContain(code);
    await act(async () => button('Descartar código').props.onClick());
    expect(text(renderer.root)).not.toContain(code);
  });
  it('does not display the cancelled first read during StrictMode effect recovery', async () => {
    let reads = 0;
    state.api.mockImplementation((_path: string, init: RequestInit) => ++reads === 1 ? new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('Aborted obsolete request')))) : Promise.resolve({ invitations: [], nextCursor: null }));
    await act(async () => { renderer = create(createElement(StrictMode, null, createElement(AdminInvitations))); });
    expect(reads).toBe(2);
    expect(text(renderer.root)).not.toContain('Aborted obsolete request');
  });
  it('retains create request identity for retry but changes it when the recipient changes', async () => {
    await act(async () => { renderer = create(createElement(AdminInvitations)); });
    const email = () => renderer.root.findAllByType('input').find(node => node.props.type === 'email')!;
    await act(async () => email().props.onChange({ target: { value: invitation.recipientEmail } }));
    state.api.mockRejectedValue(new Error('Red interrumpida'));
    for (let i = 0; i < 2; i++) await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    const posts = () => state.api.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init.body));
    expect(posts()[0].requestId).toBe(posts()[1].requestId);
    await act(async () => email().props.onChange({ target: { value: 'other@example.test' } }));
    await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    expect(posts()[2].requestId).not.toBe(posts()[0].requestId);
  });
  it('discards a late secret after the account changes', async () => {
    await act(async () => { renderer = create(createElement(AdminInvitations)); });
    await act(async () => renderer.root.findAllByType('input').find(node => node.props.type === 'email')!.props.onChange({ target: { value: invitation.recipientEmail } }));
    let resolve!: (value: unknown) => void;
    state.api.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    state.user = { uid: 'other' };
    state.admin = false;
    await act(async () => renderer.update(createElement(AdminInvitations)));
    await act(async () => resolve({ invitation, code, replayed: false }));
    expect(text(renderer.root)).not.toContain(code);
  });
  it('redeems without bank details, locks in flight and passes confirmed access to its parent', async () => {
    const onRedeemed = vi.fn();
    await act(async () => { renderer = create(createElement(InvitationRedeem, { onRedeemed })); });
    await act(async () => button('Tengo un código').props.onClick());
    await act(async () => renderer.root.findByType('input').props.onChange({ target: { value: code } }));
    let resolve!: (value: unknown) => void;
    state.api.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    expect(button('Canjeando').props.disabled).toBe(true);
    const result = { business: { id: 'business' }, invitationId: invitation.id, replayed: false };
    await act(async () => resolve(result));
    expect(onRedeemed).toHaveBeenCalledWith(result);
    expect(text(renderer.root)).toContain('Prueba de cortesía: diez citas y 700 respuestas; sin cobro');
  });
  it('labels courtesy response capacity in normal and compact displays', async () => {
    const allowance = { state: 'active', currentPeriod: { source: 'trial', includedResponses: 700, extraResponses: 0, usedResponses: 2, reservedResponses: 0, remainingResponses: 698 } } as any;
    for (const compact of [false, true]) {
      await act(async () => { renderer = create(createElement(ResponseQuota, { allowance, compact, introductorySource: 'invitation' })); });
      expect(text(renderer.root).toLowerCase()).toContain('cortesía');
      expect(text(renderer.root).toLowerCase()).not.toContain('pagada');
      await act(async () => renderer.unmount());
    }
  });
  it('refreshes the administrative parent after access changes without undoing successful commands', async () => {
    const redeemed = { ...invitation, state: 'redeemed', codeState: 'redeemed', usage: { appointmentsUsed: 1, responsesUsed: 3 }, access: { state: 'active' } };
    state.api.mockResolvedValueOnce({ invitations: [redeemed], nextCursor: null });
    const refresh = vi.fn().mockRejectedValue(new Error('Parent refresh unavailable'));
    await act(async () => { renderer = create(createElement(AdminInvitations, { onAccessChanged: refresh })); });
    await act(async () => button('Suspender cortesía').props.onClick());
    await act(async () => renderer.root.findAllByType('input').find(input => input.props.maxLength === 300)!.props.onChange({ target: { value: 'Synthetic review' } }));
    state.api.mockResolvedValueOnce({ invitation: { ...redeemed, access: { state: 'suspended' } }, replayed: false });
    await act(async () => renderer.root.findAllByType('form')[1].props.onSubmit({ preventDefault() {} }));
    expect(refresh).toHaveBeenCalledTimes(1); expect(text(renderer.root)).toContain('Control de cortesía actualizado'); expect(text(renderer.root)).toContain('Cortesía suspendida');
  });
});
