import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHmac } from 'node:crypto';
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
