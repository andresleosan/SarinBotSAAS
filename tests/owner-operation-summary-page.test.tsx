import { act, createElement, type ReactNode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import ReportsPage from '@/app/dashboard/reports/page';
import { summarizeOwnerOperation } from '@/lib/owner-operation-summary';
const state=vi.hoisted(()=>({uid:'demo-owner',epoch:1,ownerUid:'demo-owner',error:null as string|null}));
vi.mock('@/components/auth-provider',()=>({useAuth:()=>({user:{uid:state.uid},authEpoch:state.epoch,isCurrentSession:(uid:string,epoch:number)=>uid===state.uid&&epoch===state.epoch}),AuthGate:({children}:{children:ReactNode})=>children}));
vi.mock('@/hooks/useBusiness',()=>({useBusiness:()=>({business:{id:'demo-summary',ownerUid:state.ownerUid,subscription:{status:'past_due',currentPeriodEndsAt:0}},loading:false,error:state.error})}));
vi.mock('@/lib/firebase/client',()=>({getFirebaseClient:()=>({auth:{currentUser:{uid:state.uid,getIdToken:async()=>'demo-token'}}})}));
vi.mock('@/components/app-shell',()=>({AppShell:({children,businessNavigationPath}:{children:ReactNode;businessNavigationPath:string})=>createElement('div',{'data-navigation-path':businessNavigationPath},children),Notice:({children}:{children:ReactNode})=>createElement('p',null,children),buttonClass:'button',fieldClass:'field'}));
vi.mock('next/link',()=>({default:({children,href,...props}:{children:import('react').ReactNode;href:string})=>createElement('a',{href,...props},children)}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});let tree:ReactTestRenderer|undefined;const fetchMock=vi.fn<typeof fetch>();
beforeEach(()=>{state.uid='demo-owner';state.epoch=1;state.ownerUid='demo-owner';state.error=null;fetchMock.mockReset().mockImplementation(async path=>{const q=new URL(String(path),'http://localhost').searchParams;return Response.json(summarizeOwnerOperation({businessId:'demo-summary',ownerUid:state.uid,range:{from:q.get('from')!,through:q.get('through')!},serverNow:Date.now(),records:[]}));});vi.stubGlobal('fetch',fetchMock);});afterEach(async()=>{await act(async()=>tree?.unmount());tree=undefined;vi.unstubAllGlobals();});
it('ownerReadsHistoryWithoutPlanOrNewConsentAndKeepsAgendaNavigationContext',async()=>{await act(async()=>{tree=create(createElement(ReportsPage));});expect(fetchMock).toHaveBeenCalledTimes(1);expect(tree!.root.findByProps({'data-navigation-path':'/dashboard'})).toBeTruthy();expect(JSON.stringify(tree!.toJSON())).toContain('Resumen operativo');});
it('customerOrAdminDoesNotGetOwnerBypassAndPollErrorsMask',async()=>{state.uid='demo-admin';await act(async()=>{tree=create(createElement(ReportsPage));});expect(fetchMock).not.toHaveBeenCalled();state.uid='demo-owner';state.error='Authority unavailable';await act(async()=>tree!.update(createElement(ReportsPage)));expect(fetchMock).not.toHaveBeenCalled();});

