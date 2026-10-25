import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { Database, Transaction } from '@/lib/storage/types';
import { ownerWaitlistFixture, ownerWaitlistNow, seedOwnerWaitlistRows } from './owner-waitlist-contract';
import { subjectAdmin } from './represented-booking-contract';
import { memoryFirestore } from './memoryFirestore';
import { acceptSyntheticConsent } from './consent-fixtures';
import { readOwnerWaitlistPage, updateOwnerWaitlistReview, readOwnerWaitlistReviewState } from '@/lib/server/owner-waitlist';
import { cancelWaitlist, joinWaitlist } from '@/lib/server/waitlist';
beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(ownerWaitlistNow);vi.stubEnv('SUPERADMIN_UID',subjectAdmin.uid);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
const command=(f:Awaited<ReturnType<typeof ownerWaitlistFixture>>,expectedReviewRevision=0,reviewed=true,requestId='review-command-001')=>({requestId,entryId:f.entryId,expectedWaitlistRevision:1,expectedReviewRevision,reviewed});
it('twentyPlusLookaheadAndFortyFivePagesWithMoreThanTwentyCreatedAtTiesAreNotLost',async()=>{
  const f=await ownerWaitlistFixture(),expected=await seedOwnerWaitlistRows(f),actual:string[]=[];let cursor:import('@/lib/owner-waitlist').OwnerWaitlistCursor|undefined;
  const sizes=[];
  do{const page=await readOwnerWaitlistPage(f.owner,f.business.id,{dateKey:f.input.dateKey,...(cursor?{cursor}:{})},f.db);sizes.push(page.rows.length);actual.push(...page.rows.map(r=>r.recordId));
    expect(page.ownerUid).toBe(f.owner.uid);expect(page.coverage).toBe('current_indexed_requests');expect(JSON.stringify(page)).not.toMatch(/clientUid|anchors|phone|representativeRole|bookingRequestId/);
    if(page.nextCursor)expect(page.nextCursor.recordId).toBe(page.rows.at(-1)!.recordId);cursor=page.nextCursor??undefined;
  }while(cursor);
  expect(sizes).toEqual([20,20,5]);expect(actual).toEqual(expected.map(r=>r.recordId));expect(new Set(actual).size).toBe(45);
});
it('anchorCancelledReplacedOrForeign409',async()=>{
  const f=await ownerWaitlistFixture();await seedOwnerWaitlistRows(f,25);const first=await readOwnerWaitlistPage(f.owner,f.business.id,{dateKey:f.input.dateKey},f.db),cursor=first.nextCursor!;
  const ref=f.db.collection('businesses').doc(f.business.id).collection('waitlistRequests').doc(cursor.recordId),record=(await ref.get()).data()!;
  await ref.set({...record,revision:2,request:null,lastOperation:{...record.lastOperation,appliedRevision:2}});
  await expect(readOwnerWaitlistPage(f.owner,f.business.id,{dateKey:f.input.dateKey,cursor},f.db)).rejects.toMatchObject({status:409,code:'OWNER_WAITLIST_CHANGED'});
  await expect(readOwnerWaitlistPage(f.owner,f.business.id,{dateKey:f.input.dateKey,cursor:{...cursor,recordId:'foreign'}},f.db)).rejects.toMatchObject({status:409});
});
it('listDoesNotCalculateAvailabilityPerRowAndTwentyMarkerReadsBoundedConcurrencyFour',async()=>{
  const f=await ownerWaitlistFixture();await seedOwnerWaitlistRows(f,21);let active=0,max=0,markerReads=0,queries=0;
  const db:Database={...f.db,runTransaction:handler=>f.db.runTransaction(tx=>handler({...tx,get:async(target:any)=>{
    if(target.path?.includes('/waitlistOwnerReviews/')){markerReads++;active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,2));const result=await tx.get(target);active--;return result;}
    if(target.path?.endsWith('/waitlistRequests'))queries++;
    if(target.path?.includes('/appointments')||target.path?.startsWith('serverSettings/')||target.path?.startsWith('users/'))throw Error('LIST_READ_PRIVATE_EVIDENCE_OR_AVAILABILITY');return tx.get(target);
  }} as Transaction))};
  expect((await readOwnerWaitlistPage(f.owner,f.business.id,{dateKey:f.input.dateKey},db)).rows).toHaveLength(20);expect(markerReads).toBe(20);expect(max).toBeLessThanOrEqual(4);expect(queries).toBe(1);
});
it('queryMissingFieldsHaveExplicitCoverageAndInvalidMarkerFailsInsteadOfDefaultFalse',async()=>{
  const f=await ownerWaitlistFixture();await f.db.collection('businesses').doc(f.business.id).collection('waitlistRequests').doc('incomplete').set({request:{createdAt:ownerWaitlistNow}});
  expect((await readOwnerWaitlistPage(f.owner,f.business.id,{dateKey:f.input.dateKey},f.db)).rows).toHaveLength(1);
  await f.db.collection('businesses').doc(f.business.id).collection('waitlistOwnerReviews').doc(f.entryId).set({reviewed:false});
  await expect(readOwnerWaitlistPage(f.owner,f.business.id,{dateKey:f.input.dateKey},f.db)).rejects.toMatchObject({status:503,code:'OWNER_WAITLIST_UNVERIFIABLE'});
});
it('reviewNeedsOwnerConsentButNotSubscriptionAndReviewOnlyWritesPrivateMarker',async()=>{
  const memory=memoryFirestore(),f=await ownerWaitlistFixture(memory.db);
  await expect(updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,command(f),f.db)).rejects.toMatchObject({status:428});
  await acceptSyntheticConsent(f.db,f.owner.uid);await f.db.collection('businesses').doc(f.business.id).set({...f.business,subscription:{status:'past_due',trialEndsAt:0,currentPeriodEndsAt:0}});
  const before=structuredClone([...memory.rows]),result=await updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,command(f),f.db);
  expect(result).toMatchObject({businessId:f.business.id,ownerUid:f.owner.uid,entryId:f.entryId,review:{revision:1,reviewed:true},replayed:false});
  expect([...memory.rows].filter(([path])=>!path.includes('/waitlistOwnerReviews/'))).toEqual(before);expect((await f.ref.get()).data()?.request.id).toBe(f.entryId);
});
it('sameLatestRequestReplayWritesNothingAndRequestReuseOtherBodyRejectsAndOlderReplayAfterAnotherReviewDoesNotOverwrite',async()=>{
  const memory=memoryFirestore(),f=await ownerWaitlistFixture(memory.db);await acceptSyntheticConsent(f.db,f.owner.uid);
  const a=command(f),first=await updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,a,f.db),before=structuredClone([...memory.rows]);
  expect(await updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,a,f.db)).toEqual({...first,replayed:true});expect([...memory.rows]).toEqual(before);
  await expect(updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,{...a,reviewed:false},f.db)).rejects.toMatchObject({code:'OWNER_WAITLIST_REQUEST_REUSED'});
  await updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,command(f,1,false,'review-command-002'),f.db);
  await expect(updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,a,f.db)).rejects.toMatchObject({code:'OWNER_WAITLIST_CHANGED'});
});
it('sameValueNewCommandIsNoChangeAndStaleEntryOrRequestRevisionRejects',async()=>{
  const f=await ownerWaitlistFixture();await acceptSyntheticConsent(f.db,f.owner.uid);
  await expect(updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,command(f,0,false),f.db)).rejects.toMatchObject({code:'OWNER_WAITLIST_NO_CHANGE'});
  for(const patch of [{entryId:'different'},{expectedWaitlistRevision:2},{expectedReviewRevision:2}])await expect(updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,{...command(f),...patch},f.db)).rejects.toMatchObject({code:'OWNER_WAITLIST_CHANGED'});
});
it('maxRevisionCannotWriteUnreadableMarkerAndMarkingExpiredDoesNotReactivate',async()=>{
  const f=await ownerWaitlistFixture();await acceptSyntheticConsent(f.db,f.owner.uid);vi.mocked(Date.now).mockReturnValue(f.state.request!.expiresAt);
  const c=command(f);await updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,c,f.db);
  const ref=f.db.collection('businesses').doc(f.business.id).collection('waitlistOwnerReviews').doc(f.entryId),marker=(await ref.get()).data()!;
  await ref.set({...marker,revision:Number.MAX_SAFE_INTEGER-1,lastOperation:{...marker.lastOperation,appliedRevision:Number.MAX_SAFE_INTEGER-1}});
  await expect(updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,command(f,Number.MAX_SAFE_INTEGER-1,false,'review-max-revision'),f.db)).rejects.toMatchObject({status:503});
  expect((await ref.get()).data()?.revision).toBe(Number.MAX_SAFE_INTEGER-1);expect((await f.ref.get()).data()?.request).not.toBeNull();
});
it('clientCancelOrReplaceWinsAgainstReview',async()=>{
  const f=await ownerWaitlistFixture();await acceptSyntheticConsent(f.db,f.owner.uid);
  await cancelWaitlist(f.actor,f.business.id,{requestId:'client-cancel-before-review',expectedRevision:1,entryId:f.entryId},f.db);
  await expect(updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,command(f),f.db)).rejects.toMatchObject({status:409,code:'OWNER_WAITLIST_CHANGED'});
  expect((await f.db.collection('businesses').doc(f.business.id).collection('waitlistOwnerReviews').get()).size).toBe(0);
});
it('cancelledCanonicalTombstoneProvidesMinimalOwnerFenceWithoutHistoricalClaim',async()=>{
  const f=await ownerWaitlistFixture();await cancelWaitlist(f.actor,f.business.id,{requestId:'cancel-unknown-review',expectedRevision:1,entryId:f.entryId},f.db);
  const proof=await readOwnerWaitlistReviewState(f.owner,f.business.id,f.recordId,f.db);
  expect(proof).toEqual({businessId:f.business.id,ownerUid:f.owner.uid,recordId:f.recordId,waitlistRevision:2,entryId:null,review:null,serverNow:ownerWaitlistNow});
  expect(JSON.stringify(proof)).not.toMatch(/clientUid|receipt|actorUid|requestId|operationHash/);
  await expect(readOwnerWaitlistReviewState(f.actor,f.business.id,f.recordId,f.db)).rejects.toMatchObject({status:403});
});
it('supportedJoinRequestIdReuseStartsAReviewIncarnationWithoutInheritingPreviousMarker',async()=>{
  const f=await ownerWaitlistFixture();await acceptSyntheticConsent(f.db,f.owner.uid);await updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,command(f),f.db);
  await cancelWaitlist(f.actor,f.business.id,{requestId:'cancel-reused-join',expectedRevision:1,entryId:f.entryId},f.db);
  const joined=await joinWaitlist(f.actor,f.business.id,{...f.input,expectedRevision:2},f.db);expect(joined.request!.id).toBe(f.entryId);
  const page=await readOwnerWaitlistPage(f.owner,f.business.id,{dateKey:f.input.dateKey},f.db);expect(page.rows[0].waitlistRevision).toBe(3);expect(page.rows[0].review).toEqual({revision:0,reviewed:false,updatedAt:null});
  await expect(updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,command(f),f.db)).rejects.toMatchObject({code:'OWNER_WAITLIST_CHANGED'});
  const fresh=await updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,{...command(f),expectedWaitlistRevision:3,requestId:'review-rejoined-incarnation'},f.db);expect(fresh.review.revision).toBe(1);
  expect((await f.db.collection('businesses').doc(f.business.id).collection('waitlistOwnerReviews').doc(f.entryId).get()).data()).toMatchObject({version:2,waitlistRevision:3});
});
