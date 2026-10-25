import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ownerWaitlistFixture, ownerWaitlistNow } from './owner-waitlist-contract';
import { subjectAdmin } from './represented-booking-contract';
import { memoryFirestore } from './memoryFirestore';
import { readOwnerWaitlistDetail } from '@/lib/server/owner-waitlist';
import { readOwnerWaitlistProjection, readWaitlist, cancelWaitlist } from '@/lib/server/waitlist';
import { readConsent, updateConsent, consentStateKey } from '@/lib/server/consent';
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(ownerWaitlistNow); vi.stubEnv('SUPERADMIN_UID', subjectAdmin.uid); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it('detailRequiresCurrentOwnerEvenForSuperadmin', async () => {
  const f = await ownerWaitlistFixture();
  for (const actor of [f.actor, subjectAdmin, { uid: 'other-owner' }]) {
    await expect(readOwnerWaitlistDetail(actor, f.business.id, f.recordId, f.db)).rejects.toMatchObject({ status: 403 });
    await expect(f.db.runTransaction(tx=>readOwnerWaitlistProjection(tx,actor,f.business.id,f.recordId,f.db))).rejects.toMatchObject({ status: 403 });
  }
  expect(await readOwnerWaitlistDetail(f.owner,f.business.id,f.recordId,f.db)).toMatchObject({ ownerUid:f.owner.uid,row:{recordId:f.recordId},state:'waiting' });
});
it.each(['businessId','ownerUid','expiresAt','entryId','lastRevision','controls','serviceControls'])('canonicalRecordBusinessAndUidCannotBeSubstitutedAndStrictStoredRecordIdExpiryAndEntryLinkAreChecked %s', async field => {
  const f = await ownerWaitlistFixture(), record = (await f.ref.get()).data()!;
  if(field==='businessId')record.businessId='other';
  if(field==='ownerUid')record.ownerUid='another-client';
  if(field==='expiresAt')record.request.expiresAt++;
  if(field==='entryId')record.request.id='different';
  if(field==='lastRevision')record.lastOperation.appliedRevision++;
  if(field==='controls')record.ownerUid+='\n';
  if(field==='serviceControls')record.request.serviceId+='\n';
  await f.ref.set(record);
  await expect(readOwnerWaitlistDetail(f.owner,f.business.id,f.recordId,f.db)).rejects.toMatchObject({status:503});
});
it('missingOrCancelledEntry404',async()=>{
  const f=await ownerWaitlistFixture();
  await expect(readOwnerWaitlistDetail(f.owner,f.business.id,'missing',f.db)).rejects.toMatchObject({status:404,code:'OWNER_WAITLIST_ENTRY_GONE'});
  await cancelWaitlist(f.actor,f.business.id,{requestId:'cancel-owner-test',expectedRevision:1,entryId:f.entryId},f.db);
  await expect(readOwnerWaitlistDetail(f.owner,f.business.id,f.recordId,f.db)).rejects.toMatchObject({status:404,code:'OWNER_WAITLIST_ENTRY_GONE'});
});
it('currentVerifiedClientPermissionsAreReadOnlyEvidenceAndDetailAvailabilityMatchesClientProjectionAndSchedule',async()=>{
  const memory=memoryFirestore(),f=await ownerWaitlistFixture(memory.db);
  await f.db.collection('businesses').doc(f.business.id).collection('appointments').doc('block-one').delete();
  const before=structuredClone([...memory.rows]);
  const detail=await readOwnerWaitlistDetail(f.owner,f.business.id,f.recordId,f.db),client=await readWaitlist(f.actor,f.business.id,f.db);
  expect(detail.state).toBe(client.request!.status);expect(detail.state).toBe('available');expect(detail.availability.find(r=>r.resourceId==='one')?.slots).toContain('09:00');
  expect(JSON.stringify(detail)).not.toMatch(/receipt|anchors|bookingRequestId|representativeRole|phone|PRIVATE/);expect(detail.ownerUid).toBe(f.owner.uid);expect(JSON.stringify(detail)).not.toContain(f.actor.uid);
  expect([...memory.rows]).toEqual(before);
});
it('clientConsentRevokedIsSuspendedWithoutReceiptLeakAndCorruptEvidenceCannotHideAsSuspension',async()=>{
  const f=await ownerWaitlistFixture(),account=await readConsent(f.actor.uid,'account',undefined,f.db);
  await updateConsent(f.actor,{scope:'account',action:'revoke',requestId:'owner-revoke-account',expectedRevision:account.revision},f.db);
  expect(await readOwnerWaitlistDetail(f.owner,f.business.id,f.recordId,f.db)).toMatchObject({state:'suspended',reason:'consent_changed',availability:[]});
  const state=(await f.db.collection('serverSettings').doc(consentStateKey(f.actor.uid,'business_client',f.business.id)).get()).data()!;
  await f.db.collection('serverSettings').doc(state.receiptId).set({corrupt:true});
  await expect(readOwnerWaitlistDetail(f.owner,f.business.id,f.recordId,f.db)).rejects.toMatchObject({status:503});
});
it('healthMinorPolicyIsPreservedNotAuthorizedByOwner',async()=>{
  const f=await ownerWaitlistFixture(undefined,'health',true);
  expect((await readOwnerWaitlistDetail(f.owner,f.business.id,f.recordId,f.db)).row.subjectKind).toBe('represented_minor');
  const {saveBookingDataPolicy}=await import('@/lib/server/booking-data-policy');
  await saveBookingDataPolicy(subjectAdmin,{businessId:f.business.id,expectedRevision:f.policy.revision,dataMode:'health',representedMinorsEnabled:false,reason:'Synthetic policy change'},f.db);
  expect(await readOwnerWaitlistDetail(f.owner,f.business.id,f.recordId,f.db)).toMatchObject({state:'suspended',reason:'booking_policy_changed',availability:[]});
});
it('deletedResourceOrServiceDoesNotBecomeAnyResourceAndClosedShiftBufferAndQuotaNeverOfferSlots',async()=>{
  const f=await ownerWaitlistFixture();
  await f.db.collection('businesses').doc(f.business.id).set({...f.business,services:[]});
  expect(await readOwnerWaitlistDetail(f.owner,f.business.id,f.recordId,f.db)).toMatchObject({state:'suspended',row:{serviceLabel:'Servicio anterior'},availability:[]});
  await f.db.collection('businesses').doc(f.business.id).set({...f.business,subscription:{...f.business.subscription,paidTrial:{...f.business.subscription.paidTrial!,appointmentsUsed:10}}});
  expect((await readOwnerWaitlistDetail(f.owner,f.business.id,f.recordId,f.db)).availability).toEqual([]);
});
it('expiredSkipsAvailabilityAndReadDoesNotWriteAdmissionQuotaPolicyRequestOrReview',async()=>{
  const memory=memoryFirestore(),f=await ownerWaitlistFixture(memory.db),before=structuredClone([...memory.rows]);
  vi.mocked(Date.now).mockReturnValue(f.state.request!.expiresAt);
  expect(await readOwnerWaitlistDetail(f.owner,f.business.id,f.recordId,f.db)).toMatchObject({state:'expired',availability:[],row:{lifecycle:'expired'}});
  expect([...memory.rows]).toEqual(before);
});
it('closedScheduleAndBufferUseTheSameTransactionAsClientProjection',async()=>{
  const f=await ownerWaitlistFixture(),businessRef=f.db.collection('businesses').doc(f.business.id);
  await businessRef.collection('appointments').doc('block-one').delete();await businessRef.collection('appointments').doc('block-two').delete();
  await businessRef.set({...f.business,services:f.business.services.map(s=>({...s,bufferMinutes:15}))});
  const available=await readOwnerWaitlistDetail(f.owner,f.business.id,f.recordId,f.db);
  expect(available.availability[0].slots).toContain('09:00');expect(available.availability[0].slots).not.toContain('09:30');
  await businessRef.collection('resourceSchedulePolicies').doc('current').set({version:1,businessId:f.business.id,revision:1,updatedAt:ownerWaitlistNow,rules:{weekly:[],exceptions:[],closures:[{id:'closed',scope:'business',fromDateKey:'2030-01-07',throughDateKey:'2030-01-07',interval:null,label:''}]}});
  const closed=await readOwnerWaitlistDetail(f.owner,f.business.id,f.recordId,f.db);
  expect(closed.state).toBe('waiting');expect(closed.availability.every(r=>r.slots.length===0)).toBe(true);expect((await readWaitlist(f.actor,f.business.id,f.db)).request?.status).toBe('waiting');
});
it('occupancyOverflowFailsNotFreeSlots',async()=>{
  const f=await ownerWaitlistFixture();
  const db={...f.db,runTransaction:<T>(handler:(tx:import('@/lib/storage/types').Transaction)=>Promise<T>)=>f.db.runTransaction(tx=>handler({...tx,get:async(target:any)=>{if(target.path?.endsWith('/appointments'))throw new Error('SYNTHETIC_STORAGE_OVERFLOW');return tx.get(target);}} as import('@/lib/storage/types').Transaction))};
  await expect(readOwnerWaitlistDetail(f.owner,f.business.id,f.recordId,db)).rejects.toThrow();
});
it('scheduleReadCrossingMidnightReturnsExpiredWithoutOldClockSlots',async()=>{
  const f=await ownerWaitlistFixture();
  const db={...f.db,runTransaction:<T>(handler:(tx:import('@/lib/storage/types').Transaction)=>Promise<T>)=>f.db.runTransaction(tx=>handler({...tx,get:async(target:any)=>{const result=await tx.get(target);if(target.path?.endsWith('/resourceSchedulePolicies/current'))vi.mocked(Date.now).mockReturnValue(f.state.request!.expiresAt);return result;}} as import('@/lib/storage/types').Transaction))};
  expect(await readOwnerWaitlistDetail(f.owner,f.business.id,f.recordId,db)).toMatchObject({state:'expired',availability:[],row:{lifecycle:'expired'}});
});
