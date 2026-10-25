import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/storage/types';
import { HttpError } from '@/lib/server/http';
import { GET as source } from '@/app/api/businesses/[id]/appointments/[appointmentId]/owner-reschedule/route';
import { POST as availability } from '@/app/api/businesses/[id]/appointments/[appointmentId]/owner-reschedule/availability/route';
import { POST as proposals } from '@/app/api/businesses/[id]/appointments/[appointmentId]/owner-reschedule/proposals/route';
import { GET as recover } from '@/app/api/businesses/[id]/owner-reschedule-proposals/[proposalId]/route';
import { POST as confirm } from '@/app/api/businesses/[id]/owner-reschedule-proposals/[proposalId]/confirm/route';
import { memoryFirestore } from './memoryFirestore';
import { ownerRescheduleBusiness as business, ownerRescheduleSource as original, ownerRescheduleSelection as selection, ownerRescheduleNow as now, seedOwnerRescheduleScenario } from './owner-rescheduling-contract';

const session = vi.hoisted(() => ({ uid: 'demo-owner' as string | null, db: undefined as unknown as Database }));
vi.mock('@/lib/server/auth', () => ({ requireUser: async () => { if (!session.uid) throw new HttpError(401, 'Session required'); return { uid: session.uid }; } }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => session.db }));
const ctx = (id = business.id, appointmentId = original.id) => ({ params: Promise.resolve({ id, appointmentId }) });
const pctx = (proposalId: string) => ({ params: Promise.resolve({ id: business.id, proposalId }) });
const request = (body?: unknown, search = '', headers = { 'Content-Type': 'application/json' }) => new Request(`http://localhost/api/owner-reschedule${search}`, body === undefined ? undefined : { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
async function input() { const result = await source(request(), ctx()); const state = await result.json(); return { ...state.expectation, requestId: 'demo-request', selection }; }
async function prepare() { return (await (await proposals(request(await input()), ctx())).json()).proposal; }
beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); session.uid = 'demo-owner'; session.db = memoryFirestore().db; await seedOwnerRescheduleScenario(session.db); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('strict owner reschedule HTTP', () => {
  it('routesRequireVerifiedUserAndCurrentOwner', async () => {
    const proposal = await prepare(), body = await input(); vi.stubEnv('SUPERADMIN_UID', 'demo-superadmin');
    for (const uid of [null, 'demo-client', 'demo-chair', 'demo-superadmin']) {
      session.uid = uid;
      const results = await Promise.all([source(request(), ctx()), availability(request({ sourceRevision: 0, sourceFingerprint: body.sourceFingerprint, dateKey: selection.dateKey }), ctx()), proposals(request(body), ctx()), recover(request(), pctx(proposal.id)), confirm(request({ confirm: true }), pctx(proposal.id))]);
      for (const response of results) { expect(response.status).toBe(uid === null ? 401 : 403); expect(response.headers.get('Cache-Control')).toBe('no-store'); }
    }
    expect((await session.db.collection('businesses').doc(business.id).collection('appointments').doc(original.id).get()).data()).toEqual(original);
  });
  it('queryDuplicateForeignIdsAndUnknownBodyAreRejected', async () => {
    const body = await input(), proposal = await prepare();
    for (const search of ['?x=y', '?x=a&x=b', '?ownerReschedule=other']) {
      const results = await Promise.all([source(request(undefined, search), ctx()), availability(request({}, search), ctx()), proposals(request(body, search), ctx()), recover(request(undefined, search), pctx(proposal.id)), confirm(request({ confirm: true }, search), pctx(proposal.id))]);
      for (const response of results) expect(response.status).toBe(400);
    }
    expect((await source(request(), ctx('../other'))).status).toBe(400);
    expect((await source(request(), ctx(business.id, 'demo-nonexistent'))).status).toBe(404);
    for (const key of ['actorUid', 'clientPhone', 'intakeAnswers', 'beneficiary', 'serviceId']) expect((await proposals(request({ ...body, [key]: 'demo' }), ctx())).status).toBe(400);
  });
  it('limitsAre2048_4096_1024Bytes', async () => {
    const body = await input(), proposal = await prepare();
    const check = async (handler: (req: Request) => Promise<Response>, value: unknown, max: number) => {
      const json = JSON.stringify(value), padded = json + ' '.repeat(max - json.length);
      expect((await handler(request(padded))).status).toBeLessThan(400);
      const rejected = await handler(request(padded + ' ')); expect(rejected.status).toBe(413); expect(rejected.headers.get('Cache-Control')).toBe('no-store');
    };
    await check(req => availability(req, ctx()), { sourceRevision: 0, sourceFingerprint: body.sourceFingerprint, dateKey: selection.dateKey }, 2048);
    await check(req => proposals(req, ctx()), body, 4096);
    await check(req => confirm(req, pctx(proposal.id)), { confirm: true }, 1024);
  });
  it('confirmationOnlyAcceptsLiteralTrue', async () => {
    const proposal = await prepare();
    for (const body of [{}, { confirm: false }, { confirm: 'true' }, { confirm: 1 }, { confirm: true, actorUid: 'demo-client' }, { confirm: true, selection }, { confirm: true, clientPhone: '573001234567' }]) expect((await confirm(request(body), pctx(proposal.id))).status).toBe(400);
    expect((await confirm(request({ confirm: true }), pctx(proposal.id))).status).toBe(200);
  });
  it('allSuccessAndErrorResponsesAreNoStore', async () => {
    const proposal = await prepare();
    const results = await Promise.all([source(request(), ctx()), recover(request(), pctx(proposal.id)), proposals(request({}), ctx()), availability(request('{}', '', { 'Content-Type': 'text/plain' }), ctx()), confirm(request('{'), pctx(proposal.id)), recover(request(), pctx('demo-missing'))]);
    for (const response of results) expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(results.map(response => response.status)).toEqual([200, 200, 400, 415, 400, 404]);
  });
  it('postProposalStatusDistinguishesReplay', async () => {
    const body = await input(), first = await proposals(request(body), ctx()), second = await proposals(request(body), ctx());
    expect(first.status).toBe(201); expect(second.status).toBe(200); expect(await second.json()).toEqual(await first.json());
  });
  it('getRecoveryNeverWrites', async () => {
    const memory = memoryFirestore(); session.db = memory.db; await seedOwnerRescheduleScenario(session.db); const proposal = await prepare();
    const before = structuredClone(memory.rows); vi.setSystemTime(now + 600001);
    expect(await (await recover(request(), pctx(proposal.id))).json()).toMatchObject({ state: 'prepared', result: null }); expect(memory.rows).toEqual(before);
  });
});
