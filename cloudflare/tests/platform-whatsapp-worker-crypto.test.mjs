import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { decryptPlatformWorkerContent, platformWorkerDigest, decodeAudioBase64 } from '../../shared/platform-whatsapp-worker-crypto.ts';
const raw=Buffer.alloc(32,11), key=raw.toString('base64'), path='platformWhatsAppEvents/synthetic-event';
function encrypt(value,bytes) {
  const cipher=createCipheriv('aes-256-gcm',raw,Buffer.alloc(12,9));
  cipher.setAAD(Buffer.from(JSON.stringify(['sarin/platform-whatsapp',1,'content',path])));
  return {version:1,iv:Buffer.alloc(12,9).toString('base64'),data:Buffer.concat([cipher.update(bytes??Buffer.from(JSON.stringify(value))),cipher.final()]).toString('base64'),tag:cipher.getAuthTag().toString('base64')};
}
test('Node AES-GCM envelope decrypts in WebCrypto, preserving Unicode and authoritative AAD',async()=>{
  const value={question:'Consulta ñ 😀 " \\ \n',nested:{value:1}};
  assert.deepEqual(await decryptPlatformWorkerContent(encrypt(value),path,key),value);
  assert.deepEqual(await decryptPlatformWorkerContent(encrypt(null,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from('{"x":1}')])),path,key),{x:1});
  for(const p of ['',path+'different','x\0','x'.repeat(1025)])await assert.rejects(decryptPlatformWorkerContent(encrypt(value),p,key));
  await assert.rejects(decryptPlatformWorkerContent(encrypt(value),path,Buffer.alloc(32,12).toString('base64')));
});
test('strict envelope, base64, limits, authentication and fatal UTF8 fail closed',async()=>{
  const e=encrypt({x:1});
  for(const patch of [{extra:true},{version:2},{iv:e.iv+'='},{tag:e.tag.slice(1)},{data:e.data+'\n'},{data:Buffer.alloc(250001).toString('base64')},{tag:Buffer.alloc(16).toString('base64')},{data:'AB=='}])await assert.rejects(decryptPlatformWorkerContent({...e,...patch},path,key));
  for(const malformed of [Buffer.from([0xff,0xfe]),Buffer.from('{bad')])await assert.rejects(decryptPlatformWorkerContent(encrypt(null,malformed),path,key));
  for(const k of ['',key+'\n',Buffer.alloc(31).toString('base64'),'A'.repeat(42)+'B='])assert.throws(()=>decodeAudioBase64(k,32));
});
test('conversation scope uses exact two-stage content-key HMAC, never unkeyed or link hash',async()=>{
  const parts=['111111','+12025550000','222222','+12025550100'];
  const derived=createHmac('sha256',raw).update(JSON.stringify(['sarin/platform-whatsapp',1,'digest-key','conversation'])).digest();
  const expected=createHmac('sha256',derived).update(JSON.stringify(parts)).digest('hex');
  assert.equal(await platformWorkerDigest('conversation',parts,key),expected);
  for(let i=0;i<parts.length;i++){const other=[...parts];other[i]+='x';assert.notEqual(await platformWorkerDigest('conversation',other,key),expected);}
});

test('actual local Workerd WebCrypto decrypts Node ciphertext and matches the scoped Node HMAC',async context=>{
  const require=createRequire(import.meta.url), wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
  const {build}=wranglerRequire('esbuild'),{Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare');
  const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL('../../',import.meta.url)),contents:`
    import {decryptPlatformWorkerContent,platformWorkerDigest} from './shared/platform-whatsapp-worker-crypto.ts';
    export default {async fetch(request){const input=await request.json();try{return Response.json({value:await decryptPlatformWorkerContent(input.envelope,input.path,input.key),digest:await platformWorkerDigest('conversation',input.parts,input.key)});}catch{return Response.json({denied:true},{status:400});}}};
  `},bundle:true,write:false,format:'esm',platform:'browser'});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-13'}));context.after(()=>mf.dispose());
  const value={text:'Consulta ñ 😀',nested:{n:1}},parts=['111111','+12025550000','222222','+12025550100'];
  const invoke=p=>mf.dispatchFetch('http://synthetic-crypto.test/',{method:'POST',body:JSON.stringify({envelope:encrypt(value),path,key,parts,...p})});
  const response=await invoke({});assert.equal(response.status,200);assert.deepEqual(await response.json(),{value,digest:await platformWorkerDigest('conversation',parts,key)});
  const exactLimitValue={text:'x'.repeat(250000-Buffer.byteLength(JSON.stringify({text:''}),'utf8'))};
  assert.equal(Buffer.byteLength(JSON.stringify(exactLimitValue),'utf8'),250000);
  const exactLimitResponse=await invoke({envelope:encrypt(exactLimitValue)});
  assert.equal(exactLimitResponse.status,200);assert.deepEqual(await exactLimitResponse.json(),{value:exactLimitValue,digest:await platformWorkerDigest('conversation',parts,key)});
  const overLimitValue={text:'x'.repeat(250001-Buffer.byteLength(JSON.stringify({text:''}),'utf8'))};
  assert.equal(Buffer.byteLength(JSON.stringify(overLimitValue),'utf8'),250001);
  assert.equal((await invoke({envelope:encrypt(overLimitValue)})).status,400);
  assert.equal((await invoke({path:path+'wrong'})).status,400);assert.equal((await invoke({key:Buffer.alloc(32,12).toString('base64')})).status,400);
});
