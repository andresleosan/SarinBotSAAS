import { act, createElement, type ReactNode } from 'react';
import { create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FactualFaqPage from '@/app/dashboard/faq/page';
import { BusinessFactualFaqEditor } from '@/components/business-factual-faq-editor';
import type { Business } from '@/types/firestore';
const state = vi.hoisted(() => ({ uid: 'demo-owner', error: null as string | null, loading: false, ownerUid: 'demo-owner', denied: null as null | (() => void) }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: { uid: state.uid }, authEpoch: 1, isCurrentSession: (uid: string, epoch: number) => uid === state.uid && epoch === 1 }), AuthGate: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/lib/firebase/client', () => ({ getFirebaseClient: () => ({ auth: { currentUser: { uid: state.uid, getIdToken: async () => 'demo-token' } } }) }));
vi.mock('@/hooks/useBusiness', () => ({ useBusiness: (options?: { onAccessDenied: (failure: { status: number; source: string }) => void }) => { state.denied = () => options?.onAccessDenied({ status: 403, source: 'owner_authority' }); return ({ business: { id: 'demo-general', ownerUid: state.ownerUid } as Business, error: state.error, loading: state.loading }); } }));
vi.mock('@/components/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children, Notice: ({ children }: { children: ReactNode }) => createElement('p', null, children), buttonClass: 'button' }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let tree: ReactTestRenderer | undefined;
const fetchMock = vi.fn<typeof fetch>();
const view = { state: { version: 1, businessId: 'demo-general', revision: 0, items: [], updatedAt: null }, policyRevision: 1, eligible: true, applied: null };
const reply = () => Response.json(view);
const controller = () => tree!.root.findByType(BusinessFactualFaqEditor).props.controller;
async function update() { await act(async () => tree!.update(createElement(FactualFaqPage))); }
beforeEach(() => { state.uid = 'demo-owner'; state.ownerUid = 'demo-owner'; state.error = null; state.loading = false; fetchMock.mockReset().mockImplementation(async () => reply()); vi.stubGlobal('fetch', fetchMock); vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(new ArrayBuffer(32)); });
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('temporaryAuthorityReadFailurePreservesDraftAndPendingCommand', async () => {
  await act(async () => { tree = create(createElement(FactualFaqPage)); });
  await act(async () => controller().setDraft([{ topic: 'parking', answer: 'Draft to preserve' }]));
  state.error = 'Temporary poll failure'; await update(); expect(tree!.root.findAllByType(BusinessFactualFaqEditor)).toHaveLength(0);
  state.error = null; await update(); expect(controller().draft).toEqual([{ topic: 'parking', answer: 'Draft to preserve' }]);
  await act(async () => controller().review()); await act(async () => controller().setPublicationChecked(true));
  let reject!: (e: Error) => void; const wait = new Promise<Response>((_resolve, no) => { reject = no; });
  fetchMock.mockImplementation((_path, init) => init?.method === 'PUT' ? wait : Promise.resolve(reply()));
  let saving!: Promise<void>; await act(async () => { saving = controller().save(); });
  const body = String(fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')![1]?.body);
  state.error = 'Temporary poll failure'; await update(); state.error = null; await update();
  expect(controller().busy).toBe(true); expect(controller().draft[0].answer).toBe('Draft to preserve');
  await act(async () => controller().inspectPending()); expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('requestId=' + JSON.parse(body).requestId);
  await act(async () => { reject(new Error('Lost response')); await saving; }); expect(controller().uncertain).toBe(true);
  fetchMock.mockImplementation(async (_path, init) => { expect(String(init?.body)).toBe(body); throw new Error('Still ambiguous'); });
  await act(async () => controller().retryPending()); expect(controller().uncertain).toBe(true);
});
it('realOwnerChangeStillPurgesPrivateDraft', async () => { await act(async () => { tree = create(createElement(FactualFaqPage)); }); const old = controller(); await act(async () => old.setDraft([{ topic: 'parking', answer: 'Private draft' }])); state.ownerUid = 'demo-other'; await update(); state.ownerUid = 'demo-owner'; await update(); expect(controller().draft).toEqual([]); });

it('knownAuthorityDenialPurgesInsteadOfTreatingItAsTemporaryPollFailure', async () => {
  await act(async () => { tree = create(createElement(FactualFaqPage)); });
  const retained = controller(); await act(async () => retained.setDraft([{ topic: 'parking', answer: 'Private draft' }]));
  await act(async () => state.denied?.()); await update();
  expect(tree!.root.findAllByType(BusinessFactualFaqEditor)).toHaveLength(0);
  await act(async () => retained.save()); expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
});
