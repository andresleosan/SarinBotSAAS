import { expect, it } from 'vitest';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
const original = ['appointments','bookingLocks','clientPolicies','reminderPreferences','reminderReceipts','waitlistRequests'];
const schedules = ['resourceSchedulePolicies','resourceScheduleOperations'];
const historical = [
  { option:'previousBusinessChildren', children:original },
  { option:'previousOwnerRescheduleChildren', children:[...original,'attendanceEvents',...schedules] },
  { option:'previousFactualFaqChildren', children:[...original,'attendanceEvents','ownerRescheduleProposals',...schedules] },
  { option:'previousOwnerWaitlistChildren', children:[...original,'attendanceEvents','ownerRescheduleProposals',...schedules,'factualFaq','factualFaqOperations'] },
];
it.each(historical)('$option retains exactly its historical child authorization after extending the real matcher',async({option,children})=>{
  const runtime=await createDataTestRuntime({[option]:true});
  try{
    for(const child of [...original,...schedules,'attendanceEvents','ownerRescheduleProposals','factualFaq','factualFaqOperations','waitlistOwnerReviews','waitlistOfferHeads','waitlistOffers','teamAccessEvents']){
      const result=await runtime.fetch({action:'read',read:{kind:'document',path:`businesses/demo-team/${child}/demo-record`}});
      expect(result.status,option+':'+child).toBe(children.includes(child)?200:400);
      if(!children.includes(child))expect(await result.json()).toMatchObject({code:'DATA_INVALID'});
    }
  }finally{await runtime.dispose();}
},30000);
