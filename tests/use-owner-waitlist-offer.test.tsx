import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useOwnerWaitlistOffer } from '@/hooks/use-owner-waitlist-offer';
import WaitlistPage from '@/app/dashboard/waitlist/page';
const auth=vi.hoisted(()=>({uid:'demo-owner',epoch:1}));
vi.mock('@/components/auth-provider',()=>({useAuth:()=>({user:auth.uid?{uid:auth.uid}:null,authEpoch:auth.epoch,isCurrentSession:(uid:string,epoch:number)=>uid===auth.uid&&epoch===auth.epoch}),AuthGate:({children}:{children:React.ReactNode})=>children}));
vi.mock('@/components/app-shell',()=>({AppShell:({children}:{children:React.ReactNode})=>children,Notice:({children}:{children:React.ReactNode})=>children,buttonClass:'button',fieldClass:'field'}));
vi.mock('@/hooks/useBusiness',()=>({useBusiness:()=>({business:{id:'demo-business',ownerUid:'demo-owner'},loading:false,error:null})}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()})}));
vi.mock('@/lib/firebase/client',()=>({getFirebaseClient:()=>({auth:{currentUser:auth.uid?{uid:auth.uid,getIdToken:async()=>'synthetic-token'}:null}})}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const now=Date.parse('2030-01-06T14:00:00Z'),dateKey='2030-01-06';
const row={recordId:'record',entryId:'entry-record',waitlistRevision:1,dateKey,createdAt:now-1000,expiresAt:Date.parse('2030-01-07T05:00:00Z'),subjectKind:'self',serviceLabel:'Servicio',resourceLabel:'Uno',lifecycle:'unchecked',review:{revision:0,reviewed:false,updatedAt:null}};
const target={serviceId:'service',serviceName:'Servicio',resourceId:'one',resourceName:'Uno',dateKey,startTimeStr:'15:00',endTimeStr:'15:30',startAt:Date.parse('2030-01-06T20:00:00Z'),endAt:Date.parse('2030-01-06T20:30:00Z'),reservedUntilAt:Date.parse('2030-01-06T20:35:00Z'),durationMinutes:30,bufferMinutes:5,priceCOP:20000};
const offer={id:'offer-one',businessId:'demo-business',waitlistRecordId:'record',entryId:'entry-record',createdAt:now,expiresAt:now+600000,persistedState:'offered',target};
const recovery=()=>({businessId:'demo-business',viewerUid:'demo-owner',serverNow:now,writesEnabled:true,offer,usability:'ready',proposal:null,proof:null});
const context=()=>({detail:{businessId:'demo-business',ownerUid:'demo-owner',serverNow:now,row,state:'available',availability:[{resourceId:'one',resourceName:'Uno',slots:['15:00','15:30']}]},headRevision:0,currentOffer:null,writesEnabled:true,eligible:true,reason:null,service:{serviceId:target.serviceId,serviceName:target.serviceName,durationMinutes:target.durationMinutes,bufferMinutes:target.bufferMinutes,priceCOP:target.priceCOP}});
const result=()=>({recovery:recovery(),appliedHeadRevision:1,headRevision:1,replayed:false});
const terminalRecovery=(persistedState:'withdrawn'|'expired'|'booked'='withdrawn',id=offer.id)=>({...recovery(),serverNow:now+1,offer:{...offer,id,persistedState},usability:null,proof:persistedState==='booked'?{appointmentId:'appointment',proposalId:'proposal',entryId:offer.entryId,previousWaitlistRevision:1,resolvedWaitlistRevision:2,confirmedAt:now+1,source:{dateKey,startAt:target.startAt,endAt:target.endAt,reservedUntilAt:target.reservedUntilAt,resourceId:target.resourceId,serviceId:target.serviceId}}:null});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return{promise,resolve};}
let tree:ReactTestRenderer|undefined,c:ReturnType<typeof useOwnerWaitlistOffer>,input:Parameters<typeof useOwnerWaitlistOffer>[0];
const fetchMock=vi.fn<typeof fetch>(),renders:(string|null)[]=[];
function Harness(){c=useOwnerWaitlistOffer(input);renders.push(c.recovery?.businessId??c.context?.detail.businessId??null);return null;}
const mount=async()=>{await act(async()=>{tree=create(createElement(Harness));});};
const update=async()=>{await act(async()=>tree!.update(createElement(Harness)));};
const creates=()=>fetchMock.mock.calls.filter(call=>String(call[0]).endsWith('/record/offers'));
const reply=(value:unknown,status=200)=>Response.json(value,{status});
beforeEach(()=>{vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout']});vi.setSystemTime(now);auth.uid='demo-owner';auth.epoch=1;input={businessId:'demo-business',ownerUid:'demo-owner',authEpoch:1,enabled:true};fetchMock.mockReset().mockImplementation(async path=>reply(String(path).endsWith('/offer-context')?context():recovery()));vi.stubGlobal('fetch',fetchMock);renders.length=0;});
afterEach(async()=>{await act(async()=>tree?.unmount());tree=undefined;vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
it('readsExactContextAndSelectionNeverAutomaticallyPublishes',async()=>{await mount();expect(fetchMock).not.toHaveBeenCalled();await act(async()=>c.open('record'));expect(c.context?.headRevision).toBe(0);await act(async()=>c.select('one','15:00'));expect(c.command?.selection).toEqual({resourceId:'one',startTimeStr:'15:00'});expect(creates()).toHaveLength(0);});
it('keepsExactCreateAfterNetworkFailureAndTransientAvailabilityAndClose',async()=>{await mount();await act(async()=>c.open('record'));await act(async()=>c.select('one','15:00'));fetchMock.mockRejectedValueOnce(TypeError('lost'));await act(async()=>c.publish());expect(c.uncertain).toBe(true);const body=creates()[0]?.[1]?.body;await act(async()=>c.close());input={...input,available:false};await update();input={...input,available:true};await update();await act(async()=>c.select('one','15:30'));fetchMock.mockResolvedValueOnce(reply({...result(),replayed:true}));await act(async()=>c.retryPending());expect(creates()[1]?.[1]?.body).toBe(body);expect(c.uncertain).toBe(false);expect(c.recovery?.offer.id).toBe('offer-one');});
it('separateRecoveryDoesNotAbortPendingPostAndTwentySecondsOnlyWarns',async()=>{await mount();await act(async()=>c.open('record'));await act(async()=>c.select('one','15:00'));const pending=deferred<Response>();fetchMock.mockReturnValueOnce(pending.promise);let operation!:Promise<void>;await act(async()=>{operation=c.publish();});await act(async()=>vi.advanceTimersByTimeAsync(20000));expect(c.busy).toBe(true);expect(c.notice).toContain('demorando');expect(creates()[0][1]?.signal?.aborted).toBe(false);await act(async()=>c.recover());expect(creates()[0][1]?.signal?.aborted).toBe(false);expect(c.command).not.toBeNull();await act(async()=>{pending.resolve(reply(result()));await operation;});expect(c.busy).toBe(false);expect(c.uncertain).toBe(false);});
it('offeredOrMissingHeadDoesNotUnlockUnknownCreateAnd404DoesNotProveFailure',async()=>{await mount();await act(async()=>c.open('record'));await act(async()=>c.select('one','15:00'));fetchMock.mockRejectedValueOnce(TypeError('lost'));await act(async()=>c.publish());await act(async()=>c.recover());expect(c.uncertain).toBe(true);fetchMock.mockResolvedValueOnce(reply({error:'Missing'},404));await act(async()=>c.recover());expect(c.uncertain).toBe(true);expect(c.command).not.toBeNull();});
it('identityChangeMasksBeforeEffectsAndLateResponseCannotCrossEpochOrBusiness',async()=>{await mount();await act(async()=>c.open('record'));await act(async()=>c.select('one','15:00'));const pending=deferred<Response>();fetchMock.mockReturnValueOnce(pending.promise);let operation!:Promise<void>;await act(async()=>{operation=c.publish();});auth.epoch=2;input={...input,authEpoch:2,businessId:'other'};renders.length=0;await update();expect(renders[0]).toBeNull();expect(c.command).toBeNull();await act(async()=>{pending.resolve(reply(result()));await operation;});expect(c.recovery).toBeNull();expect(c.busy).toBe(false);});
it('readTimeoutAbortsAndCleansUpWithoutLatePublication',async()=>{await mount();const pending=deferred<Response>();fetchMock.mockReturnValueOnce(pending.promise);let operation!:Promise<void>;await act(async()=>{operation=c.open('record');});await act(async()=>vi.advanceTimersByTimeAsync(10000));await operation;expect(c.loading).toBe(false);expect(c.error).toContain('tiempo');expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);await act(async()=>pending.resolve(reply(context())));expect(c.context).toBeNull();expect(vi.getTimerCount()).toBe(0);});
it('s10ReviewBarrierBlocksNewOfferButDoesNotDisableOwnExactRecovery',async()=>{input={...input,otherActionPending:true};await mount();await act(async()=>c.open('record'));await act(async()=>c.select('one','15:00'));expect(c.command).toBeNull();input={...input,otherActionPending:false};await update();await act(async()=>c.select('one','15:00'));fetchMock.mockRejectedValueOnce(TypeError('lost'));await act(async()=>c.publish());input={...input,otherActionPending:true};await update();fetchMock.mockResolvedValueOnce(reply(result()));await act(async()=>c.retryPending());expect(creates()).toHaveLength(2);expect(c.uncertain).toBe(false);});
it('verifiedTerminalCloseInvalidatesLateMutationPublication',async()=>{await mount();await act(async()=>c.openOffer('offer-one'));const pending=deferred<Response>();fetchMock.mockReturnValueOnce(pending.promise);let operation!:Promise<void>;await act(async()=>{operation=c.closeOffer('withdraw');});fetchMock.mockResolvedValueOnce(reply({...recovery(),offer:{...offer,persistedState:'expired'},usability:null}));await act(async()=>c.recover());expect(c.busy).toBe(false);expect(c.uncertain).toBe(false);expect(c.recovery?.offer.persistedState).toBe('expired');await act(async()=>{pending.resolve(reply(terminalRecovery()));await operation;});expect(c.recovery?.offer.persistedState).toBe('expired');});
it('closeProofCannotDescribeAnotherTargetEvenWhenEntryMatches',async()=>{await mount();await act(async()=>c.openOffer('offer-one'));fetchMock.mockResolvedValueOnce(reply({businessId:'demo-business',viewerUid:'demo-owner',offerId:'offer-one',persistedState:'booked',proof:{appointmentId:'appointment',proposalId:'proposal',entryId:offer.entryId,previousWaitlistRevision:1,resolvedWaitlistRevision:2,confirmedAt:now+1,source:{dateKey,startAt:target.startAt,endAt:target.endAt,reservedUntilAt:target.reservedUntilAt,resourceId:'another-resource',serviceId:'service'}}}));await act(async()=>c.closeOffer('close-expired'));expect(c.uncertain).toBe(true);expect(c.recovery?.proof).toBeNull();});
it.each(['withdrawn','booked'] as const)('withdrawPublishesExactRecoveryDtoFor%sWithoutExtraRead',async persistedState=>{await mount();await act(async()=>c.openOffer(offer.id));const value=terminalRecovery(persistedState);fetchMock.mockResolvedValueOnce(reply(value));await act(async()=>c.closeOffer('withdraw'));expect(c.uncertain).toBe(false);expect(c.busy).toBe(false);expect(c.recovery).toEqual(value);expect(fetchMock).toHaveBeenCalledTimes(2);expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/withdraw$/);});
it.each(['different-offer','offered'] as const)('withdrawRejectsUnverified%sRecovery',async invalid=>{await mount();await act(async()=>c.openOffer(offer.id));fetchMock.mockResolvedValueOnce(reply(invalid==='offered'?recovery():terminalRecovery('withdrawn','different-offer')));await act(async()=>c.closeOffer('withdraw'));expect(c.uncertain).toBe(true);expect(c.recovery?.offer.persistedState).toBe('offered');});
it.each(['context','detail'] as const)('verifiedTerminalFrom%sCannotBeOverwrittenByDelayedCreate',async source=>{
  await mount();await act(async()=>c.open('record'));await act(async()=>c.select('one','15:00'));
  const pending=deferred<Response>();fetchMock.mockReturnValueOnce(pending.promise);let operation!:Promise<void>;await act(async()=>{operation=c.publish();});
  const terminal=terminalRecovery('expired');
  if(source==='context') {const value=context();fetchMock.mockResolvedValueOnce(reply({...value,detail:{...value.detail,serverNow:terminal.serverNow},headRevision:1,currentOffer:terminal}));await act(async()=>c.recover());}
  else {fetchMock.mockResolvedValueOnce(reply(terminal));await act(async()=>c.openOffer(offer.id));}
  expect(c.recovery?.offer.persistedState).toBe('expired');expect(c.command).not.toBeNull();
  expect(creates()[0][1]?.signal?.aborted).toBe(false);
  await act(async()=>{pending.resolve(reply(result()));await operation;});
  expect(c.recovery).toEqual(terminal);expect(c.uncertain).toBe(false);expect(c.busy).toBe(false);expect(c.command).toBeNull();
});
it.each(['context','detail'] as const)('unrelatedTerminalFrom%sDoesNotReleaseUnknownCreateFence',async source=>{
  await mount();await act(async()=>c.open('record'));await act(async()=>c.select('one','15:00'));fetchMock.mockRejectedValueOnce(TypeError('lost'));await act(async()=>c.publish());const command=c.command;
  const terminal=terminalRecovery('withdrawn','unrelated-offer');
  if(source==='context') {const value=context();fetchMock.mockResolvedValueOnce(reply({...value,detail:{...value.detail,serverNow:terminal.serverNow},headRevision:1,currentOffer:terminal}));await act(async()=>c.recover());}
  else {fetchMock.mockResolvedValueOnce(reply(terminal));await act(async()=>c.openOffer('unrelated-offer'));}
  expect(c.uncertain).toBe(true);expect(c.command).toEqual(command);await act(async()=>c.select('one','15:30'));expect(c.command).toEqual(command);
  fetchMock.mockResolvedValueOnce(reply({...result(),replayed:true}));await act(async()=>c.retryPending());expect(c.recovery?.offer.id).toBe(offer.id);expect(c.recovery?.offer.persistedState).toBe('offered');expect(creates()[1][1]?.body).toBe(creates()[0][1]?.body);
});
it('dateQueriesUseStoredFilterAndCursorAndRejectWrongScope',async()=>{await mount();const rows=Array.from({length:20},(_,i)=>({...offer,id:'offer-'+String(i).padStart(2,'0')}));fetchMock.mockResolvedValueOnce(reply({businessId:'demo-business',viewerUid:'demo-owner',serverNow:now,dateKey,filter:'offered',rows,nextCursor:{offerId:rows[19].id,createdAt:now}}));await act(async()=>c.query(dateKey,'offered'));expect(c.page?.rows).toHaveLength(20);fetchMock.mockResolvedValueOnce(reply({businessId:'demo-business',viewerUid:'demo-owner',serverNow:now,dateKey,filter:'offered',rows:[],nextCursor:null}));await act(async()=>c.loadOlder());expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({dateKey,filter:'offered',cursor:{offerId:rows[19].id,createdAt:now}});fetchMock.mockResolvedValueOnce(reply({...recovery(),viewerUid:'other'}));await act(async()=>c.openOffer('offer-one'));expect(c.recovery).toBeNull();expect(c.page).toBeNull();});
it.each(['uid','epoch','business'] as const)('lateCreateMasksOldScopeFor%sBeforeEffects',async changed=>{await mount();await act(async()=>c.open('record'));expect(c.context).not.toBeNull();await act(async()=>c.select('one','15:00'));const pending=deferred<Response>();fetchMock.mockReturnValueOnce(pending.promise);let operation!:Promise<void>;await act(async()=>{operation=c.publish();});if(changed==='uid'){auth.uid='new-owner';input={...input,ownerUid:auth.uid};}else if(changed==='epoch'){auth.epoch++;input={...input,authEpoch:auth.epoch};}else input={...input,businessId:'other-business'};renders.length=0;await update();expect(renders[0]).toBeNull();expect(c.command).toBeNull();expect(creates()[0][1]?.signal?.aborted).toBe(true);await act(async()=>{pending.resolve(reply(result()));await operation;});expect(c.recovery).toBeNull();});
it('realPageTabChangesKeepPendingAndUncertainExactIntentAndBlockNewS10Review',async()=>{
  const pending=deferred<Response>();
  fetchMock.mockImplementation(async(path,init)=>{
    const route=String(path);
    if(route.endsWith('/record/offers'))return pending.promise;
    if(route.endsWith('/offer-context'))return reply(context());
    if(route.endsWith('/query'))return reply({businessId:'demo-business',ownerUid:'demo-owner',dateKey,serverNow:now,rows:[row],nextCursor:null,coverage:'current_indexed_requests'});
    return reply(context().detail);
  });
  await act(async()=>{tree=create(createElement(WaitlistPage));});
  const button=(label:string)=>tree!.root.findAllByType('button').find(node=>node.children.join('')===label)!;
  const click=async(label:string)=>{await act(async()=>button(label).props.onClick());};
  await click('Revisar solicitud');await click('Ver disponibilidad');await click('Uno · 15:00');
  await click('Publicar oferta en Sarin');
  expect(button('Marcar como revisada').props.disabled).toBe(true);
  const first=creates()[0];expect(first).toBeTruthy();
  await click('Ofertas');expect(first[1]?.signal?.aborted).toBe(false);
  await click('Solicitudes');expect(first[1]?.signal?.aborted).toBe(false);
  await act(async()=>pending.resolve(reply({error:'Response lost'},503)));
  await click('Ofertas');expect(button('Marcar como revisada').props.disabled).toBe(true);
  fetchMock.mockResolvedValueOnce(reply({...result(),replayed:true}));
  // The list panel has recovery for the same controller while the request panel is hidden.
  const retries=tree!.root.findAllByType('button').filter(node=>node.children.join('')==='Reintentar misma publicación');
  await act(async()=>retries.at(-1)!.props.onClick());
  expect(creates()).toHaveLength(2);expect(creates()[1][1]?.body).toBe(first[1]?.body);
  expect(tree!.root.findByProps({id:'waitlist-requests-panel'}).findAllByProps({'aria-label':'Resultado de oferta'})).toHaveLength(1);
});
