import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runtimeEnvironment, publicBuildArguments } from '../src/router.ts';
import { isDataPath } from '../../shared/data-protocol.ts';
import { executeDataCommand } from '../src/data.ts';
const runtime = { FIREBASE_ADMIN_PROJECT_ID:'real-project',FIREBASE_ADMIN_CLIENT_EMAIL:'synthetic@example.test',FIREBASE_ADMIN_PRIVATE_KEY:'synthetic',SUPERADMIN_UID:'demo-admin',SARIN_TUNNEL_URL:'https://ia-sarin.alsdevstudio.com/v1/chat/completions',OLLAMA_MAIN_MODEL:'demo',CF_ACCESS_CLIENT_ID:'synthetic',CF_ACCESS_CLIENT_SECRET:'synthetic' };
test('team gate explicitly forwards a strict private boolean and defaults false',()=>{
 assert.equal(runtimeEnvironment(runtime).SARIN_TEAM_ACCESS_ENABLED,'false');
 for(const value of ['true','false'])assert.equal(runtimeEnvironment({...runtime,SARIN_TEAM_ACCESS_ENABLED:value}).SARIN_TEAM_ACCESS_ENABLED,value);
 for(const value of ['TRUE',' true ','enabled','0',true,1,''])assert.throws(()=>runtimeEnvironment({...runtime,SARIN_TEAM_ACCESS_ENABLED:value}));
 const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));assert.equal(config.vars.SARIN_TEAM_ACCESS_ENABLED,'false');
 assert.equal(publicBuildArguments({...runtime,SARIN_TEAM_ACCESS_ENABLED:'true',NEXT_PUBLIC_FIREBASE_API_KEY:'synthetic',NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:'real-project.firebaseapp.com',NEXT_PUBLIC_FIREBASE_PROJECT_ID:'real-project',NEXT_PUBLIC_FIREBASE_APP_ID:'synthetic'}).SARIN_TEAM_ACCESS_ENABLED,undefined);
});
test('private team paths and memberUid queries use the existing bounded typed protocol',async()=>{
 for(const [path,document] of [['businessMemberships',false],['businessMemberships/demo',true],['businesses/demo/teamAccessEvents',false],['businesses/demo/teamAccessEvents/event',true]])assert.equal(isDataPath(path,document),true);
 for(const path of ['publicBusinesses/demo/teamAccessEvents/event','businessMemberships/demo/teamAccessEvents/event','teamAccessEvents/event'])assert.equal(isDataPath(path,true),false);
 const queries=[];const env={SARIN_DB:{prepare(sql){return{bind(...values){queries.push({sql,values});return this;}};},async batch(){return[{results:[{revision:1}]},{results:[]}];}}};
 const query=value=>({action:'read',read:{kind:'query',path:'businessMemberships',filters:[{field:'memberUid',op:'==',value}],order:[{field:'businessId',direction:'asc'}],limit:21}});
 assert.deepEqual(await executeDataCommand(query('demo-member'),env),{revision:1,documents:[]});
 assert.match(queries[0].sql,/json_extract\(data,'\$\.memberUid'\) = \?/);assert.deepEqual(queries[0].values,['businessMemberships','demo-member',21]);
 const noAccess=new Proxy({},{get(){assert.fail('Invalid team query touched storage');}});
 await assert.rejects(executeDataCommand(query(42),noAccess),e=>e.code==='DATA_INVALID');
 await assert.rejects(executeDataCommand({...query('demo'),read:{...query('demo').read,limit:1001}},noAccess),e=>e.code==='DATA_INVALID');
});
