import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { Database } from '@/lib/storage/types';
import { HttpError } from '@/lib/server/http';
import { teamAccessCommandCanonicalString } from '@/lib/business-team';
import { requestTeamAccess, decideTeamAccess } from '@/lib/server/business-team';
import { bookingDataPolicyKey } from '@/lib/server/booking-data-policy';
import { consentStateKey } from '@/lib/server/consent';
import { memoryFirestore } from './memoryFirestore';
import { teamFixture, teamNow } from './business-team-contract';
const state = vi.hoisted(() => ({ db: null as unknown as Database, uid: 'demo-team-member' as string | null }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db }));
vi.mock('@/lib/server/auth', () => ({ requireUser: async () => { if (!state.uid) throw new HttpError(401, 'Sign in'); return { uid: state.uid }; } }));
const routes = async () => ({ own: await import('@/app/api/team/memberships/route'), request: await import('@/app/api/team/requests/route'),
  leave: await import('@/app/api/team/memberships/[membershipId]/route'), owner: await import('@/app/api/businesses/[id]/team/route'),
  decision: await import('@/app/api/businesses/[id]/team/[membershipId]/route'), agenda: await import('@/app/api/team/businesses/[id]/agenda/route') });
const context = (membershipId = 'demo-membership', id = 'demo-team-business') => ({ params: Promise.resolve({ id, membershipId }) });
const req = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = { 'Content-Type': 'application/json' }) => new Request('http://localhost/api/' + path,
  { method, headers, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
const requestBody = { businessSlug: 'demo-team-business', requestId: 'demo-request-000', expectedMembershipRevision: 0 };
const approveBody = { action: 'approve', requestId: 'demo-approve-000', expectedMembershipRevision: 1, expectedTeamRevision: 1, resourceId: 'demo-chair' };
async function setup(active = false) {
  const memory = memoryFirestore(); state.db = memory.db as unknown as Database; const fixture = await teamFixture(state.db);
  if (!active) return { ...memory, ...fixture, membershipId: '' };
  const requested = await requestTeamAccess(fixture.member, fixture.request, state.db);
  await decideTeamAccess(fixture.owner, fixture.business.id, requested.current.membershipId, approveBody as Parameters<typeof decideTeamAccess>[3], state.db);
  return { ...memory, ...fixture, membershipId: requested.current.membershipId };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(teamNow); vi.stubEnv('SARIN_TEAM_ACCESS_ENABLED', 'true'); state.uid = 'demo-team-member'; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it('six exact methods authenticate and expose only node dynamic handlers', async () => {
  await setup(); const r = await routes(); state.uid = null;
  const calls = [() => r.own.GET(req('team/memberships')), () => r.request.POST(req('team/requests', 'POST', requestBody)),
    () => r.leave.DELETE(req('team/memberships/x', 'DELETE', { requestId: 'demo-leave-000', expectedMembershipRevision: 1 }), context()),
    () => r.owner.GET(req('businesses/x/team'), context()), () => r.decision.PATCH(req('businesses/x/team/x', 'PATCH', approveBody), context()),
    () => r.agenda.GET(req('team/businesses/x/agenda?date=2030-01-07'), context())];
  for (const call of calls) { const response = await call(); expect(response.status).toBe(401); expect(response.headers.get('Cache-Control')).toBe('no-store'); }
  for (const [key, route] of Object.entries(r)) { expect(route.runtime).toBe('nodejs'); expect(route.dynamic).toBe('force-dynamic'); expect(Object.keys(route).filter(k => /^[A-Z]+$/.test(k))).toEqual([{ own:'GET',request:'POST',leave:'DELETE',owner:'GET',decision:'PATCH',agenda:'GET' }[key]]); }
});
it('request approval read receipts and leave use real domain and WebCrypto proof', async () => {
  const f = await setup(), r = await routes();
  const response = await r.request.POST(req('team/requests', 'POST', requestBody)); expect(response.status).toBe(200);
  const result = await response.json(), membershipId = result.current.membershipId;
  const canonical = teamAccessCommandCanonicalString({ kind:'request', businessId:f.business.id,actorUid:f.member.uid,requestId:requestBody.requestId,expectedMembershipRevision:0,expectedTeamRevision:null,resourceId:null });
  const digest = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))).toString('hex');
  expect(result.applied.commandHash).toBe(digest);
  const own = await r.own.GET(req('team/memberships?businessSlug=demo-team-business&requestId=demo-request-000'));
  expect(await own.json()).toMatchObject({ applied: result.applied, items: [{ status:'requested' }] });
  state.uid = f.owner.uid;
  const decision = await r.decision.PATCH(req('businesses/x/team/x', 'PATCH', approveBody), context(membershipId)); expect(decision.status).toBe(200);
  const owner = await r.owner.GET(req('businesses/x/team?requestId=demo-approve-000'), context()); expect(await owner.json()).toMatchObject({ active:[{memberUid:f.member.uid}], applied:{requestId:'demo-approve-000'} });
  state.uid = f.member.uid;
  const privateReceipt = await r.own.GET(req('team/memberships?businessSlug=demo-team-business&requestId=demo-approve-000')); expect((await privateReceipt.json()).applied).toBeNull();
  expect((await r.agenda.GET(req('team/businesses/x/agenda?date=2030-01-07'),context())).status).toBe(200);
  vi.stubEnv('SARIN_TEAM_ACCESS_ENABLED','false');
  expect((await r.leave.DELETE(req('team/memberships/x','DELETE',{requestId:'demo-leave-000',expectedMembershipRevision:2}),context(membershipId))).status).toBe(200);
  expect((await r.own.GET(req('team/memberships'))).headers.get('Cache-Control')).toBe('no-store');
});
it('strict commands reject staff authority fields, invalid revisions and queries', async () => {
  await setup(); const r=await routes();
  for (const extra of [{uid:'other'},{memberUid:'other'},{resourceId:'chair'},{role:{id:'own_agenda_viewer',version:1}},{expectedMembershipRevision:-1},{expectedMembershipRevision:Number.MAX_SAFE_INTEGER},{businessSlug:'demo-team-business\n'},{requestId:'bad\n'}]) expect((await r.request.POST(req('team/requests','POST',{...requestBody,...extra}))).status).toBe(400);
  expect((await r.request.POST(req('team/requests?uid=other','POST',requestBody))).status).toBe(400);
  expect((await r.leave.DELETE(req('team/memberships/x?uid=other','DELETE',{requestId:'demo-leave-000',expectedMembershipRevision:1}),context())).status).toBe(400);
  expect((await r.decision.PATCH(req('businesses/x/team/x?x=1','PATCH',approveBody),context())).status).toBe(400);
  for (const query of ['?uid=other','?requestId=demo-request-000','?businessSlug=demo-team-business&afterBusinessId=demo','?businessSlug=demo&businessSlug=demo','?afterBusinessId=demo&afterBusinessId=demo','?businessSlug=demo&requestId=demo-request-000&requestId=demo-request-000','?afterBusinessId=constructor','?businessSlug=demo%0A']) expect((await r.own.GET(req('team/memberships'+query))).status).toBe(400);
  for (const query of ['?uid=other','?requestId=demo-request-000&requestId=demo-request-000']) expect((await r.owner.GET(req('businesses/x/team'+query),context())).status).toBe(400);
  for (const query of ['', '?date=2030-01-07&date=2030-01-07','?date=2030-01-07&resourceId=other','?date=2030-01-06','?date=2030-02-08','?date=2030-02-30','?date=2030-01-07%0A']) expect((await r.agenda.GET(req('team/businesses/x/agenda'+query),context())).status).toBe(400);
  expect((await r.agenda.GET(req('team/businesses/x/agenda?date=2030-01-07'),context('', 'bad/id'))).status).toBe(400);
});
it('all command bodies enforce streamed bytes content type and exact schema', async () => {
  await setup(); const r=await routes();
  const senders=[(body:unknown,headers?:Record<string,string>)=>r.request.POST(req('team/requests','POST',body,headers)),(body:unknown,headers?:Record<string,string>)=>r.leave.DELETE(req('team/memberships/x','DELETE',body,headers),context()),(body:unknown,headers?:Record<string,string>)=>r.decision.PATCH(req('businesses/x/team/x','PATCH',body,headers),context())];
  for(const send of senders){ for(const [body,status,headers] of [[' '.repeat(4097),413,undefined],['"'+'\u00e9'.repeat(2048)+'"',413,undefined],['{',400,undefined],[{},400,undefined],[{},415,{'Content-Type':'text/plain'}],[{},415,{'Content-Type':'application/jsonp'}]] as const){const response=await send(body,headers);expect(response.status).toBe(status);expect(response.headers.get('Cache-Control')).toBe('no-store');} }
  expect((await r.own.GET(req('team/memberships','POST','{}'))).status).toBe(400);
});
it('errors preserve auth domain status retry and no-store', async () => {
  const f=await setup(),r=await routes();
  const responses=[];
  responses.push([await r.agenda.GET(req('team/businesses/x/agenda?date=2030-01-07'),context()),403]);
  responses.push([await r.request.POST(req('team/requests','POST',{...requestBody,businessSlug:'demo-missing'})),404]);
  await state.db.collection('serverSettings').doc(consentStateKey(f.member.uid,'account')).delete();
  responses.push([await r.request.POST(req('team/requests','POST',requestBody)),428]);
  await setup(true);
  responses.push([await r.request.POST(req('team/requests','POST',{...requestBody,requestId:'demo-conflict-000'})),409]);
  await state.db.collection('serverSettings').doc(bookingDataPolicyKey(f.business.id)).set({version:99});
  responses.push([await r.agenda.GET(req('team/businesses/x/agenda?date=2030-01-07'),context()),503]);
  for(const [response,status] of responses as [Response,number][]){expect(response.status).toBe(status);expect(response.headers.get('Cache-Control')).toBe('no-store');}
  const fresh=await setup(); const applied=await requestTeamAccess(fresh.member,fresh.request,state.db);
  await (await import('@/lib/server/business-team')).leaveTeamAccess(fresh.member,applied.current.membershipId,{requestId:'demo-leave-000',expectedMembershipRevision:1},state.db);
  const limited=await r.request.POST(req('team/requests','POST',{...requestBody,requestId:'demo-request-next',expectedMembershipRevision:2}));expect(limited.status).toBe(429);expect(limited.headers.get('Retry-After')).toBe('86400');
});

it('4096-byte commands are accepted and errors never expose receipt material', async () => {
  const f = await setup(), r = await routes();
  const padded = (body: unknown) => { const json = JSON.stringify(body); return json + ' '.repeat(4096 - Buffer.byteLength(json)); };
  const requested = await r.request.POST(req('team/requests', 'POST', padded(requestBody)));
  expect(requested.status).toBe(200); const result = await requested.json();
  state.uid = f.owner.uid;
  expect((await r.decision.PATCH(req('businesses/x/team/x', 'PATCH', padded(approveBody)), context(result.current.membershipId))).status).toBe(200);
  const foreign = await r.owner.GET(req('businesses/x/team?requestId=demo-request-000'), context());
  const owner = await foreign.json(); expect(owner.applied).toBeNull();
  for (const event of owner.events) { expect(event.commandHash).toBeUndefined(); expect(event.command).toBeUndefined(); }
  state.uid = f.member.uid;
  expect((await r.leave.DELETE(req('team/memberships/x', 'DELETE', padded({requestId:'demo-leave-000',expectedMembershipRevision:2})), context(result.current.membershipId))).status).toBe(200);
});
