import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, getApps } from 'firebase-admin/app';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { createBusiness } from '@/lib/server/businesses';
import { createAppointment } from '@/lib/server/bookings';
import { reviewPayment, submitReceipt } from '@/lib/server/billing';
import { businessConfigSchema, receiptSchema } from '@/lib/server/schemas';

function user(uid: string): DecodedIdToken { return { uid, sub:uid, aud:'demo-sarin-bot', auth_time:0, exp:9999999999, iat:0, iss:'https://securetoken.google.com/demo-sarin-bot', firebase:{identities:{},sign_in_provider:'google.com'}, email:`${uid}@example.test`, name:uid }; }

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('real Firestore serializable operations', () => {
  let db: Firestore;
  const owner = user(`owner-${crypto.randomUUID()}`);
  const dateKey = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+2*86400000));
  const config = businessConfigSchema.parse({ name:'Integration business', category:'Services', slug:`test-${crypto.randomUUID()}`, phoneWhatsApp:'573001234567',
    intakeFields:[], resources:[{id:'r',name:'Room',active:true}], services:[{id:'s',name:'Service',durationMinutes:60,bufferMinutes:15,price:100,resourceIds:['r']}],
    weeklySchedule:Object.fromEntries(Array.from({length:7},(_,day)=>[day,{isOpen:true,intervals:[{start:'09:00',end:'18:00'}]}])) });
  beforeAll(() => { db = getAdminDb(); });
  afterAll(async () => { if (db) { await db.terminate(); const app = getApps().find(value => value.name === 'sarin-admin'); if (app) await deleteApp(app); } });
  it('creates one trial per owner and omits owner details from the public projection', async () => {
    const [a,b] = await Promise.all([createBusiness(owner,config,db),createBusiness(owner,config,db)]);
    expect(a.id).toBe(b.id); expect(a.subscription.trialEndsAt).toBe(b.subscription.trialEndsAt);
    expect(a.subscription.trialEndsAt-a.createdAt).toBe(7*86400000);
    const projection = (await db.doc(`publicBusinesses/${a.slug}`).get()).data();
    expect(projection?.ownerEmail).toBeUndefined(); expect(projection?.ownerUid).toBeUndefined();
  });
  it('allows only one of two simultaneous reservations for an initially empty resource/day', async () => {
    const business = await createBusiness(owner,config,db);
    const input={dateKey,startTimeStr:'10:00',resourceId:'r',serviceId:'s',clientPhone:'573001234567',intakeAnswers:{}};
    const results=await Promise.allSettled([createAppointment(user('client-a'),business.id,input,crypto.randomUUID(),db),createAppointment(user('client-b'),business.id,input,crypto.randomUUID(),db)]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    const rejected=results.find(result=>result.status==='rejected');
    expect(rejected?.status==='rejected' && rejected.reason.status).toBe(409);
    const saved=await db.collection(`businesses/${business.id}/appointments`).get(); expect(saved.size).toBe(1);
    const appointment=saved.docs[0].data(); expect(appointment.reservedUntilAt-appointment.endAt).toBe(15*60000);
  });
  it('keeps image content out of payment lists and extends only once under concurrent approvals', async () => {
    await db.doc('platformSettings/main').set({companyName:'Test',monthlyPriceCOP:49900,bankAccounts:[{id:'bank',bankName:'Configured test bank',accountType:'Savings',accountNumber:'fixture-only',holderName:'Fixture'}]});
    // A small raster signature fixture; production validation also imposes the byte cap.
    const input=receiptSchema.parse({bankSelected:'bank',requestId:crypto.randomUUID(),receiptDataUrl:`data:image/webp;base64,${Buffer.from('RIFFxxxxWEBPfixture').toString('base64')}`});
    const uploaded=await submitReceipt(owner,input,db);
    expect((await db.doc(`paymentReceipts/${uploaded.receipt.id}`).get()).data()?.receiptDataUrl).toBeUndefined();
    expect((await db.doc(`paymentImages/${uploaded.receipt.id}`).get()).data()?.receiptDataUrl).toBe(input.receiptDataUrl);
    const [a,b]=await Promise.all([reviewPayment(uploaded.receipt.id,'approve',undefined,db),reviewPayment(uploaded.receipt.id,'approve',undefined,db)]);
    expect(a.business.subscription.currentPeriodEndsAt).toBe(b.business.subscription.currentPeriodEndsAt);
    const period=a.business.subscription.currentPeriodEndsAt-Date.now();
    expect(period).toBeGreaterThan(29.99*86400000); expect(period).toBeLessThan(30.01*86400000);
  });
});
