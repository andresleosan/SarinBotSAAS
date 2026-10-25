import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError } from '@/lib/storage/database';
import type { Database } from '@/lib/storage/types';
import type { DataCommand, DataReadResult, DataCommitResult } from '../shared/data-protocol';
import { ownerWaitlistFixture, ownerWaitlistNow, seedOwnerWaitlistRows } from './owner-waitlist-contract';
import { subjectAdmin } from './represented-booking-contract';
import { acceptSyntheticConsent } from './consent-fixtures';
import { readOwnerWaitlistPage, updateOwnerWaitlistReview } from '@/lib/server/owner-waitlist';
import { cancelWaitlist, parseCanonicalWaitlistRecord } from '@/lib/server/waitlist';
import { exportWaitlistData, deleteExportedWaitlistData, deleteExportedWaitlistDataBatch, reconcileWaitlistDataErasure } from '@/lib/server/waitlist-data-maintenance';
import { buildImportSql, prepareMigration, encodeFirestoreValue, buildReversePlan, canonicalJson } from '../scripts/lib/data-migration.mjs';
let runtime:Awaited<ReturnType<typeof createDataTestRuntime>>,db:Database,second:Database;
const calls:{label:string;command:DataCommand;bytes:number;durationMs:number}[]=[];
let intercept:((command:DataCommand)=>Promise<void>)|null,loseCommit:boolean;
const connect=(label:string)=>createCloudflareDatabase(async command=>{
  if(label==='primary')await intercept?.(command);const started=performance.now(),response=await runtime.fetch(command),body=await response.text(),value=JSON.parse(body) as DataReadResult|DataCommitResult;
  calls.push({label,command:structuredClone(command),bytes:Buffer.byteLength(body),durationMs:performance.now()-started});
  if(!response.ok)throw new StorageError(response.status,(value as unknown as {code:string}).code);
  if(label==='primary'&&loseCommit&&command.action==='commit'&&command.writes.some(w=>w.path.includes('/waitlistOwnerReviews/'))){loseCommit=false;throw Error('SYNTHETIC_COMMIT_RESPONSE_LOST');}
  return value;
});
beforeEach(async()=>{vi.spyOn(Date,'now').mockReturnValue(ownerWaitlistNow);vi.stubEnv('SUPERADMIN_UID',subjectAdmin.uid);intercept=null;loseCommit=false;calls.length=0;runtime=await createDataTestRuntime({captureSql:true});db=connect('primary');second=connect('second');},30000);
afterEach(async()=>{await runtime?.dispose();vi.restoreAllMocks();vi.unstubAllEnvs();});
it('realFifo45With25TiesAnd1001OtherDatesUsesIndexAndBoundsReads',async()=>{
  const f=await ownerWaitlistFixture(db),expected=await seedOwnerWaitlistRows(f);
  for(let start=0;start<1001;start+=90)await db.runTransaction(async tx=>{for(let i=start;i<Math.min(start+90,1001);i++)tx.set(db.collection('businesses').doc(f.business.id).collection('waitlistRequests').doc('other-date-'+i),{request:{dateKey:'2029-12-01',createdAt:i,id:'noise-'+i}});});
  calls.length=0;const first=await readOwnerWaitlistPage(f.owner,f.business.id,{dateKey:f.input.dateKey},db);
  expect(first.rows).toHaveLength(20);expect(calls).toHaveLength(22);expect(calls.every(c=>c.command.action==='read')).toBe(true);
  expect(calls.filter(c=>c.command.action==='read'&&c.command.read.kind==='document'&&c.command.read.path.includes('/waitlistOwnerReviews/'))).toHaveLength(20);
  const query=calls.find(c=>c.command.action==='read'&&c.command.read.kind==='query')!.command;
  if(query.action!=='read'||query.read.kind!=='query')throw Error('Expected query');
  const explain=await runtime.explain!(query.read);expect(explain.plan.some((r:{detail:string})=>r.detail.includes('app_waitlist_owner_fifo'))).toBe(true);expect(explain.plan.some((r:{detail:string})=>/SCAN app_documents|USE TEMP B-TREE/.test(r.detail))).toBe(false);
  console.info('S10_LOCAL_PAGE_MEASUREMENTS '+JSON.stringify({transportCalls:calls.length,queryableLookahead:21,markerReads:20,bytes:calls.reduce((sum,c)=>sum+c.bytes,0),transportDurationMs:calls.reduce((sum,c)=>sum+c.durationMs,0)}));
  const next=await readOwnerWaitlistPage(f.owner,f.business.id,{dateKey:f.input.dateKey,cursor:first.nextCursor!},db),last=await readOwnerWaitlistPage(f.owner,f.business.id,{dateKey:f.input.dateKey,cursor:next.nextCursor!},db);
  expect([...first.rows,...next.rows,...last.rows].map(r=>r.recordId)).toEqual(expected.map(r=>r.recordId));expect(last.rows).toHaveLength(5);expect(last.nextCursor).toBeNull();
  await second.collection('businesses').doc(f.business.id).collection('waitlistRequests').doc(first.nextCursor!.recordId).delete();
  await expect(readOwnerWaitlistPage(f.owner,f.business.id,{dateKey:f.input.dateKey,cursor:first.nextCursor!},db)).rejects.toMatchObject({code:'OWNER_WAITLIST_CHANGED'});
},60000);
it('twoHandlesCompeteForReviewCASAndClientCancelPreventsOldEntryWrite',async()=>{
  const f=await ownerWaitlistFixture(db);await acceptSyntheticConsent(db,f.owner.uid);
  const a={requestId:'review-race-a',entryId:f.entryId,expectedWaitlistRevision:1,expectedReviewRevision:0,reviewed:true};
  const results=await Promise.allSettled([updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,a,db),updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,{...a,requestId:'review-race-b'},second)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason).toMatchObject({status:409});
  const marker=db.collection('businesses').doc(f.business.id).collection('waitlistOwnerReviews').doc(f.entryId);expect((await marker.get()).data()?.revision).toBe(1);
  let cancelled=false;intercept=async command=>{if(!cancelled&&command.action==='read'&&command.read.kind==='document'&&command.read.path.includes('/waitlistOwnerReviews/')){cancelled=true;await cancelWaitlist(f.actor,f.business.id,{requestId:'cancel-during-review',expectedRevision:1,entryId:f.entryId},second);}};
  await expect(updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,{...a,expectedReviewRevision:1,reviewed:false,requestId:'review-after-race'},db)).rejects.toMatchObject({code:'OWNER_WAITLIST_CHANGED'});
  expect((await marker.get()).data()?.revision).toBe(1);expect((await f.ref.get()).data()?.request).toBeNull();
},60000);
it('lostResponseReplaysLatestOnlyAndMaintenanceRetainsMarkerAfterTombstone',async()=>{
  const f=await ownerWaitlistFixture(db);await acceptSyntheticConsent(db,f.owner.uid);
  const a={requestId:'review-response-loss',entryId:f.entryId,expectedWaitlistRevision:1,expectedReviewRevision:0,reviewed:true};loseCommit=true;
  // The adapter recovers a dropped commit response by the identical journal
  // command. Discard that API result to model a separate caller response loss.
  await updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,a,db);expect(loseCommit).toBe(false);
  const commits=calls.filter(c=>c.command.action==='commit'&&c.command.writes.some(w=>w.path.includes('/waitlistOwnerReviews/')));
  expect(commits.length).toBeGreaterThanOrEqual(2);expect(commits[0].command).toEqual(commits[1].command);
  expect(await updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,a,second)).toMatchObject({replayed:true,review:{revision:1,reviewed:true}});
  await updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,{...a,expectedReviewRevision:1,reviewed:false,requestId:'review-after-loss'},second);
  await expect(updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,a,db)).rejects.toMatchObject({code:'OWNER_WAITLIST_CHANGED'});
  await cancelWaitlist(f.actor,f.business.id,{requestId:'cancel-after-review-loss',expectedRevision:1,entryId:f.entryId},second);
  const exported=await exportWaitlistData(db,{businessId:f.business.id,ownerUid:f.actor.uid});expect(exported.documents).toHaveLength(2);
  expect(await deleteExportedWaitlistData(db,exported)).toEqual({deleted:2});
},60000);
it('snapshotImportAndReversePreserveCanonicalReviewRequestAndTombstoneMetadata',async()=>{
  const f=await ownerWaitlistFixture(db);await acceptSyntheticConsent(db,f.owner.uid);
  await updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,{requestId:'review-backup-test',entryId:f.entryId,expectedWaitlistRevision:1,expectedReviewRevision:0,reviewed:true},db);
  await cancelWaitlist(f.actor,f.business.id,{requestId:'cancel-before-backup',expectedRevision:1,entryId:f.entryId},db);
  const documents=(await runtime.db.prepare('SELECT path,data FROM app_documents ORDER BY path').all()).results as {path:string;data:string}[];
  const stamp='2030-01-06T14:00:00.000000Z',baseline={version:1,projectId:'sarinbotsaas',databaseId:'(default)',readTime:stamp,collections:[],missingAncestors:[],documents:documents.map(row=>({name:'projects/sarinbotsaas/databases/(default)/documents/'+row.path,fields:Object.fromEntries(Object.entries(JSON.parse(row.data)).map(([k,v])=>[k,encodeFirestoreValue(v)])),createTime:stamp,updateTime:stamp}))};
  const bundle=prepareMigration(baseline,{updatedAt:ownerWaitlistNow}),copy=await createDataTestRuntime();
  try{await copy.db.exec(buildImportSql(bundle));const rows=(await copy.db.prepare('SELECT * FROM app_documents ORDER BY path').all()).results;const reverse=buildReversePlan({baseline,rows,blobs:[],revision:1});expect(reverse.deletionCandidates).toEqual([]);expect(reverse.upserts).toHaveLength(documents.length);const restoredMarker=reverse.upserts.find((r:any)=>r.update.name.endsWith('/waitlistOwnerReviews/'+f.entryId)).update.fields;const expectedMarker=baseline.documents.find(r=>r.name.endsWith('/waitlistOwnerReviews/'+f.entryId))!.fields;expect(canonicalJson(restoredMarker)).toBe(canonicalJson(expectedMarker));const restored=JSON.parse(documents.find(r=>r.path.endsWith('/waitlistRequests/'+f.recordId))!.data);expect(parseCanonicalWaitlistRecord(f.recordId,restored,f.business.id).request).toBeNull();}finally{await copy.dispose();}
},60000);
it('previousWorkerWithoutReviewChildRejectsBeforeWritesAndKeepsExistingWaitlist',async()=>{
  await runtime.dispose();runtime=await createDataTestRuntime({previousOwnerWaitlistChildren:true});db=connect('primary');
  const f=await ownerWaitlistFixture(db);await acceptSyntheticConsent(db,f.owner.uid);
  const before=(await runtime.db.prepare('SELECT * FROM app_documents ORDER BY path').all()).results;
  await expect(updateOwnerWaitlistReview(f.owner,f.business.id,f.recordId,{requestId:'previous-worker-review',entryId:f.entryId,expectedWaitlistRevision:1,expectedReviewRevision:0,reviewed:true},db)).rejects.toMatchObject({status:503});
  expect((await runtime.db.prepare('SELECT * FROM app_documents ORDER BY path').all()).results).toEqual(before);expect((await f.ref.get()).data()?.request.id).toBe(f.entryId);
},60000);
it('privateAccountExportBeyond1000UsesDocumentIdIndexAndVerifiedResumable100WriteBatches',async()=>{
  const f=await ownerWaitlistFixture(db),collection=db.collection('businesses').doc(f.business.id).collection('waitlistOwnerReviews');
  for(let start=0;start<1005;start+=90)await db.runTransaction(async tx=>{for(let i=start;i<Math.min(start+90,1005);i++){const id='batch-'+String(i).padStart(4,'0');tx.set(collection.doc(id),{version:2,businessId:f.business.id,waitlistRecordId:f.recordId,entryId:id,waitlistRevision:1,revision:1,reviewed:true,updatedAt:ownerWaitlistNow,actorUid:f.owner.uid,lastOperation:{requestId:'batch-review-'+i,operationHash:'a'.repeat(64),appliedRevision:1}});}});
  calls.length=0;const exported=await exportWaitlistData(db,{businessId:f.business.id,ownerUid:f.actor.uid});expect(exported.documents).toHaveLength(1006);
  const command=calls.find(c=>c.command.action==='read'&&c.command.read.kind==='query'&&c.command.read.path.endsWith('/waitlistOwnerReviews'))!.command;
  if(command.action!=='read'||command.read.kind!=='query')throw Error('Expected query');const explanation=await runtime.explain!(command.read);expect(explanation.plan.some((row:{detail:string})=>row.detail.includes('app_waitlist_owner_review_record'))).toBe(true);expect(explanation.plan.some((row:{detail:string})=>/SCAN app_documents|USE TEMP B-TREE/.test(row.detail))).toBe(false);
  calls.length=0;await deleteExportedWaitlistDataBatch(db,exported,{writersStopped:true});let progress=await reconcileWaitlistDataErasure(second,exported,{writersStopped:true});expect(progress.deletedCount).toBe(100);
  while(!progress.complete)progress=await deleteExportedWaitlistDataBatch(db,exported,{writersStopped:true,previous:progress});
  expect(progress.deletedCount).toBe(1006);expect((await exportWaitlistData(second,exported.scope)).documents).toEqual([]);expect(calls.filter(c=>c.command.action==='commit').every(c=>c.command.action==='commit'&&c.command.writes.length<=100)).toBe(true);
  expect((await db.collection('businesses').doc(f.business.id).collection('appointments').get()).size).toBe(2);
},90000);
