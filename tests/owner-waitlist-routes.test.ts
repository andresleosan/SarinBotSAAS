import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/storage/types';
import { POST } from '@/app/api/businesses/[id]/owner-waitlist/query/route';
import { GET } from '@/app/api/businesses/[id]/owner-waitlist/[recordId]/route';
import { PATCH, GET as GET_REVIEW } from '@/app/api/businesses/[id]/owner-waitlist/[recordId]/review/route';
import { HttpError } from '@/lib/server/http';
import { ownerWaitlistFixture, ownerWaitlistNow } from './owner-waitlist-contract';
import { subjectAdmin } from './represented-booking-contract';
import { acceptSyntheticConsent } from './consent-fixtures';
const state=vi.hoisted(()=>({db:null as unknown as Database,uid:null as string|null}));
vi.mock('@/lib/firebase/admin',()=>({getAdminDb:()=>state.db}));
vi.mock('@/lib/server/auth',()=>({isSuperadmin:(uid:string)=>uid==='demo-subject-admin',requireUser:async()=>{if(!state.uid)throw new HttpError(401,'Sign in');return{uid:state.uid};}}));
let f:Awaited<ReturnType<typeof ownerWaitlistFixture>>;
const ctx=()=>({params:Promise.resolve({id:f.business.id,recordId:f.recordId})});
const url=()=>`http://localhost/api/businesses/${f.business.id}/owner-waitlist`;
const post=(body:unknown={dateKey:'2030-01-07'},query='')=>POST(new Request(url()+'/query'+query,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),ctx());
const patch=(body:unknown={requestId:'review-route-001',entryId:f.entryId,expectedWaitlistRevision:1,expectedReviewRevision:0,reviewed:true},query='')=>PATCH(new Request(url()+'/'+f.recordId+'/review'+query,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),ctx());
beforeEach(async()=>{vi.spyOn(Date,'now').mockReturnValue(ownerWaitlistNow);vi.stubEnv('SUPERADMIN_UID',subjectAdmin.uid);f=await ownerWaitlistFixture();state.db=f.db;state.uid=f.owner.uid;});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it('requiresUserAndCurrentOwnerEvenForSuperadminAndNoStoreAlways',async()=>{for(const uid of [null,f.actor.uid,subjectAdmin.uid]){state.uid=uid;for(const response of [await post(),await GET(new Request(url()+'/'+f.recordId),ctx()),await patch()]){expect(response.status).toBe(uid?403:401);expect(response.headers.get('Cache-Control')).toBe('no-store');}}});
it.each([{dateKey:'2030-02-30'},{dateKey:'2030-01-07',uid:'other'},{dateKey:'2030-01-07',price:1},{dateKey:'2030-01-07',cursor:{recordId:'bad\n',entryId:'entry',createdAt:1}}])('strictQueryRejects %j',async body=>{expect((await post(body)).status).toBe(400);});
it('queryStringsAndUnexpectedGetBodyReject',async()=>{expect((await post(undefined,'?uid=other')).status).toBe(400);expect((await patch(undefined,'?extra=true')).status).toBe(400);expect((await GET(new Request(url()+'/'+f.recordId+'?x=1'),ctx())).status).toBe(400);expect((await GET(new Request(url()+'/'+f.recordId,{method:'POST',body:'x'}),ctx())).status).toBe(400);});
it('byteLimitAndContentTypeAndInvalidJson',async()=>{for(const method of ['POST','PATCH'] as const){const invoke=method==='POST'?POST:PATCH;for(const [body,headers,status] of [['é'.repeat(1100),{'Content-Type':'application/json'},413],['{}',{'Content-Type':'text/plain'},415],['{',{'Content-Type':'application/json'},400]] as const){const response=await invoke(new Request(url(),{method,headers,body}),ctx());expect(response.status).toBe(status);expect(response.headers.get('Cache-Control')).toBe('no-store');}}});
it('readOnlyPostAndGetSuccessAndReview428ThenSuccess409And503',async()=>{
  const page=await post();expect(page.status).toBe(200);expect(page.headers.get('Cache-Control')).toBe('no-store');
  expect((await GET(new Request(url()+'/'+f.recordId),ctx())).status).toBe(200);expect((await patch()).status).toBe(428);
  await acceptSyntheticConsent(f.db,f.owner.uid);expect((await patch()).status).toBe(200);
  expect((await patch({requestId:'review-route-002',entryId:f.entryId,expectedWaitlistRevision:1,expectedReviewRevision:0,reviewed:false})).status).toBe(409);
  await f.db.collection('businesses').doc(f.business.id).collection('waitlistOwnerReviews').doc(f.entryId).set({broken:true});expect((await post()).status).toBe(503);
  const missing=await GET(new Request(url()+'/missing'),{params:Promise.resolve({id:f.business.id,recordId:'missing'})});expect(missing.status).toBe(404);expect(missing.headers.get('Cache-Control')).toBe('no-store');
});
it('reviewStateGetAuthorizesOwnerAndReturnsCanonicalTombstoneNoStore',async()=>{
  const {cancelWaitlist}=await import('@/lib/server/waitlist');await cancelWaitlist(f.actor,f.business.id,{requestId:'cancel-route-proof',expectedRevision:1,entryId:f.entryId},f.db);
  const response=await GET_REVIEW(new Request(url()+'/'+f.recordId+'/review'),ctx());expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');expect(await response.json()).toEqual({businessId:f.business.id,ownerUid:f.owner.uid,recordId:f.recordId,waitlistRevision:2,entryId:null,review:null,serverNow:ownerWaitlistNow});
  for(const uid of [null,f.actor.uid,subjectAdmin.uid]){state.uid=uid;const denied=await GET_REVIEW(new Request(url()),ctx());expect(denied.status).toBe(uid?403:401);expect(denied.headers.get('Cache-Control')).toBe('no-store');}
  state.uid=f.owner.uid;expect((await GET_REVIEW(new Request(url()+'?x=1'),ctx())).status).toBe(400);expect((await GET_REVIEW(new Request(url(),{method:'POST',body:'x'}),ctx())).status).toBe(400);
});
